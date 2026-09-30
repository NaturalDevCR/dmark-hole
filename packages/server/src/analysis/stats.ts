import { db, json, type Params } from "../db/index.js";
import type { DnsReport } from "../dns/checks.js";

export interface Filter {
  domainId?: number | null;
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
}

export function defaultRange(days = 30): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function where(f: Filter, alias = "r"): { sql: string; params: Params } {
  const parts = [`${alias}.day BETWEEN ? AND ?`];
  const params: (string | number)[] = [f.from, f.to];
  if (f.domainId) {
    parts.push(`${alias}.domain_id = ?`);
    params.push(f.domainId);
  }
  return { sql: parts.join(" AND "), params };
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

function shiftRange(f: Filter): Filter {
  const from = Date.parse(`${f.from}T00:00:00Z`);
  const to = Date.parse(`${f.to}T00:00:00Z`);
  const span = to - from + 86400_000;
  return {
    ...f,
    from: new Date(from - span).toISOString().slice(0, 10),
    to: new Date(from - 86400_000).toISOString().slice(0, 10),
  };
}

interface TotalsRow {
  messages: number | null;
  pass: number | null;
  forwarded: number | null;
  misaligned: number | null;
  fail: number | null;
  dmarc_pass: number | null;
  spf_aligned: number | null;
  dkim_aligned: number | null;
  quarantined: number | null;
  rejected: number | null;
  sources: number;
  reports: number;
}

function totals(f: Filter) {
  const w = where(f);
  const row = db.get<TotalsRow>(
    `SELECT SUM(r.count) messages,
       SUM(CASE WHEN r.category = 'pass' THEN r.count ELSE 0 END) pass,
       SUM(CASE WHEN r.category = 'forwarded' THEN r.count ELSE 0 END) forwarded,
       SUM(CASE WHEN r.category = 'misaligned' THEN r.count ELSE 0 END) misaligned,
       SUM(CASE WHEN r.category = 'fail' THEN r.count ELSE 0 END) fail,
       SUM(CASE WHEN r.dmarc_pass = 1 THEN r.count ELSE 0 END) dmarc_pass,
       SUM(CASE WHEN r.spf_aligned = 1 THEN r.count ELSE 0 END) spf_aligned,
       SUM(CASE WHEN r.dkim_aligned = 1 THEN r.count ELSE 0 END) dkim_aligned,
       SUM(CASE WHEN r.disposition = 'quarantine' THEN r.count ELSE 0 END) quarantined,
       SUM(CASE WHEN r.disposition = 'reject' THEN r.count ELSE 0 END) rejected,
       COUNT(DISTINCT r.source_ip) sources,
       COUNT(DISTINCT r.report_id) reports
     FROM records r WHERE ${w.sql}`,
    w.params,
  )!;
  const messages = row.messages ?? 0;
  return {
    messages,
    reports: row.reports,
    sources: row.sources,
    categories: {
      pass: row.pass ?? 0,
      forwarded: row.forwarded ?? 0,
      misaligned: row.misaligned ?? 0,
      fail: row.fail ?? 0,
    },
    dmarcPass: row.dmarc_pass ?? 0,
    compliance: pct(row.dmarc_pass ?? 0, messages),
    spfAlignedRate: pct(row.spf_aligned ?? 0, messages),
    dkimAlignedRate: pct(row.dkim_aligned ?? 0, messages),
    disposition: {
      none: messages - (row.quarantined ?? 0) - (row.rejected ?? 0),
      quarantine: row.quarantined ?? 0,
      reject: row.rejected ?? 0,
    },
  };
}

export function overview(f: Filter) {
  const current = totals(f);
  const previous = totals(shiftRange(f));
  return { range: { from: f.from, to: f.to }, ...current, previous };
}

export function timeseries(f: Filter) {
  const w = where(f);
  const rows = db.all<{ day: string; category: string; messages: number }>(
    `SELECT r.day, r.category, SUM(r.count) messages FROM records r WHERE ${w.sql} GROUP BY r.day, r.category ORDER BY r.day`,
    w.params,
  );
  const days: string[] = [];
  for (let t = Date.parse(`${f.from}T00:00:00Z`); t <= Date.parse(`${f.to}T00:00:00Z`); t += 86400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  const series = { pass: [] as number[], forwarded: [] as number[], misaligned: [] as number[], fail: [] as number[], compliance: [] as (number | null)[] };
  const byDay = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const m = byDay.get(r.day) ?? {};
    m[r.category] = r.messages;
    byDay.set(r.day, m);
  }
  // Compliance counts actual DMARC passes (forwarded mail may pass or fail).
  const passByDay = new Map(
    db
      .all<{ day: string; pass: number; total: number }>(
        `SELECT r.day, SUM(CASE WHEN r.dmarc_pass = 1 THEN r.count ELSE 0 END) pass, SUM(r.count) total
         FROM records r WHERE ${w.sql} GROUP BY r.day`,
        w.params,
      )
      .map((r) => [r.day, pct(r.pass, r.total)]),
  );
  for (const d of days) {
    const m = byDay.get(d) ?? {};
    series.pass.push(m.pass ?? 0);
    series.forwarded.push(m.forwarded ?? 0);
    series.misaligned.push(m.misaligned ?? 0);
    series.fail.push(m.fail ?? 0);
    series.compliance.push(passByDay.get(d) ?? null);
  }
  return { days, series };
}

export type SourceStatus = "authorized" | "forwarder" | "needs_config" | "suspicious" | "mixed";

export interface SourceRow {
  ip: string;
  ptr: string | null;
  asn: number | null;
  asName: string | null;
  country: string | null;
  provider: string | null;
  messages: number;
  pass: number;
  forwarded: number;
  misaligned: number;
  fail: number;
  spfAligned: number;
  dkimAligned: number;
  firstSeen: number;
  lastSeen: number;
  domains: string[];
  dkimDomains: string[];
  spfDomains: string[];
  dispositions: Record<string, number>;
  status: SourceStatus;
}

function sourceStatus(s: Pick<SourceRow, "messages" | "pass" | "forwarded" | "misaligned" | "fail">): SourceStatus {
  const t = s.messages || 1;
  if (s.pass / t >= 0.9) return "authorized";
  if ((s.pass + s.forwarded) / t >= 0.9 && s.forwarded > 0) return "forwarder";
  if (s.misaligned / t >= 0.5) return "needs_config";
  if (s.fail / t >= 0.5) return "suspicious";
  return "mixed";
}

export function sources(f: Filter & { category?: string; search?: string; limit?: number }): SourceRow[] {
  const w = where(f);
  const extra: string[] = [];
  const params = [...(w.params as (string | number)[])];
  if (f.search) {
    extra.push("(r.source_ip LIKE ? OR i.ptr LIKE ? OR i.provider LIKE ? OR i.as_name LIKE ?)");
    const s = `%${f.search}%`;
    params.push(s, s, s, s);
  }
  const rows = db.all<{
    ip: string;
    ptr: string | null;
    asn: number | null;
    as_name: string | null;
    country: string | null;
    provider: string | null;
    messages: number;
    pass: number;
    forwarded: number;
    misaligned: number;
    fail: number;
    spf_aligned: number;
    dkim_aligned: number;
    first_seen: number;
    last_seen: number;
    domains: string;
    quarantined: number;
    rejected: number;
  }>(
    `SELECT r.source_ip ip, i.ptr, i.asn, i.as_name, i.country, i.provider,
       SUM(r.count) messages,
       SUM(CASE WHEN r.category = 'pass' THEN r.count ELSE 0 END) pass,
       SUM(CASE WHEN r.category = 'forwarded' THEN r.count ELSE 0 END) forwarded,
       SUM(CASE WHEN r.category = 'misaligned' THEN r.count ELSE 0 END) misaligned,
       SUM(CASE WHEN r.category = 'fail' THEN r.count ELSE 0 END) fail,
       SUM(CASE WHEN r.spf_aligned = 1 THEN r.count ELSE 0 END) spf_aligned,
       SUM(CASE WHEN r.dkim_aligned = 1 THEN r.count ELSE 0 END) dkim_aligned,
       SUM(CASE WHEN r.disposition = 'quarantine' THEN r.count ELSE 0 END) quarantined,
       SUM(CASE WHEN r.disposition = 'reject' THEN r.count ELSE 0 END) rejected,
       MIN(r.begin_ts) first_seen, MAX(r.begin_ts) last_seen,
       GROUP_CONCAT(DISTINCT r.header_from) domains
     FROM records r LEFT JOIN ip_info i ON i.ip = r.source_ip
     WHERE ${w.sql} ${extra.length ? `AND ${extra.join(" AND ")}` : ""}
     GROUP BY r.source_ip
     ORDER BY messages DESC
     LIMIT ?`,
    [...params, f.limit ?? 1000],
  );

  // Auth domains per IP (bounded sample so large installs stay fast).
  const authDomains = new Map<string, { dkim: Set<string>; spf: Set<string> }>();
  if (rows.length) {
    const ipList = rows.map((r) => r.ip);
    const placeholders = ipList.map(() => "?").join(",");
    const authRows = db.all<{ source_ip: string; dkim: string; spf: string }>(
      `SELECT r.source_ip, r.dkim, r.spf FROM records r WHERE ${w.sql} AND r.source_ip IN (${placeholders})
       GROUP BY r.source_ip, r.dkim, r.spf LIMIT 20000`,
      [...(w.params as (string | number)[]), ...ipList],
    );
    for (const a of authRows) {
      const e = authDomains.get(a.source_ip) ?? { dkim: new Set<string>(), spf: new Set<string>() };
      for (const d of json<{ domain: string; result: string }[]>(a.dkim, [])) if (d.domain) e.dkim.add(`${d.domain}:${d.result}`);
      for (const s of json<{ domain: string; result: string }[]>(a.spf, [])) if (s.domain) e.spf.add(`${s.domain}:${s.result}`);
      authDomains.set(a.source_ip, e);
    }
  }

  let out: SourceRow[] = rows.map((r) => {
    const base = {
      ip: r.ip,
      ptr: r.ptr,
      asn: r.asn,
      asName: r.as_name,
      country: r.country,
      provider: r.provider,
      messages: r.messages,
      pass: r.pass,
      forwarded: r.forwarded,
      misaligned: r.misaligned,
      fail: r.fail,
      spfAligned: r.spf_aligned,
      dkimAligned: r.dkim_aligned,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      domains: (r.domains ?? "").split(",").filter(Boolean),
      dkimDomains: [...(authDomains.get(r.ip)?.dkim ?? [])],
      spfDomains: [...(authDomains.get(r.ip)?.spf ?? [])],
      dispositions: { none: r.messages - r.quarantined - r.rejected, quarantine: r.quarantined, reject: r.rejected },
    };
    return { ...base, status: sourceStatus(base) };
  });
  if (f.category) out = out.filter((s) => (s as unknown as Record<string, number>)[f.category!]! > 0 || s.status === f.category);
  return out;
}

/** Sources grouped by detected provider (or ASN when unknown). */
export function providers(f: Filter) {
  const list = sources({ ...f, limit: 5000 });
  const groups = new Map<string, { name: string; ips: number; messages: number; pass: number; forwarded: number; misaligned: number; fail: number; countries: Set<string> }>();
  for (const s of list) {
    const name = s.provider ?? (s.asName ? s.asName.replace(/,\s*[A-Z]{2}$/, "") : "Desconocido");
    const g = groups.get(name) ?? { name, ips: 0, messages: 0, pass: 0, forwarded: 0, misaligned: 0, fail: 0, countries: new Set<string>() };
    g.ips++;
    g.messages += s.messages;
    g.pass += s.pass;
    g.forwarded += s.forwarded;
    g.misaligned += s.misaligned;
    g.fail += s.fail;
    if (s.country) g.countries.add(s.country);
    groups.set(name, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, countries: [...g.countries], compliance: pct(g.pass + g.forwarded, g.messages), status: sourceStatus(g) }))
    .sort((a, b) => b.messages - a.messages);
}

