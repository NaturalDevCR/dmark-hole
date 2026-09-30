import { createHash, createPublicKey } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { Resolver } from "node:dns/promises";
import { orgDomain } from "../dmarc/alignment.js";
import { has, t as translate, type Locale, type Params } from "../i18n/index.js";

export type CheckStatus = "ok" | "info" | "warning" | "error";
/**
 * A single finding. Producers only set `code` + `params`; `title`/`detail` are rendered
 * from the i18n dictionary (`dns.<code>` and `dns.<code>.detail`) by localizeDnsReport().
 * Reports stored before this change carry only `title`/`detail` and no `code`.
 */
export interface Check {
  status: CheckStatus;
  code: string;
  params?: Params;
  title?: string;
  detail?: string;
}

const resolver = new Resolver({ timeout: 5000, tries: 2 });

/**
 * Per-run context: any lookup that fails for reasons other than "no such record"
 * (timeouts, SERVFAIL) marks the whole run inconclusive so a flaky resolver is
 * never mistaken for a DNS change.
 */
const runCtx = new AsyncLocalStorage<{ inconclusive: boolean }>();

const isNoData = (err: unknown) => ["ENOTFOUND", "ENODATA"].includes((err as NodeJS.ErrnoException).code ?? "");

function markInconclusive(err: unknown) {
  if (!isNoData(err)) {
    const ctx = runCtx.getStore();
    if (ctx) ctx.inconclusive = true;
  }
}

async function txt(name: string): Promise<string[] | null> {
  try {
    return (await resolver.resolveTxt(name)).map((chunks) => chunks.join(""));
  } catch (err) {
    if (isNoData(err)) return [];
    markInconclusive(err);
    return null; // SERVFAIL / timeout: unknown
  }
}

async function lookupOr<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (err) {
    markInconclusive(err);
    return fallback;
  }
}

function parseTags(record: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const part of record.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    if (k) tags[k] = part.slice(i + 1).trim();
  }
  return tags;
}

// ---------------------------------------------------------------------------
// DMARC
// ---------------------------------------------------------------------------

export interface DmarcCheck {
  record: string | null;
  /** Where the effective policy came from: the domain itself or its organizational domain. */
  source: "domain" | "organizational" | null;
  tags: Record<string, string>;
  rua: string[];
  ruf: string[];
  checks: Check[];
}

function mailtoTargets(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/!\d+[kmgt]?$/i, ""));
}

