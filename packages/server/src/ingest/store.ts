import { gzipSync } from "fflate";
import { db, nowSec } from "../db/index.js";
import { orgDomain } from "../dmarc/alignment.js";
import { parseAggregate, ReportParseError } from "../dmarc/aggregate.js";
import { extractDocuments } from "../dmarc/extract.js";
import type { AggregateReport, ForensicReport } from "../dmarc/types.js";
import { sha256 } from "../lib/crypto.js";
import { events } from "../lib/events.js";
import { logger } from "../lib/logger.js";
import { getSettings } from "../settings.js";

export type IngestStatus = "ok" | "duplicate" | "error" | "ignored";

export interface IngestItem {
  kind: "aggregate" | "forensic" | "unknown";
  status: IngestStatus;
  name: string;
  domain?: string;
  reportId?: number;
  message?: string;
}

export interface IngestResult {
  items: IngestItem[];
  warnings: string[];
  counts: Record<IngestStatus, number>;
}

function log(source: string, item: IngestItem, subject?: string | null) {
  db.run(
    "INSERT INTO ingest_log (ts, source, status, kind, message, subject, domain, report_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [nowSec(), source, item.status, item.kind, item.message ?? item.name, subject ?? null, item.domain ?? null, item.reportId ?? null],
  );
}

/**
 * Resolves the domain row a report belongs to. Exact match first, then the
 * organizational domain (so reports for sub.example.com land on example.com
 * when only the parent is configured), then auto-create if enabled.
 */
export function resolveDomain(name: string): { id: number; name: string } | null {
  const exact = db.get<{ id: number; name: string }>("SELECT id, name FROM domains WHERE name = ?", [name]);
  if (exact) return exact;
  const settings = getSettings();
  const org = orgDomain(name);
  if (!settings.autoCreateDomains && org !== name) {
    const parent = db.get<{ id: number; name: string }>("SELECT id, name FROM domains WHERE name = ?", [org]);
    if (parent) return parent;
  }
  if (!settings.autoCreateDomains) return null;
  const r = db.run("INSERT INTO domains (name, auto_created, created_at) VALUES (?, 1, ?)", [name, nowSec()]);
  logger.info({ domain: name }, "auto-created domain from incoming report");
  return { id: r.lastInsertRowid, name };
}

function dayOf(begin: number, end: number): string {
  const mid = end > begin ? begin + Math.floor((end - begin) / 2) : begin;
  return new Date(mid * 1000).toISOString().slice(0, 10);
}

export function storeAggregate(report: AggregateReport, xml: string, source: string): IngestItem {
  const hash = sha256(xml.trim());
  const base: IngestItem = { kind: "aggregate", status: "ok", name: `${report.orgName} #${report.reportId}`, domain: report.policy.domain };

  const dup = db.get<{ id: number }>(
    "SELECT id FROM reports WHERE xml_hash = ? OR (org_name = ? AND report_id = ? AND policy_domain = ?)",
    [hash, report.orgName, report.reportId, report.policy.domain],
  );
  if (dup) return { ...base, status: "duplicate", reportId: dup.id, message: `Duplicate report ${base.name}` };

  const domain = resolveDomain(report.policy.domain);
  if (!domain) {
    return { ...base, status: "ignored", message: `Domain ${report.policy.domain} is not configured (auto-create disabled)` };
  }

  const settings = getSettings();
  const messageCount = report.records.reduce((a, r) => a + r.count, 0);
  const passCount = report.records.reduce((a, r) => a + (r.dmarcPass ? r.count : 0), 0);
  const day = dayOf(report.begin, report.end);
  const p = report.policy;

  const reportId = db.tx(() => {
    const ins = db.run(
      `INSERT INTO reports (domain_id, org_name, org_email, extra_contact, report_id, begin_ts, end_ts, policy_domain,
        p, sp, np, pct, adkim, aspf, fo, testing, version, errors, source, received_at, xml_hash, raw_xml,
        message_count, pass_count, record_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        domain.id, report.orgName, report.orgEmail, report.extraContact, report.reportId, report.begin, report.end, p.domain,
        p.p, p.sp, p.np, p.pct, p.adkim, p.aspf, p.fo, p.testing, report.version, JSON.stringify(report.errors), source,
        nowSec(), hash, settings.storeRawXml ? gzipSync(new TextEncoder().encode(xml)) : null,
        messageCount, passCount, report.records.length,
      ],
    );
    const id = ins.lastInsertRowid;
    for (const r of report.records) {
      db.run(
        `INSERT INTO records (report_id, domain_id, day, begin_ts, source_ip, count, disposition, dkim_eval, spf_eval, dmarc_pass,
          reasons, header_from, envelope_from, envelope_to, dkim, spf, dkim_auth_pass, spf_auth_pass, dkim_aligned, spf_aligned, category)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, domain.id, day, report.begin, r.sourceIp, r.count, r.disposition, r.dkimEval, r.spfEval, r.dmarcPass ? 1 : 0,
          JSON.stringify(r.reasons), r.headerFrom, r.envelopeFrom, r.envelopeTo, JSON.stringify(r.dkim), JSON.stringify(r.spf),
          r.dkimAuthPass ? 1 : 0, r.spfAuthPass ? 1 : 0, r.dkimAligned ? 1 : 0, r.spfAligned ? 1 : 0, r.category,
        ],
      );
    }
    // Remember DKIM selectors seen for this domain so DNS checks can validate the keys.
    const selectors = new Set<string>();
    for (const r of report.records)
      for (const d of r.dkim) if (d.selector && d.domain && orgDomain(d.domain) === orgDomain(domain.name)) selectors.add(`${d.selector}:${d.domain}`);
    if (selectors.size) {
      const row = db.get<{ dkim_selectors: string }>("SELECT dkim_selectors FROM domains WHERE id = ?", [domain.id]);
      const known = new Set<string>(JSON.parse(row?.dkim_selectors ?? "[]"));
      const before = known.size;
      for (const s of selectors) known.add(s);
      if (known.size !== before) db.run("UPDATE domains SET dkim_selectors = ? WHERE id = ?", [JSON.stringify([...known].slice(0, 50)), domain.id]);
    }
    return id;
  });

  events.emit("report:stored", {
    reportId,
    domainId: domain.id,
    domain: domain.name,
    ips: [...new Set(report.records.map((r) => r.sourceIp))],
  });
  return { ...base, domain: domain.name, reportId, message: `${report.records.length} records, ${messageCount} messages` };
}

