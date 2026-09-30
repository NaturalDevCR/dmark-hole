import { db, json } from "../db/index.js";
import type { DnsReport } from "../dns/checks.js";
import { has, t, type Locale, type Params } from "../i18n/index.js";
import { defaultRange, overview, providers, sources } from "./stats.js";

export interface RawRecommendation {
  id: string;
  severity: "critical" | "warning" | "info" | "success";
  /** i18n code: title is `rec.<code>`, optional detail is `rec.<code>.detail`. */
  code: string;
  params: Params;
  /** Suggested DNS record (never translated), when applicable. */
  action?: string;
}

export interface Recommendation extends RawRecommendation {
  title: string;
  detail: string;
}

function suggestedDmarc(tags: Record<string, string>, p: string): string {
  const parts = [`v=DMARC1`, `p=${p}`];
  if (tags.sp) parts.push(`sp=${tags.sp === "none" ? p : tags.sp}`);
  if (tags.rua) parts.push(`rua=${tags.rua}`);
  if (tags.ruf) parts.push(`ruf=${tags.ruf}`);
  if (tags.adkim) parts.push(`adkim=${tags.adkim}`);
  if (tags.aspf) parts.push(`aspf=${tags.aspf}`);
  if (tags.fo) parts.push(`fo=${tags.fo}`);
  return parts.join("; ");
}

/**
 * Turns report statistics + DNS state into a prioritized list of concrete
 * actions (the "what should I do next" of the domain page).
 */
export function recommendations(domainId: number, locale: Locale = "en"): Recommendation[] {
  return buildRecommendations(domainId).map((r) => ({
    ...r,
    title: t(locale, `rec.${r.code}`, r.params),
    detail: has(`rec.${r.code}.detail`) ? t(locale, `rec.${r.code}.detail`, r.params) : "",
  }));
}

function buildRecommendations(domainId: number): RawRecommendation[] {
  const d = db.get<{ name: string; dns_result: string | null }>("SELECT name, dns_result FROM domains WHERE id = ?", [domainId]);
  if (!d) return [];
  const dns = json<DnsReport | null>(d.dns_result, null);
  const range = defaultRange(30);
  const ov = overview({ domainId, ...range });
  const provs = providers({ domainId, ...range });
  const recs: RawRecommendation[] = [];
  const policy = dns?.dmarc.tags.p?.toLowerCase();

  if (!dns) {
    recs.push({ id: "dns-pending", severity: "info", code: "dnsPending", params: {} });
  } else {
    if (!dns.dmarc.record) {
      recs.push({
        id: "dmarc-missing",
        severity: "critical",
        code: "dmarcMissing",
        params: {},
        action: `_dmarc.${d.name}  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@${d.name}; fo=1"`,
      });
    }
    if (dns.dmarc.record && dns.dmarc.rua.length === 0) {
      recs.push({ id: "dmarc-rua", severity: "critical", code: "dmarcRua", params: {} });
    }
    if (!dns.spf.record) {
      recs.push({ id: "spf-missing", severity: "critical", code: "spfMissing", params: {}, action: `${d.name}  TXT  "v=spf1 mx ~all"` });
    } else if (dns.spf.lookups > 10) {
      recs.push({ id: "spf-lookups", severity: "critical", code: "spfLookups", params: { count: dns.spf.lookups } });
    } else if (dns.spf.all === "+all" || dns.spf.all === "?all") {
      recs.push({ id: "spf-all", severity: "warning", code: "spfAll", params: { all: dns.spf.all } });
    }
    for (const s of dns.dkim.selectors) {
      if (s.fromReports && !s.found) {
        recs.push({ id: `dkim-missing-${s.selector}`, severity: "warning", code: "dkimMissing", params: { selector: s.selector, domain: s.domain } });
      } else if (s.found && s.keyBits !== null && s.keyType === "rsa" && s.keyBits < 2048) {
        recs.push({ id: `dkim-weak-${s.selector}`, severity: s.keyBits < 1024 ? "critical" : "warning", code: "dkimWeak", params: { selector: s.selector, bits: String(s.keyBits) } });
      }
    }
    if (dns.dmarc.tags.sp === "none" && policy && policy !== "none") {
      recs.push({ id: "dmarc-sp", severity: "warning", code: "dmarcSp", params: {}, action: suggestedDmarc(dns.dmarc.tags, policy) });
    }
    if (!dns.mtaSts.record) recs.push({ id: "mta-sts", severity: "info", code: "mtaSts", params: {} });
  }

  // Report-driven recommendations.
  const misaligned = provs.filter((p) => p.misaligned > 0 && p.misaligned / p.messages > 0.2 && p.messages >= 10);
  for (const p of misaligned.slice(0, 5)) {
    recs.push({
      id: `align-${p.name}`,
      severity: policy === "reject" || policy === "quarantine" ? "critical" : "warning",
      code: "align",
      params: { name: p.name, count: p.misaligned },
    });
  }
  const failing = sources({ domainId, ...range, category: "suspicious", limit: 1_000_000 });
  const failingMsgs = failing.reduce((a, s) => a + s.fail, 0);
  if (failingMsgs > 0) {
    const protectedNow = policy === "reject" || policy === "quarantine";
    recs.push({
      id: "spoofing",
      severity: protectedNow ? "info" : "warning",
      code: protectedNow ? "spoofingProtected" : "spoofingUnprotected",
      params: { count: failingMsgs, sources: failing.length, policy },
    });
  }

  if (dns?.dmarc.record && ov.messages >= 100 && ov.compliance !== null) {
    const tags = dns.dmarc.tags;
    const pctTag = tags.pct ? Number(tags.pct) : 100;
    if (policy === "none" && ov.compliance >= 98) {
      recs.push({ id: "raise-quarantine", severity: "success", code: "raiseQuarantine", params: { compliance: ov.compliance }, action: `_dmarc.${d.name}  TXT  "${suggestedDmarc(tags, "quarantine")}"` });
    } else if (policy === "none" && ov.compliance < 98) {
      recs.push({ id: "fix-before-enforce", severity: "info", code: "fixBeforeEnforce", params: { compliance: ov.compliance } });
    } else if (policy === "quarantine" && pctTag < 100 && ov.compliance >= 98) {
      recs.push({ id: "raise-pct", severity: "success", code: "raisePct", params: { pct: pctTag }, action: `_dmarc.${d.name}  TXT  "${suggestedDmarc({ ...tags, pct: "" }, "quarantine")}"` });
    } else if (policy === "quarantine" && pctTag === 100 && ov.compliance >= 99) {
      recs.push({ id: "raise-reject", severity: "success", code: "raiseReject", params: { compliance: ov.compliance }, action: `_dmarc.${d.name}  TXT  "${suggestedDmarc(tags, "reject")}"` });
    } else if (policy === "reject" && ov.compliance >= 99) {
      recs.push({ id: "all-good", severity: "success", code: "allGood", params: {} });
    }
  } else if (ov.messages === 0) {
    recs.push({ id: "no-data", severity: "info", code: "noData", params: {} });
  }

  const order = { critical: 0, warning: 1, info: 2, success: 3 };
  return recs.sort((a, b) => order[a.severity] - order[b.severity]);
}