async function checkDmarc(domain: string): Promise<DmarcCheck> {
  const out: DmarcCheck = { record: null, source: null, tags: {}, rua: [], ruf: [], checks: [] };
  let records = await txt(`_dmarc.${domain}`);
  if (records === null) {
    out.checks.push({ status: "warning", code: "dmarc.lookupFailed" });
    return out;
  }
  let dmarc = records.filter((r) => /^v=DMARC1\b/i.test(r.trim()));
  out.source = "domain";
  const org = orgDomain(domain);
  if (dmarc.length === 0 && org !== domain) {
    records = (await txt(`_dmarc.${org}`)) ?? [];
    dmarc = records.filter((r) => /^v=DMARC1\b/i.test(r.trim()));
    out.source = "organizational";
  }
  if (dmarc.length === 0) {
    out.source = null;
    out.checks.push({ status: "error", code: "dmarc.missing", params: { domain } });
    return out;
  }
  if (dmarc.length > 1) {
    out.checks.push({ status: "error", code: "dmarc.multiple" });
  }
  const record = dmarc[0]!.trim();
  out.record = record;
  const t = parseTags(record);
  out.tags = t;
  out.rua = mailtoTargets(t.rua);
  out.ruf = mailtoTargets(t.ruf);
  if (out.source === "organizational") {
    out.checks.push({ status: "info", code: "dmarc.inherited", params: { org, applied: t.sp ? `sp=${t.sp}` : `p=${t.p}` } });
  }

  const p = t.p?.toLowerCase();
  if (!p || !["none", "quarantine", "reject"].includes(p)) {
    out.checks.push({ status: "error", code: "dmarc.pInvalid" });
  } else if (p === "none") {
    out.checks.push({ status: "warning", code: "dmarc.policyNone" });
  } else if (p === "quarantine") {
    out.checks.push({ status: "ok", code: "dmarc.policyQuarantine" });
  } else {
    out.checks.push({ status: "ok", code: "dmarc.policyReject" });
  }
  if (t.sp && !["none", "quarantine", "reject"].includes(t.sp.toLowerCase())) {
    out.checks.push({ status: "error", code: "dmarc.spInvalid" });
  } else if (t.sp === "none" && p !== "none") {
    out.checks.push({ status: "warning", code: "dmarc.spNone" });
  }
  if (t.pct !== undefined) {
    const pct = Number(t.pct);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) out.checks.push({ status: "error", code: "dmarc.pctRange" });
    else if (pct < 100 && p !== "none") out.checks.push({ status: "warning", code: "dmarc.pctPartial", params: { pct } });
  }
  if (t.t?.toLowerCase() === "y") {
    out.checks.push({ status: "warning", code: "dmarc.testing" });
  }
  if (out.rua.length === 0) {
    out.checks.push({ status: "error", code: "dmarc.ruaMissing" });
  } else {
    for (const uri of out.rua) {
      if (!/^mailto:[^@\s]+@[^@\s]+$/i.test(uri)) {
        out.checks.push({ status: "warning", code: "dmarc.ruaInvalid", params: { uri } });
        continue;
      }
      const target = uri.slice(uri.indexOf("@") + 1).toLowerCase();
      if (orgDomain(target) !== orgDomain(domain)) {
        // RFC 7489 §7.1: the external domain must publish <domain>._report._dmarc.<target>.
        const auth = await txt(`${domain}._report._dmarc.${target}`);
        const ok = !!auth?.some((r) => /^v=DMARC1/i.test(r.trim()));
        const wildcard = ok ? true : !!(await txt(`*._report._dmarc.${target}`))?.some((r) => /^v=DMARC1/i.test(r.trim()));
        out.checks.push(
          ok || wildcard
            ? { status: "ok", code: "dmarc.ruaExternalOk", params: { target } }
            : { status: "error", code: "dmarc.ruaExternalUnauthorized", params: { target, domain } },
        );
      }
    }
  }
  for (const [k, mode] of [["adkim", t.adkim], ["aspf", t.aspf]] as const) {
    if (mode && !["r", "s"].includes(mode.toLowerCase())) out.checks.push({ status: "error", code: "dmarc.alignmentInvalid", params: { tag: k } });
  }
  return out;
}

// ---------------------------------------------------------------------------
// SPF
// ---------------------------------------------------------------------------

export type SpfNodeError = "loop" | "tooDeep" | "dnsError" | "noRecord" | "multiple" | "tooManyLookups" | "mxOver10";

export interface SpfNode {
  domain: string;
  record: string | null;
  lookups: number;
  /** Stable error code (see SpfNodeError); `error` is the rendered text, filled in by localizeDnsReport(). */
  errorCode?: SpfNodeError;
  error?: string;
  mechanisms: { qualifier: string; type: string; value: string | null }[];
  children: SpfNode[];
}

export interface SpfCheck {
  record: string | null;
  tree: SpfNode | null;
  lookups: number;
  voidLookups: number;
  all: string | null;
  checks: Check[];
}

const LOOKUP_MECHS = new Set(["include", "a", "mx", "ptr", "exists", "redirect"]);

/** Past this many lookups the record is already broken; stop walking to bound work. */
const SPF_WALK_LIMIT = 25;

async function resolveSpf(domain: string, state: { lookups: number; void: number }, path: string[]): Promise<SpfNode> {
  const node: SpfNode = { domain, record: null, lookups: 0, mechanisms: [], children: [] };
  // Loop detection is per include path: RFC 7208 counts every occurrence of a
  // repeated include, so the same domain on two branches is legitimate.
  if (path.includes(domain)) {
    node.errorCode = "loop";
    return node;
  }
  if (path.length > 10) {
    node.errorCode = "tooDeep";
    return node;
  }
  const records = await txt(domain);
  if (records === null) {
    node.errorCode = "dnsError";
    return node;
  }
  const spf = records.filter((r) => /^v=spf1(\s|$)/i.test(r.trim()));
  if (spf.length === 0) {
    node.errorCode = "noRecord";
    state.void++;
    return node;
  }
  if (spf.length > 1) node.errorCode = "multiple";
  node.record = spf[0]!.trim();

  for (const term of node.record.split(/\s+/).slice(1)) {
    // mechanism[:value][/cidr]; "a/24" and "mx/24" carry only a CIDR.
    const m = /^([+\-~?]?)([a-z0-9]+)(?:[:=](.*)|(\/.*))?$/i.exec(term);
    if (!m) continue;
    const qualifier = m[1] || "+";
    const type = m[2]!.toLowerCase();
    const value = m[3] ?? m[4] ?? null;
    if (type === "exp") continue;
    node.mechanisms.push({ qualifier, type, value });
    if (!LOOKUP_MECHS.has(type)) continue;
    node.lookups++;
    state.lookups++;
    if (state.lookups > SPF_WALK_LIMIT) {
      node.errorCode = "tooManyLookups";
      break;
    }
    const target = (m[3]?.split("/")[0] || domain).toLowerCase();
    if ((type === "include" || type === "redirect") && m[3] && !m[3].includes("%{")) {
      node.children.push(await resolveSpf(target, state, [...path, domain]));
    } else if (type === "mx") {
      const mx = await lookupOr(resolver.resolveMx(target), []);
      if (mx.length === 0) state.void++;
      // Each MX host needs an address lookup too; RFC 7208 caps them at 10.
      if (mx.length > 10) node.errorCode = "mxOver10";
    } else if (type === "a") {
      const [a4, a6] = await Promise.all([lookupOr(resolver.resolve4(target), []), lookupOr(resolver.resolve6(target), [])]);
      if (a4.length + a6.length === 0) state.void++;
    }
  }
  return node;
}

