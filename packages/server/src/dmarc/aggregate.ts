import { isIP } from "node:net";
import { XMLParser } from "fast-xml-parser";
import { isAligned, orgDomain } from "./alignment.js";
import type { AggregateRecord, AggregateReport, Category, DkimAuth, SpfAuth } from "./types.js";

const ARRAY_PATHS = new Set([
  "feedback.record",
  "feedback.report_metadata.error",
  "feedback.record.row.policy_evaluated.reason",
  "feedback.record.auth_results.dkim",
  "feedback.record.auth_results.spf",
]);

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: false,
  isArray: (_name, jpath) => ARRAY_PATHS.has(String(jpath)),
});

type Node = Record<string, unknown>;

export class ReportParseError extends Error {}

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "object") {
    // Elements with attributes or mixed content come back as objects; use their text node.
    const text = (v as Node)["#text"];
    return text === undefined ? null : str(text);
  }
  const s = String(v).trim();
  return s === "" ? null : s;
}

function lower(v: unknown): string | null {
  return str(v)?.toLowerCase() ?? null;
}

function int(v: unknown): number | null {
  const s = str(v);
  if (s === null) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function obj(v: unknown): Node {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Node) : {};
}

function arr(v: unknown): Node[] {
  if (Array.isArray(v)) return v.map(obj);
  return v === undefined || v === null || v === "" ? [] : [obj(v)];
}

/** Normalizes result keywords; some reporters send uppercase or odd spellings. */
function normResult(v: unknown, fallback = "none"): string {
  const r = lower(v);
  if (!r) return fallback;
  if (r === "hardfail") return "fail";
  return r;
}

function normDomain(v: unknown): string | null {
  const s = lower(v);
  return s ? s.replace(/\.$/, "") : null;
}

export function classify(r: Omit<AggregateRecord, "category">): Category {
  const forwardReason = r.reasons.some((x) => ["forwarded", "mailing_list", "trusted_forwarder"].includes(x.type));
  if (r.dmarcPass) {
    if (forwardReason) return "forwarded";
    // DKIM survived but SPF for our own envelope domain failed: classic forwarding path.
    const ownSpfFailed = r.spf.some(
      (s) => s.result !== "pass" && orgDomain(s.domain) === orgDomain(r.headerFrom),
    );
    if (!r.spfAligned && r.dkimAligned && ownSpfFailed) return "forwarded";
    return "pass";
  }
  if (forwardReason) return "forwarded";
  if (r.dkimAuthPass || r.spfAuthPass) return "misaligned";
  return "fail";
}

/** Returns a canonical IP string, or null for anything that is not an address. */
export function normalizeIp(raw: string | null): string | null {
  if (!raw) return null;
  let ip = raw.trim().toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) ip = mapped[1]!;
  return isIP(ip) ? ip : null;
}

