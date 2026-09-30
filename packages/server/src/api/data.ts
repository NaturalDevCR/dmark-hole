import type { FastifyInstance } from "fastify";
import { gunzipSync } from "fflate";
import { z } from "zod";
import { recommendations } from "../analysis/recommendations.js";
import {
  authBreakdown,
  countries,
  defaultRange,
  domainsSummary,
  overview,
  providers,
  reporters,
  sources,
  timeseries,
  type Filter,
} from "../analysis/stats.js";
import { db, json, nowSec } from "../db/index.js";
import type { DnsReport } from "../dns/checks.js";
import { checkDomainDns } from "../dns/service.js";
import { lookupIp } from "../enrich/ip.js";
import { HttpError } from "./auth.js";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const filterQuery = z.object({
  domainId: z.coerce.number().int().positive().optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  days: z.coerce.number().int().min(1).max(3650).optional(),
});

export function parseFilter(q: unknown): Filter {
  const f = filterQuery.parse(q);
  const range = f.from && f.to ? { from: f.from, to: f.to } : defaultRange(f.days ?? 30);
  return { domainId: f.domainId ?? null, ...range };
}

const domainName = z
  .string()
  .trim()
  .toLowerCase()
  .transform((s) => s.replace(/\.$/, ""))
  .pipe(z.string().regex(/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, "Dominio inválido"));

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

