import { db, json, nowSec } from "../db/index.js";
import { logger } from "../lib/logger.js";
import { getSettings } from "../settings.js";
import { runDnsChecks, type DnsReport } from "./checks.js";

type DomainRow = { id: number; name: string; dkim_selectors: string; dns_hash: string | null; dns_checked_at: number | null };

export interface DnsChange {
  domainId: number;
  domain: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

const changeListeners: ((c: DnsChange) => void)[] = [];
export const onDnsChange = (fn: (c: DnsChange) => void) => changeListeners.push(fn);

function snapshot(r: DnsReport) {
  return {
    dmarc: r.dmarc.record,
    spf: r.spf.record,
    dkim: r.dkim.selectors.filter((s) => s.found).map((s) => ({ selector: s.selector, domain: s.domain, bits: s.keyBits })),
    mx: r.mx.hosts,
    mtaSts: r.mtaSts.record,
    tlsRpt: r.tlsRpt.record,
    bimi: r.bimi.record,
  };
}

export async function checkDomainDns(domainId: number): Promise<DnsReport> {
  const d = db.get<DomainRow>("SELECT id, name, dkim_selectors, dns_hash, dns_checked_at FROM domains WHERE id = ?", [domainId]);
  if (!d) throw new Error("Domain not found");
  const report = await runDnsChecks(d.name, json<string[]>(d.dkim_selectors, []));
  if (report.inconclusive && d.dns_hash) {
    // Keep the last good result; only bump the timestamp so we retry on schedule.
    db.run("UPDATE domains SET dns_checked_at = ? WHERE id = ?", [report.checkedAt, d.id]);
    return report;
  }
  const snap = snapshot(report);
  db.tx(() => {
    db.run("UPDATE domains SET dns_checked_at = ?, dns_result = ?, dns_hash = ? WHERE id = ?", [
      report.checkedAt,
      JSON.stringify(report),
      report.hash,
      d.id,
    ]);
    if (d.dns_hash !== report.hash) {
      db.run("INSERT INTO dns_history (domain_id, checked_at, hash, records) VALUES (?, ?, ?, ?)", [d.id, report.checkedAt, report.hash, JSON.stringify(snap)]);
    }
  });
  if (d.dns_hash && d.dns_hash !== report.hash) {
    const prev = db.get<{ records: string }>(
      "SELECT records FROM dns_history WHERE domain_id = ? AND hash = ? ORDER BY checked_at DESC LIMIT 1",
      [d.id, d.dns_hash],
    );
    const change = { domainId: d.id, domain: d.name, before: json<Record<string, unknown>>(prev?.records, {}), after: snap };
    for (const l of changeListeners) l(change);
  }
  return report;
}

/** Checks every domain whose last DNS check is older than the configured interval. */
export async function checkDueDomains() {
  const hours = getSettings().dnsCheckHours;
  if (!hours) return;
  const due = db.all<{ id: number; name: string }>(
    "SELECT id, name FROM domains WHERE dns_checked_at IS NULL OR dns_checked_at < ? ORDER BY dns_checked_at ASC NULLS FIRST LIMIT 20",
    [nowSec() - hours * 3600],
  );
  for (const d of due) {
    await checkDomainDns(d.id).catch((err) => logger.warn({ domain: d.name, err: (err as Error).message }, "dns check failed"));
  }
}