async function checkSpf(domain: string): Promise<SpfCheck> {
  const out: SpfCheck = { record: null, tree: null, lookups: 0, voidLookups: 0, all: null, checks: [] };
  const state = { lookups: 0, void: 0 };
  const tree = await resolveSpf(domain, state, []);
  out.tree = tree;
  out.record = tree.record;
  out.lookups = state.lookups;
  out.voidLookups = Math.max(0, state.void - (tree.record ? 0 : 1));

  if (!tree.record) {
    out.checks.push({ status: "error", code: "spf.missing", params: { domain } });
    return out;
  }
  if (tree.errorCode) out.checks.push({ status: "error", code: `spf.node.${tree.errorCode}` });

  const allMech = tree.mechanisms.find((m) => m.type === "all");
  const redirect = tree.mechanisms.find((m) => m.type === "redirect");
  out.all = allMech ? `${allMech.qualifier}all` : null;
  if (!allMech && !redirect) {
    out.checks.push({ status: "warning", code: "spf.noAll" });
  } else if (allMech?.qualifier === "+") {
    out.checks.push({ status: "error", code: "spf.plusAll" });
  } else if (allMech?.qualifier === "?") {
    out.checks.push({ status: "warning", code: "spf.neutralAll" });
  } else if (allMech?.qualifier === "~") {
    out.checks.push({ status: "ok", code: "spf.softfail" });
  } else if (allMech?.qualifier === "-") {
    out.checks.push({ status: "ok", code: "spf.hardfail" });
  }

  if (out.lookups > 10) {
    out.checks.push({ status: "error", code: "spf.lookupsExceeded", params: { count: out.lookups } });
  } else if (out.lookups >= 8) {
    out.checks.push({ status: "warning", code: "spf.lookupsNearLimit", params: { count: out.lookups } });
  } else {
    out.checks.push({ status: "ok", code: "spf.lookups", params: { count: out.lookups } });
  }
  if (out.voidLookups > 2) out.checks.push({ status: "error", code: "spf.voidLookups", params: { count: out.voidLookups } });
  const walk = (n: SpfNode): SpfNode[] => [n, ...n.children.flatMap(walk)];
  const all = walk(tree);
  if (all.some((n) => n.mechanisms.some((m) => m.type === "ptr"))) {
    out.checks.push({ status: "warning", code: "spf.ptr" });
  }
  for (const n of all.slice(1)) if (n.errorCode) out.checks.push({ status: "warning", code: `spf.include.${n.errorCode}`, params: { domain: n.domain } });
  return out;
}

// ---------------------------------------------------------------------------
// DKIM
// ---------------------------------------------------------------------------

export interface DkimSelectorCheck {
  selector: string;
  domain: string;
  found: boolean;
  record: string | null;
  keyType: string | null;
  keyBits: number | null;
  testing: boolean;
  revoked: boolean;
  fromReports: boolean;
  checks: Check[];
}

export const COMMON_SELECTORS = ["google", "selector1", "selector2", "default", "dkim", "k1", "k2", "s1", "s2", "mail", "smtp", "mandrill", "mxvault", "zoho", "fm1", "protonmail"];