function paginate<T>(sql: string, countSql: string, params: (string | number | null)[], page: number, pageSize: number) {
  const total = db.get<{ n: number }>(countSql, params)?.n ?? 0;
  const items = db.all<T>(`${sql} LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
  return { items, total, page, pageSize };
}

export async function dataRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------ domains
  app.get("/api/domains", async (req) => {
    const q = z.object({ days: z.coerce.number().int().min(1).max(3650).default(30) }).parse(req.query);
    return domainsSummary(defaultRange(q.days));
  });

  app.post("/api/domains", async (req) => {
    const body = z.object({ name: domainName, displayName: z.string().max(100).optional(), notes: z.string().max(2000).optional() }).parse(req.body);
    if (db.get("SELECT 1 FROM domains WHERE name = ?", [body.name])) throw new HttpError(409, "El dominio ya existe");
    const r = db.run("INSERT INTO domains (name, display_name, notes, created_at) VALUES (?, ?, ?, ?)", [
      body.name,
      body.displayName || null,
      body.notes || null,
      nowSec(),
    ]);
    // Kick off the first DNS check in the background.
    checkDomainDns(r.lastInsertRowid).catch(() => undefined);
    return { id: r.lastInsertRowid };
  });

  app.get<{ Params: { id: string } }>("/api/domains/:id", async (req) => {
    const id = Number(req.params.id);
    const d = db.get<Record<string, unknown>>(
      "SELECT id, name, display_name displayName, notes, auto_created autoCreated, dkim_selectors dkimSelectors, dns_checked_at dnsCheckedAt, dns_result dnsResult, created_at createdAt FROM domains WHERE id = ?",
      [id],
    );
    if (!d) throw new HttpError(404, "Dominio no encontrado");
    return { ...d, dkimSelectors: json(d.dkimSelectors, []), dnsResult: json<DnsReport | null>(d.dnsResult, null), autoCreated: !!d.autoCreated };
  });

  app.patch<{ Params: { id: string } }>("/api/domains/:id", async (req) => {
    const id = Number(req.params.id);
    const body = z
      .object({ displayName: z.string().max(100).nullable().optional(), notes: z.string().max(2000).nullable().optional(), dkimSelectors: z.array(z.string().max(200)).max(50).optional() })
      .parse(req.body);
    if (body.displayName !== undefined) db.run("UPDATE domains SET display_name = ? WHERE id = ?", [body.displayName || null, id]);
    if (body.notes !== undefined) db.run("UPDATE domains SET notes = ? WHERE id = ?", [body.notes || null, id]);
    if (body.dkimSelectors) db.run("UPDATE domains SET dkim_selectors = ? WHERE id = ?", [JSON.stringify(body.dkimSelectors), id]);
    // Adopting an auto-created domain marks it as intentionally managed.
    db.run("UPDATE domains SET auto_created = 0 WHERE id = ?", [id]);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/domains/:id", async (req) => {
    const id = Number(req.params.id);
    db.tx(() => {
      db.run("DELETE FROM records WHERE domain_id = ?", [id]);
      db.run("DELETE FROM domains WHERE id = ?", [id]);
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/domains/:id/dns-check", async (req) => checkDomainDns(Number(req.params.id)));

  app.get<{ Params: { id: string } }>("/api/domains/:id/dns-history", async (req) =>
    db
      .all<{ checked_at: number; records: string }>("SELECT checked_at, records FROM dns_history WHERE domain_id = ? ORDER BY checked_at DESC LIMIT 50", [Number(req.params.id)])
      .map((r) => ({ checkedAt: r.checked_at, records: json(r.records, {}) })),
  );

  app.get<{ Params: { id: string } }>("/api/domains/:id/recommendations", async (req) => recommendations(Number(req.params.id)));

  // -------------------------------------------------------------------- stats
  app.get("/api/stats/overview", async (req) => overview(parseFilter(req.query)));
  app.get("/api/stats/timeseries", async (req) => timeseries(parseFilter(req.query)));
  app.get("/api/stats/providers", async (req) => providers(parseFilter(req.query)));
  app.get("/api/stats/reporters", async (req) => reporters(parseFilter(req.query)));
  app.get("/api/stats/countries", async (req) => countries(parseFilter(req.query)));
  app.get("/api/stats/auth", async (req) => authBreakdown(parseFilter(req.query)));
  app.get("/api/stats/sources", async (req) => {
    const extra = z
      .object({ category: z.enum(["pass", "forwarded", "misaligned", "fail", "authorized", "forwarder", "needs_config", "suspicious", "mixed"]).optional(), search: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(5000).optional() })
      .parse(req.query);
    return sources({ ...parseFilter(req.query), ...extra });
  });

  // ---------------------------------------------------------------- sources/ip
  app.get<{ Params: { ip: string } }>("/api/sources/:ip", async (req) => {
    const ip = req.params.ip;
    const f = parseFilter(req.query);
    let info = db.get<Record<string, unknown>>("SELECT ip, ptr, asn, as_name asName, country, provider, updated_at updatedAt FROM ip_info WHERE ip = ?", [ip]);
    if (!info) {
      const l = await lookupIp(ip).catch(() => null);
      info = l ? { ip, ptr: l.ptr, asn: l.asn, asName: l.as_name, country: l.country, provider: l.provider } : { ip };
    }
    const params: (string | number)[] = [ip, f.from, f.to];
    let domainSql = "";
    if (f.domainId) {
      domainSql = "AND r.domain_id = ?";
      params.push(f.domainId);
    }
    const rows = db.all<Record<string, unknown>>(
      `SELECT r.id, r.report_id reportId, rp.org_name reporter, r.day, d.name domain, r.count, r.disposition, r.dkim_eval dkimEval, r.spf_eval spfEval,
         r.dmarc_pass dmarcPass, r.category, r.header_from headerFrom, r.envelope_from envelopeFrom, r.dkim, r.spf, r.reasons
       FROM records r JOIN reports rp ON rp.id = r.report_id JOIN domains d ON d.id = r.domain_id
       WHERE r.source_ip = ? AND r.day BETWEEN ? AND ? ${domainSql} ORDER BY r.begin_ts DESC LIMIT 500`,
      params,
    );
    return {
      info,
      records: rows.map((r) => ({ ...r, dmarcPass: !!r.dmarcPass, dkim: json(r.dkim, []), spf: json(r.spf, []), reasons: json(r.reasons, []) })),
    };
  });

  // ------------------------------------------------------------------ reports
  app.get("/api/reports", async (req) => {
    const f = parseFilter(req.query);
    const q = pageQuery.extend({ org: z.string().max(200).optional() }).parse(req.query);
    const where = ["date(rp.begin_ts + (rp.end_ts - rp.begin_ts) / 2, 'unixepoch') BETWEEN ? AND ?"];
    const params: (string | number | null)[] = [f.from, f.to];
    if (f.domainId) {
      where.push("rp.domain_id = ?");
      params.push(f.domainId);
    }
    if (q.org) {
      where.push("rp.org_name = ?");
      params.push(q.org);
    }
    const w = where.join(" AND ");
    return paginate(
      `SELECT rp.id, rp.domain_id domainId, d.name domain, rp.org_name orgName, rp.org_email orgEmail, rp.report_id reportId,
         rp.begin_ts beginTs, rp.end_ts endTs, rp.p, rp.sp, rp.pct, rp.message_count messages, rp.pass_count pass, rp.record_count recordCount,
         rp.source, rp.received_at receivedAt
       FROM reports rp JOIN domains d ON d.id = rp.domain_id WHERE ${w} ORDER BY rp.begin_ts DESC, rp.id DESC`,
      `SELECT COUNT(*) n FROM reports rp WHERE ${w}`,
      params,
      q.page,
      q.pageSize,
    );
  });

  app.get("/api/reports/orgs", async () => db.all<{ name: string }>("SELECT DISTINCT org_name name FROM reports ORDER BY org_name").map((r) => r.name));

  app.get<{ Params: { id: string } }>("/api/reports/:id", async (req) => {
    const id = Number(req.params.id);
    const report = db.get<Record<string, unknown>>(
      `SELECT rp.id, rp.domain_id domainId, d.name domain, rp.org_name orgName, rp.org_email orgEmail, rp.extra_contact extraContact,
         rp.report_id reportId, rp.begin_ts beginTs, rp.end_ts endTs, rp.policy_domain policyDomain, rp.p, rp.sp, rp.np, rp.pct,
         rp.adkim, rp.aspf, rp.fo, rp.testing, rp.version, rp.errors, rp.source, rp.received_at receivedAt,
         rp.message_count messages, rp.pass_count pass, rp.record_count recordCount, rp.raw_xml IS NOT NULL hasXml
       FROM reports rp JOIN domains d ON d.id = rp.domain_id WHERE rp.id = ?`,
      [id],
    );
    if (!report) throw new HttpError(404, "Reporte no encontrado");
    const records = db.all<Record<string, unknown>>(
      `SELECT r.id, r.source_ip sourceIp, r.count, r.disposition, r.dkim_eval dkimEval, r.spf_eval spfEval, r.dmarc_pass dmarcPass,
         r.reasons, r.header_from headerFrom, r.envelope_from envelopeFrom, r.envelope_to envelopeTo, r.dkim, r.spf, r.category,
         i.ptr, i.provider, i.country, i.as_name asName
       FROM records r LEFT JOIN ip_info i ON i.ip = r.source_ip WHERE r.report_id = ? ORDER BY r.count DESC`,
      [id],
    );
    return {
      ...report,
      hasXml: !!report.hasXml,
      errors: json(report.errors, []),
      records: records.map((r) => ({ ...r, dmarcPass: !!r.dmarcPass, dkim: json(r.dkim, []), spf: json(r.spf, []), reasons: json(r.reasons, []) })),
    };
  });

  app.get<{ Params: { id: string } }>("/api/reports/:id/xml", async (req, reply) => {
    const r = db.get<{ raw_xml: Uint8Array | null; org_name: string; report_id: string }>("SELECT raw_xml, org_name, report_id FROM reports WHERE id = ?", [
      Number(req.params.id),
    ]);
    if (!r?.raw_xml) throw new HttpError(404, "XML no disponible");
    const safe = `${r.org_name}_${r.report_id}`.replace(/[^\w.-]+/g, "_").slice(0, 120);
    reply.header("content-type", "application/xml; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="${safe}.xml"`);
    return Buffer.from(gunzipSync(r.raw_xml));
  });

  app.delete<{ Params: { id: string } }>("/api/reports/:id", async (req) => {
    db.run("DELETE FROM reports WHERE id = ?", [Number(req.params.id)]);
    return { ok: true };
  });

  // ----------------------------------------------------------------- forensic
  app.get("/api/forensic", async (req) => {
    const q = pageQuery.extend({ domainId: z.coerce.number().int().optional() }).parse(req.query);
    const params: (number | null)[] = [];
    let w = "1=1";
    if (q.domainId) {
      w = "f.domain_id = ?";
      params.push(q.domainId);
    }
    return paginate(
      `SELECT f.id, f.domain_id domainId, d.name domain, f.received_at receivedAt, f.arrival_ts arrivalTs, f.reporter, f.source_ip sourceIp,
         f.feedback_type feedbackType, f.auth_failure authFailure, f.delivery_result deliveryResult, f.original_mail_from originalMailFrom,
         f.original_rcpt_to originalRcptTo, f.subject, f.header_from headerFrom, i.ptr, i.provider, i.country
       FROM forensic_reports f LEFT JOIN domains d ON d.id = f.domain_id LEFT JOIN ip_info i ON i.ip = f.source_ip
       WHERE ${w} ORDER BY f.received_at DESC`,
      `SELECT COUNT(*) n FROM forensic_reports f WHERE ${w}`,
      params,
      q.page,
      q.pageSize,
    );
  });

  app.get<{ Params: { id: string } }>("/api/forensic/:id", async (req) => {
    const r = db.get(
      `SELECT f.*, d.name domain FROM forensic_reports f LEFT JOIN domains d ON d.id = f.domain_id WHERE f.id = ?`,
      [Number(req.params.id)],
    );
    if (!r) throw new HttpError(404, "Reporte no encontrado");
    return r;
  });

  app.delete<{ Params: { id: string } }>("/api/forensic/:id", async (req) => {
    db.run("DELETE FROM forensic_reports WHERE id = ?", [Number(req.params.id)]);
    return { ok: true };
  });

  // ------------------------------------------------------------------- alerts
  app.get("/api/alerts", async (req) => {
    const q = pageQuery.extend({ unread: z.coerce.boolean().optional(), domainId: z.coerce.number().int().optional() }).parse(req.query);
    const where: string[] = ["1=1"];
    const params: (number | null)[] = [];
    if (q.unread) where.push("a.read_at IS NULL");
    if (q.domainId) {
      where.push("a.domain_id = ?");
      params.push(q.domainId);
    }
    const res = paginate<Record<string, unknown>>(
      `SELECT a.id, a.domain_id domainId, d.name domain, a.type, a.severity, a.title, a.message, a.data, a.created_at createdAt, a.read_at readAt
       FROM alerts a LEFT JOIN domains d ON d.id = a.domain_id WHERE ${where.join(" AND ")} ORDER BY a.created_at DESC, a.id DESC`,
      `SELECT COUNT(*) n FROM alerts a WHERE ${where.join(" AND ")}`,
      params,
      q.page,
      q.pageSize,
    );
    const unread = db.get<{ n: number }>("SELECT COUNT(*) n FROM alerts WHERE read_at IS NULL")?.n ?? 0;
    return { ...res, unread, items: res.items.map((a) => ({ ...a, data: json(a.data, {}) })) };
  });

  app.post<{ Params: { id: string } }>("/api/alerts/:id/read", async (req) => {
    db.run("UPDATE alerts SET read_at = ? WHERE id = ? AND read_at IS NULL", [nowSec(), Number(req.params.id)]);
    return { ok: true };
  });
  app.post("/api/alerts/read-all", async () => {
    db.run("UPDATE alerts SET read_at = ? WHERE read_at IS NULL", [nowSec()]);
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>("/api/alerts/:id", async (req) => {
    db.run("DELETE FROM alerts WHERE id = ?", [Number(req.params.id)]);
    return { ok: true };
  });

  // ------------------------------------------------------------------- export
  app.get("/api/export/records.csv", async (req, reply) => {
    const f = parseFilter(req.query);
    const params: (string | number)[] = [f.from, f.to];
    let dsql = "";
    if (f.domainId) {
      dsql = "AND r.domain_id = ?";
      params.push(f.domainId);
    }
    const rows = db.all<Record<string, string | number | null>>(
      `SELECT r.day, d.name domain, rp.org_name reporter, rp.report_id, r.source_ip, i.ptr, i.provider, i.country, i.asn, r.count,
         r.disposition, r.dkim_eval, r.spf_eval, r.dmarc_pass, r.category, r.header_from, r.envelope_from, r.dkim, r.spf
       FROM records r JOIN reports rp ON rp.id = r.report_id JOIN domains d ON d.id = r.domain_id LEFT JOIN ip_info i ON i.ip = r.source_ip
       WHERE r.day BETWEEN ? AND ? ${dsql} ORDER BY r.day, d.name`,
      params,
    );
    const cols = ["day", "domain", "reporter", "report_id", "source_ip", "ptr", "provider", "country", "asn", "count", "disposition", "dkim_eval", "spf_eval", "dmarc_pass", "category", "header_from", "envelope_from", "dkim", "spf"];
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      // Prefix formula-leading cells so spreadsheets don't execute them.
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="dmarc-records-${f.from}_${f.to}.csv"`);
    return csv;
  });
}