export function reporters(f: Filter) {
  const w = where(f);
  return db.all<{ org_name: string; reports: number; messages: number; pass: number }>(
    `SELECT rp.org_name, COUNT(DISTINCT rp.id) reports, SUM(r.count) messages,
       SUM(CASE WHEN r.dmarc_pass = 1 THEN r.count ELSE 0 END) pass
     FROM records r JOIN reports rp ON rp.id = r.report_id
     WHERE ${w.sql} GROUP BY rp.org_name ORDER BY messages DESC LIMIT 25`,
    w.params,
  ).map((r) => ({ name: r.org_name, reports: r.reports, messages: r.messages, compliance: pct(r.pass, r.messages) }));
}

export function countries(f: Filter) {
  const w = where(f);
  return db.all<{ country: string | null; messages: number; pass: number; fail: number }>(
    `SELECT i.country, SUM(r.count) messages,
       SUM(CASE WHEN r.dmarc_pass = 1 THEN r.count ELSE 0 END) pass,
       SUM(CASE WHEN r.category = 'fail' THEN r.count ELSE 0 END) fail
     FROM records r LEFT JOIN ip_info i ON i.ip = r.source_ip
     WHERE ${w.sql} GROUP BY i.country ORDER BY messages DESC LIMIT 50`,
    w.params,
  ).map((r) => ({ country: r.country ?? "??", messages: r.messages, pass: r.pass, fail: r.fail }));
}