export function storeForensic(report: ForensicReport, raw: string, source: string, name: string): IngestItem {
  const hash = sha256(raw);
  const base: IngestItem = { kind: "forensic", status: "ok", name, domain: report.reportedDomain ?? undefined };
  if (db.get("SELECT 1 FROM forensic_reports WHERE raw_hash = ?", [hash])) return { ...base, status: "duplicate", message: "Duplicate forensic report" };

  let domainId: number | null = null;
  if (report.reportedDomain) {
    const d = resolveDomain(report.reportedDomain);
    if (!d) return { ...base, status: "ignored", message: `Domain ${report.reportedDomain} is not configured` };
    domainId = d.id;
  }
  const r = db.run(
    `INSERT INTO forensic_reports (domain_id, received_at, arrival_ts, reporter, source_ip, feedback_type, auth_failure, delivery_result,
      reported_domain, original_mail_from, original_rcpt_to, dkim_domain, dkim_selector, spf_dns, subject, message_id, header_from, headers, source, raw_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      domainId, nowSec(), report.arrivalTs, report.reporter, report.sourceIp, report.feedbackType, report.authFailure, report.deliveryResult,
      report.reportedDomain, report.originalMailFrom, report.originalRcptTo, report.dkimDomain, report.dkimSelector, report.spfDns,
      report.subject, report.messageId, report.headerFrom, report.headers, source, hash,
    ],
  );
  events.emit("forensic:stored", { id: r.lastInsertRowid, domainId });
  return { ...base, reportId: r.lastInsertRowid };
}

/** Entry point for every ingestion channel (IMAP, SMTP, upload). */
export async function ingestBlob(data: Uint8Array, source: string, name = "blob"): Promise<IngestResult> {
  const result: IngestResult = { items: [], warnings: [], counts: { ok: 0, duplicate: 0, error: 0, ignored: 0 } };
  const extracted = await extractDocuments(data, name);
  result.warnings.push(...extracted.warnings);

  for (const doc of extracted.documents) {
    let item: IngestItem;
    try {
      if (doc.kind === "aggregate") {
        item = storeAggregate(parseAggregate(doc.xml), doc.xml, source);
      } else {
        item = storeForensic(doc.report, doc.raw, source, doc.name);
      }
    } catch (err) {
      const msg = err instanceof ReportParseError ? err.message : `Unexpected error: ${(err as Error).message}`;
      if (!(err instanceof ReportParseError)) logger.error({ err, name: doc.name }, "failed to store report");
      item = { kind: doc.kind, status: "error", name: doc.name, message: `${doc.name}: ${msg}` };
    }
    result.items.push(item);
    result.counts[item.status]++;
    log(source, item, extracted.subject);
  }

  if (extracted.documents.length === 0) {
    const item: IngestItem = { kind: "unknown", status: "ignored", name, message: extracted.warnings.join("; ") || "No DMARC report found" };
    result.items.push(item);
    result.counts.ignored++;
    log(source, item, extracted.subject);
  }
  return result;
}