function keyInfo(p: string, k: string): { bits: number | null; type: string } {
  if (k === "ed25519") return { bits: 256, type: "ed25519" };
  try {
    const key = createPublicKey({ key: Buffer.from(p, "base64"), format: "der", type: "spki" });
    return { bits: key.asymmetricKeyDetails?.modulusLength ?? null, type: key.asymmetricKeyType ?? k };
  } catch {
    try {
      // Some publishers use a bare PKCS#1 RSAPublicKey instead of SPKI.
      const key = createPublicKey({ key: Buffer.from(p, "base64"), format: "der", type: "pkcs1" });
      return { bits: key.asymmetricKeyDetails?.modulusLength ?? null, type: "rsa" };
    } catch {
      return { bits: null, type: k };
    }
  }
}

async function checkSelector(selector: string, domain: string, fromReports: boolean): Promise<DkimSelectorCheck> {
  const out: DkimSelectorCheck = { selector, domain, found: false, record: null, keyType: null, keyBits: null, testing: false, revoked: false, fromReports, checks: [] };
  const records = await txt(`${selector}._domainkey.${domain}`);
  const rec = records?.find((r) => /(^|;)\s*(v=DKIM1|k=|p=)/i.test(r));
  if (!rec) {
    if (fromReports) out.checks.push({ status: "error", code: "dkim.selectorMissing", params: { selector } });
    return out;
  }
  out.found = true;
  out.record = rec;
  const t = parseTags(rec);
  const p = (t.p ?? "").replace(/\s+/g, "");
  const k = (t.k ?? "rsa").toLowerCase();
  out.testing = (t.t ?? "").split(":").map((s) => s.trim()).includes("y");
  if (!p) {
    out.revoked = true;
    out.checks.push({ status: fromReports ? "warning" : "info", code: "dkim.revoked", params: { selector } });
    return out;
  }
  const info = keyInfo(p, k);
  out.keyType = info.type;
  out.keyBits = info.bits;
  if (info.type === "rsa" && info.bits !== null) {
    if (info.bits < 1024) out.checks.push({ status: "error", code: "dkim.weakKey", params: { selector, bits: String(info.bits) } });
    else if (info.bits < 2048) out.checks.push({ status: "warning", code: "dkim.shortKey", params: { selector, bits: String(info.bits) } });
    else out.checks.push({ status: "ok", code: "dkim.rsaOk", params: { selector, bits: String(info.bits) } });
  } else if (info.bits === null) {
    out.checks.push({ status: "error", code: "dkim.unreadable", params: { selector } });
  } else {
    out.checks.push({ status: "ok", code: "dkim.keyOk", params: { selector, type: info.type } });
  }
  if (out.testing) out.checks.push({ status: "warning", code: "dkim.testing", params: { selector } });
  return out;
}

async function checkDkim(domain: string, knownSelectors: string[]): Promise<{ selectors: DkimSelectorCheck[]; checks: Check[] }> {
  // knownSelectors come as "selector:signing-domain" pairs collected from reports.
  const targets = new Map<string, { selector: string; domain: string; fromReports: boolean }>();
  for (const entry of knownSelectors) {
    const [selector, d] = entry.split(":");
    if (selector) targets.set(`${selector}:${d || domain}`, { selector, domain: d || domain, fromReports: true });
  }
  for (const s of COMMON_SELECTORS) {
    if (!targets.has(`${s}:${domain}`)) targets.set(`${s}:${domain}`, { selector: s, domain, fromReports: false });
  }
  const results = await Promise.all([...targets.values()].map((t) => checkSelector(t.selector, t.domain, t.fromReports)));
  const selectors = results.filter((r) => r.found || r.fromReports);
  const checks: Check[] = [];
  if (!selectors.some((s) => s.found && !s.revoked)) {
    checks.push({ status: "warning", code: "dkim.none" });
  }
  return { selectors, checks };
}

// ---------------------------------------------------------------------------
// MX / MTA-STS / TLS-RPT / BIMI
// ---------------------------------------------------------------------------

async function checkMx(domain: string) {
  const checks: Check[] = [];
  const hosts = await lookupOr(resolver.resolveMx(domain), [] as { exchange: string; priority: number }[]);
  hosts.sort((a, b) => a.priority - b.priority);
  if (hosts.length === 0) checks.push({ status: "info", code: "mx.none" });
  else if (hosts.length === 1 && hosts[0]!.exchange === "") checks.push({ status: "info", code: "mx.null" });
  else checks.push({ status: "ok", code: "mx.count", params: { count: hosts.length } });
  return { hosts, checks };
}