export function authBreakdown(f: Filter) {
  const w = where(f);
  const rows = db.all<{ spf: string; dkim: string; messages: number }>(
    `SELECT CASE WHEN r.spf_aligned = 1 THEN 'aligned' WHEN r.spf_auth_pass = 1 THEN 'unaligned' ELSE 'fail' END spf,
            CASE WHEN r.dkim_aligned = 1 THEN 'aligned' WHEN r.dkim_auth_pass = 1 THEN 'unaligned' ELSE 'fail' END dkim,
            SUM(r.count) messages
     FROM records r WHERE ${w.sql} GROUP BY 1, 2`,
    w.params,
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Domains list with health
// ---------------------------------------------------------------------------

export function healthScore(compliance: number | null, dnsScore: number | null): number | null {
  if (compliance === null && dnsScore === null) return null;
  if (compliance === null) return dnsScore;
  if (dnsScore === null) return Math.round(compliance);
  return Math.round(compliance * 0.6 + dnsScore * 0.4);
}

export function domainsSummary(range = defaultRange(30)) {
  const domains = db.all<{
    id: number;
    name: string;
    display_name: string | null;
    notes: string | null;
    auto_created: number;
    dns_checked_at: number | null;
    dns_result: string | null;
    created_at: number;
  }>("SELECT id, name, display_name, notes, auto_created, dns_checked_at, dns_result, created_at FROM domains ORDER BY name");

  const stats = new Map(
    db
      .all<{ domain_id: number; messages: number; pass: number; fail: number; misaligned: number; sources: number }>(
        `SELECT domain_id, SUM(count) messages, SUM(CASE WHEN dmarc_pass = 1 THEN count ELSE 0 END) pass,
           SUM(CASE WHEN category = 'fail' THEN count ELSE 0 END) fail,
           SUM(CASE WHEN category = 'misaligned' THEN count ELSE 0 END) misaligned,
           COUNT(DISTINCT source_ip) sources
         FROM records WHERE day BETWEEN ? AND ? GROUP BY domain_id`,
        [range.from, range.to],
      )
      .map((r) => [r.domain_id, r]),
  );
  const lastReports = new Map(
    db
      .all<{ domain_id: number; last: number; p: string | null; total: number }>(
        "SELECT domain_id, MAX(end_ts) last, p, COUNT(*) total FROM reports GROUP BY domain_id",
      )
      .map((r) => [r.domain_id, r]),
  );
  const spark = db.all<{ domain_id: number; day: string; pass: number; total: number }>(
    `SELECT domain_id, day, SUM(CASE WHEN dmarc_pass = 1 THEN count ELSE 0 END) pass, SUM(count) total
     FROM records WHERE day BETWEEN ? AND ? GROUP BY domain_id, day ORDER BY day`,
    [range.from, range.to],
  );
  const sparkBy = new Map<number, { day: string; messages: number; compliance: number | null }[]>();
  for (const s of spark) {
    const list = sparkBy.get(s.domain_id) ?? [];
    list.push({ day: s.day, messages: s.total, compliance: pct(s.pass, s.total) });
    sparkBy.set(s.domain_id, list);
  }

  return domains.map((d) => {
    const s = stats.get(d.id);
    const dns = json<DnsReport | null>(d.dns_result, null);
    const compliance = s ? pct(s.pass, s.messages) : null;
    const lr = lastReports.get(d.id);
    return {
      id: d.id,
      name: d.name,
      displayName: d.display_name,
      notes: d.notes,
      autoCreated: !!d.auto_created,
      createdAt: d.created_at,
      messages: s?.messages ?? 0,
      failing: s?.fail ?? 0,
      misaligned: s?.misaligned ?? 0,
      sources: s?.sources ?? 0,
      compliance,
      totalReports: lr?.total ?? 0,
      lastReportAt: lr?.last ?? null,
      policy: dns?.dmarc.tags.p?.toLowerCase() ?? lr?.p ?? null,
      pct: dns?.dmarc.tags.pct ? Number(dns.dmarc.tags.pct) : null,
      dnsScore: dns?.score ?? null,
      dnsCheckedAt: d.dns_checked_at,
      dnsIssues: dns
        ? [dns.dmarc, dns.spf, dns.dkim].flatMap((x) => x.checks).filter((c) => c.status === "error").length
        : null,
      health: healthScore(compliance, dns?.score ?? null),
      spark: sparkBy.get(d.id) ?? [],
    };
  });
}