function parseRecord(node: Node, policy: AggregateReport["policy"]): AggregateRecord | null {
  const row = obj(node.row);
  const pe = obj(row.policy_evaluated);
  const ids = obj(node.identifiers);
  const auth = obj(node.auth_results);

  const sourceIp = normalizeIp(str(row.source_ip));
  if (!sourceIp) return null;
  const count = int(row.count) ?? 0;
  if (count <= 0) return null;

  const headerFrom = normDomain(ids.header_from) ?? policy.domain;
  const dkimEval = normResult(pe.dkim);
  const spfEval = normResult(pe.spf);

  const dkim: DkimAuth[] = arr(auth.dkim)
    .map((d) => ({
      domain: normDomain(d.domain) ?? "",
      selector: str(d.selector),
      result: normResult(d.result),
      humanResult: str(d.human_result),
      aligned: false,
    }))
    .filter((d) => d.domain || d.result !== "none");
  for (const d of dkim) d.aligned = d.result === "pass" && isAligned(d.domain, headerFrom, policy.adkim);

  const spf: SpfAuth[] = arr(auth.spf)
    .map((s) => ({
      domain: normDomain(s.domain) ?? "",
      scope: lower(s.scope),
      result: normResult(s.result),
      aligned: false,
    }))
    .filter((s) => s.domain || s.result !== "none");
  // SPF alignment uses the MAIL FROM domain; if the reporter omits it fall back to envelope_from.
  const envelopeFrom = normDomain(ids.envelope_from);
  for (const s of spf) {
    if (!s.domain && envelopeFrom) s.domain = envelopeFrom;
    s.aligned = s.result === "pass" && (s.scope === null || s.scope === "mfrom") && isAligned(s.domain, headerFrom, policy.aspf);
  }

  const reasons = arr(pe.reason)
    .map((r) => ({ type: lower(r.type) ?? "other", comment: str(r.comment) }))
    .filter((r) => r.type);

  const dkimAligned = dkim.some((d) => d.aligned);
  const spfAligned = spf.some((s) => s.aligned);

  const base = {
    sourceIp,
    count,
    disposition: lower(pe.disposition) ?? "none",
    dkimEval,
    spfEval,
    // Trust the receiver's evaluation; our own alignment math is a fallback when it is missing.
    dmarcPass: dkimEval === "pass" || spfEval === "pass" || (!pe.dkim && !pe.spf && (dkimAligned || spfAligned)),
    reasons,
    headerFrom,
    envelopeFrom,
    envelopeTo: normDomain(ids.envelope_to),
    dkim,
    spf,
    dkimAuthPass: dkim.some((d) => d.result === "pass"),
    spfAuthPass: spf.some((s) => s.result === "pass"),
    dkimAligned,
    spfAligned,
  };
  return { ...base, category: classify(base) };
}

function stripBom(xml: string): string {
  return xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
}

export function looksLikeAggregate(xml: string): boolean {
  return /<(?:\w+:)?feedback[\s>]/.test(xml.slice(0, 4096)) || /<(?:\w+:)?report_metadata[\s>]/.test(xml);
}

export function parseAggregate(xmlInput: string): AggregateReport {
  const xml = stripBom(xmlInput).trim();
  let doc: Node;
  try {
    doc = parser.parse(xml) as Node;
  } catch (err) {
    throw new ReportParseError(`Invalid XML: ${(err as Error).message}`);
  }
  const feedback = obj(doc.feedback);
  if (!feedback.report_metadata || !feedback.policy_published) {
    throw new ReportParseError("Not a DMARC aggregate report (missing <feedback>/<report_metadata>)");
  }

  const meta = obj(feedback.report_metadata);
  const range = obj(meta.date_range);
  const pp = obj(feedback.policy_published);

  const domain = normDomain(pp.domain);
  if (!domain) throw new ReportParseError("Report has no policy_published/domain");
  const orgName = str(meta.org_name) ?? str(meta.email) ?? "unknown";
  const reportId = str(meta.report_id);
  if (!reportId) throw new ReportParseError("Report has no report_id");

  const begin = int(range.begin);
  const end = int(range.end);
  if (begin === null || end === null) throw new ReportParseError("Report has no valid date_range");

  const policy: AggregateReport["policy"] = {
    domain,
    adkim: lower(pp.adkim) ?? "r",
    aspf: lower(pp.aspf) ?? "r",
    p: lower(pp.p),
    sp: lower(pp.sp),
    np: lower(pp.np),
    pct: int(pp.pct),
    fo: str(pp.fo),
    testing: lower(pp.testing),
  };

  const records: AggregateRecord[] = [];
  for (const rec of arr(feedback.record)) {
    const parsed = parseRecord(rec, policy);
    if (parsed) records.push(parsed);
  }

  return {
    version: str(feedback.version),
    orgName,
    orgEmail: str(meta.email),
    extraContact: str(meta.extra_contact_info),
    reportId,
    begin,
    end,
    errors: (Array.isArray(meta.error) ? (meta.error as unknown[]) : [])
      .map((e) => str(e))
      .filter((e): e is string => !!e),
    policy,
    records,
  };
}