async function fetchText(url: string, timeoutMs = 6000): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
    if (!res.ok) return null;
    return (await res.text()).slice(0, 64 * 1024);
  } catch {
    return null;
  }
}

async function checkMtaSts(domain: string) {
  const checks: Check[] = [];
  const records = ((await txt(`_mta-sts.${domain}`)) ?? []).filter((r) => /^v=STSv1/i.test(r));
  const record = records[0] ?? null;
  let policy: { mode: string | null; mx: string[]; maxAge: number | null } | null = null;
  if (!record) {
    checks.push({ status: "info", code: "mtaSts.missing" });
    return { record, policy, checks };
  }
  const body = await fetchText(`https://mta-sts.${domain}/.well-known/mta-sts.txt`);
  if (!body) {
    checks.push({ status: "error", code: "mtaSts.unreachable", params: { domain } });
    return { record, policy, checks };
  }
  const lines = body.split(/\r?\n/).map((l) => l.split(":").map((s) => s.trim()));
  policy = {
    mode: lines.find((l) => l[0] === "mode")?.[1] ?? null,
    mx: lines.filter((l) => l[0] === "mx").map((l) => l[1] ?? ""),
    maxAge: Number(lines.find((l) => l[0] === "max_age")?.[1]) || null,
  };
  if (policy.mode === "enforce") checks.push({ status: "ok", code: "mtaSts.enforce" });
  else if (policy.mode === "testing") checks.push({ status: "warning", code: "mtaSts.testing" });
  else if (policy.mode) checks.push({ status: "warning", code: "mtaSts.mode", params: { mode: policy.mode } });
  else checks.push({ status: "warning", code: "mtaSts.modeUnknown" });
  return { record, policy, checks };
}

async function checkTlsRpt(domain: string) {
  const records = ((await txt(`_smtp._tls.${domain}`)) ?? []).filter((r) => /^v=TLSRPTv1/i.test(r));
  const record = records[0] ?? null;
  const rua = record ? (parseTags(record).rua ?? "").split(",").map((s) => s.trim()).filter(Boolean) : [];
  const checks: Check[] = record
    ? [{ status: "ok", code: "tlsRpt.ok", params: { rua: rua.join(", ") } }]
    : [{ status: "info", code: "tlsRpt.missing" }];
  return { record, rua, checks };
}

async function checkBimi(domain: string, dmarcPolicy: string | undefined) {
  const records = ((await txt(`default._bimi.${domain}`)) ?? []).filter((r) => /^v=BIMI1/i.test(r));
  const record = records[0] ?? null;
  const t = record ? parseTags(record) : {};
  const checks: Check[] = [];
  if (!record) checks.push({ status: "info", code: "bimi.missing" });
  else {
    checks.push({ status: "ok", code: "bimi.ok" });
    if (!dmarcPolicy || dmarcPolicy === "none") checks.push({ status: "warning", code: "bimi.needsEnforce" });
    if (!t.a) checks.push({ status: "info", code: "bimi.noCertificate" });
  }
  return { record, logo: t.l ?? null, vmc: t.a ?? null, checks };
}

// ---------------------------------------------------------------------------

export interface DnsReport {
  domain: string;
  checkedAt: number;
  dmarc: DmarcCheck;
  spf: SpfCheck;
  dkim: { selectors: DkimSelectorCheck[]; checks: Check[] };
  mx: { hosts: { exchange: string; priority: number }[]; checks: Check[] };
  mtaSts: Awaited<ReturnType<typeof checkMtaSts>>;
  tlsRpt: Awaited<ReturnType<typeof checkTlsRpt>>;
  bimi: Awaited<ReturnType<typeof checkBimi>>;
  score: number;
  /** Stable hash of the published records, used to detect DNS changes. */
  hash: string;
  /** Some lookup timed out or failed; the hash must not be trusted for change detection. */
  inconclusive: boolean;
}

function scoreOf(r: Omit<DnsReport, "score" | "hash" | "inconclusive">): number {
  let s = 0;
  const p = r.dmarc.tags.p?.toLowerCase();
  if (r.dmarc.record) s += 15;
  if (p === "quarantine") s += 15;
  if (p === "reject") s += 25;
  if (r.dmarc.rua.length) s += 5;
  if (r.spf.record) s += 15;
  if (r.spf.lookups <= 10 && r.spf.record) s += 5;
  if (r.spf.all === "-all" || r.spf.all === "~all") s += 5;
  const goodDkim = r.dkim.selectors.filter((d) => d.found && !d.revoked && (d.keyBits ?? 0) >= 1024);
  if (goodDkim.length) s += 15;
  if (goodDkim.some((d) => (d.keyBits ?? 0) >= 2048 || d.keyType === "ed25519")) s += 5;
  if (r.mtaSts.policy?.mode === "enforce") s += 3;
  if (r.tlsRpt.record) s += 2;
  const penalties = [r.dmarc, r.spf, r.dkim].flatMap((x) => x.checks).filter((c) => c.status === "error").length;
  return Math.max(0, Math.min(100, s - penalties * 5));
}

export async function runDnsChecks(domain: string, knownSelectors: string[] = []): Promise<DnsReport> {
  const ctx = { inconclusive: false };
  return runCtx.run(ctx, () => runAll(domain, knownSelectors, ctx));
}

async function runAll(domain: string, knownSelectors: string[], ctx: { inconclusive: boolean }): Promise<DnsReport> {
  const [dmarc, spf, dkim, mx, mtaSts, tlsRpt] = await Promise.all([
    checkDmarc(domain),
    checkSpf(domain),
    checkDkim(domain, knownSelectors),
    checkMx(domain),
    checkMtaSts(domain),
    checkTlsRpt(domain),
  ]);
  const bimi = await checkBimi(domain, dmarc.tags.p?.toLowerCase());
  const base = { domain, checkedAt: Math.floor(Date.now() / 1000), dmarc, spf, dkim, mx, mtaSts, tlsRpt, bimi };
  const hash = createHash("sha256")
    .update(
      JSON.stringify([
        dmarc.record,
        spf.record,
        dkim.selectors.filter((s) => s.found).map((s) => `${s.selector}:${s.record}`).sort(),
        mx.hosts.map((h) => `${h.priority} ${h.exchange}`).sort(),
        mtaSts.record,
        tlsRpt.record,
        bimi.record,
      ]),
    )
    .digest("hex");
  return { ...base, score: scoreOf(base), hash, inconclusive: ctx.inconclusive };
}

// ---------------------------------------------------------------------------
// Localization
// ---------------------------------------------------------------------------

function localizeChecks(checks: Check[] | undefined, locale: Locale): Check[] | undefined {
  if (!checks) return checks;
  return checks.map((c) => {
    // Legacy stored checks (no code) already carry their text; leave them untouched.
    if (!c.code) return { ...c };
    const detailKey = `dns.${c.code}.detail`;
    return {
      ...c,
      title: translate(locale, `dns.${c.code}`, c.params),
      detail: has(detailKey) ? translate(locale, detailKey, c.params) || undefined : undefined,
    };
  });
}

function localizeSpfNode(n: SpfNode, locale: Locale): SpfNode {
  return {
    ...n,
    error: n.errorCode ? translate(locale, `dns.spf.node.${n.errorCode}`) : n.error,
    mechanisms: n.mechanisms.map((m) => ({ ...m })),
    children: n.children.map((c) => localizeSpfNode(c, locale)),
  };
}

/**
 * Returns a deep copy of a DNS report with every check's title/detail (and SPF tree
 * node errors) rendered in `locale`. Checks without a `code` (reports stored by older
 * versions) keep their stored text.
 */
export function localizeDnsReport<T extends DnsReport>(report: T, locale: Locale): T {
  const copy = structuredClone(report);
  copy.dmarc.checks = localizeChecks(copy.dmarc.checks, locale) ?? [];
  copy.spf.checks = localizeChecks(copy.spf.checks, locale) ?? [];
  if (copy.spf.tree) copy.spf.tree = localizeSpfNode(copy.spf.tree, locale);
  if (copy.dkim) {
    copy.dkim.checks = localizeChecks(copy.dkim.checks, locale) ?? [];
    for (const sel of copy.dkim.selectors ?? []) sel.checks = localizeChecks(sel.checks, locale) ?? [];
  }
  if (copy.mx) copy.mx.checks = localizeChecks(copy.mx.checks, locale) ?? [];
  if (copy.mtaSts) copy.mtaSts.checks = localizeChecks(copy.mtaSts.checks, locale) ?? [];
  if (copy.tlsRpt) copy.tlsRpt.checks = localizeChecks(copy.tlsRpt.checks, locale) ?? [];
  if (copy.bimi) copy.bimi.checks = localizeChecks(copy.bimi.checks, locale) ?? [];
  return copy;
}
