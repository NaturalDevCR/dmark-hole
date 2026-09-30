import { createHash, createPublicKey } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { Resolver } from "node:dns/promises";
import { orgDomain } from "../dmarc/alignment.js";

export type CheckStatus = "ok" | "info" | "warning" | "error";
export interface Check {
  status: CheckStatus;
  title: string;
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
    out.checks.push({ status: "warning", title: "No se pudo consultar el registro DMARC", detail: "Error temporal de DNS" });
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
    out.checks.push({
      status: "error",
      title: "No hay registro DMARC",
      detail: `Publique un TXT en _dmarc.${domain}, p.ej. "v=DMARC1; p=none; rua=mailto:dmarc@${domain}"`,
    });
    return out;
  }
  if (dmarc.length > 1) {
    out.checks.push({ status: "error", title: "Múltiples registros DMARC", detail: "Los receptores ignoran DMARC si hay más de un registro." });
  }
  const record = dmarc[0]!.trim();
  out.record = record;
  const t = parseTags(record);
  out.tags = t;
  out.rua = mailtoTargets(t.rua);
  out.ruf = mailtoTargets(t.ruf);
  if (out.source === "organizational") {
    out.checks.push({ status: "info", title: `Política heredada de ${org}`, detail: t.sp ? `Se aplica sp=${t.sp}` : `Se aplica p=${t.p}` });
  }

  const p = t.p?.toLowerCase();
  if (!p || !["none", "quarantine", "reject"].includes(p)) {
    out.checks.push({ status: "error", title: "Etiqueta p= inválida o ausente", detail: "Debe ser none, quarantine o reject." });
  } else if (p === "none") {
    out.checks.push({ status: "warning", title: "Política en modo monitoreo (p=none)", detail: "No protege contra suplantación. Avance a quarantine/reject cuando las fuentes legítimas estén alineadas." });
  } else if (p === "quarantine") {
    out.checks.push({ status: "ok", title: "Política quarantine activa", detail: "El siguiente paso es p=reject." });
  } else {
    out.checks.push({ status: "ok", title: "Política reject activa", detail: "Máxima protección contra suplantación." });
  }
  if (t.sp && !["none", "quarantine", "reject"].includes(t.sp.toLowerCase())) {
    out.checks.push({ status: "error", title: "Etiqueta sp= inválida" });
  } else if (t.sp === "none" && p !== "none") {
    out.checks.push({ status: "warning", title: "Subdominios sin protección (sp=none)", detail: "Los subdominios pueden ser suplantados." });
  }
  if (t.pct !== undefined) {
    const pct = Number(t.pct);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) out.checks.push({ status: "error", title: "pct= fuera de rango (0-100)" });
    else if (pct < 100 && p !== "none") out.checks.push({ status: "warning", title: `La política solo se aplica al ${pct}% del correo`, detail: "Suba pct a 100 cuando esté listo." });
  }
  if (t.t?.toLowerCase() === "y") {
    out.checks.push({ status: "warning", title: "Modo de prueba activo (t=y)", detail: "DMARCbis: los receptores aplican una política un nivel menos estricta." });
  }
  if (out.rua.length === 0) {
    out.checks.push({ status: "error", title: "Sin destino de reportes agregados (rua)", detail: "Sin rua no recibirá reportes DMARC." });
  } else {
    for (const uri of out.rua) {
      if (!/^mailto:[^@\s]+@[^@\s]+$/i.test(uri)) {
        out.checks.push({ status: "warning", title: `URI rua no válida: ${uri}` });
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
            ? { status: "ok", title: `Destino externo autorizado: ${target}` }
            : {
                status: "error",
                title: `Destino externo sin autorización: ${target}`,
                detail: `Falta TXT "v=DMARC1" en ${domain}._report._dmarc.${target}. Los receptores no enviarán reportes.`,
              },
        );
      }
    }
  }
  for (const [k, mode] of [["adkim", t.adkim], ["aspf", t.aspf]] as const) {
    if (mode && !["r", "s"].includes(mode.toLowerCase())) out.checks.push({ status: "error", title: `${k}= inválido (use r o s)` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// SPF
// ---------------------------------------------------------------------------

export interface SpfNode {
  domain: string;
  record: string | null;
  lookups: number;
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
    node.error = "Bucle de includes";
    return node;
  }
  if (path.length > 10) {
    node.error = "Anidamiento excesivo";
    return node;
  }
  const records = await txt(domain);
  if (records === null) {
    node.error = "Error de DNS";
    return node;
  }
  const spf = records.filter((r) => /^v=spf1(\s|$)/i.test(r.trim()));
  if (spf.length === 0) {
    node.error = "Sin registro SPF";
    state.void++;
    return node;
  }
  if (spf.length > 1) node.error = "Múltiples registros SPF (permerror)";
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
      node.error = "Demasiadas consultas; análisis detenido";
      break;
    }
    const target = (m[3]?.split("/")[0] || domain).toLowerCase();
    if ((type === "include" || type === "redirect") && m[3] && !m[3].includes("%{")) {
      node.children.push(await resolveSpf(target, state, [...path, domain]));
    } else if (type === "mx") {
      const mx = await lookupOr(resolver.resolveMx(target), []);
      if (mx.length === 0) state.void++;
      // Each MX host needs an address lookup too; RFC 7208 caps them at 10.
      if (mx.length > 10) node.error = "Más de 10 registros MX en mecanismo mx";
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
    out.checks.push({ status: "error", title: "No hay registro SPF", detail: `Publique un TXT en ${domain} que empiece por "v=spf1".` });
    return out;
  }
  if (tree.error) out.checks.push({ status: "error", title: tree.error });

  const allMech = tree.mechanisms.find((m) => m.type === "all");
  const redirect = tree.mechanisms.find((m) => m.type === "redirect");
  out.all = allMech ? `${allMech.qualifier}all` : null;
  if (!allMech && !redirect) {
    out.checks.push({ status: "warning", title: "SPF sin mecanismo all", detail: "Termine el registro con ~all o -all." });
  } else if (allMech?.qualifier === "+") {
    out.checks.push({ status: "error", title: "SPF permite cualquier servidor (+all)", detail: "Cualquiera puede enviar como su dominio." });
  } else if (allMech?.qualifier === "?") {
    out.checks.push({ status: "warning", title: "SPF neutral (?all)", detail: "No ofrece protección; use ~all o -all." });
  } else if (allMech?.qualifier === "~") {
    out.checks.push({ status: "ok", title: "SPF termina en ~all (softfail)", detail: "Correcto con DMARC; -all es más estricto." });
  } else if (allMech?.qualifier === "-") {
    out.checks.push({ status: "ok", title: "SPF termina en -all (fail)" });
  }

  if (out.lookups > 10) {
    out.checks.push({ status: "error", title: `Demasiadas consultas DNS (${out.lookups}/10)`, detail: "SPF devuelve permerror. Elimine includes o aplane el registro." });
  } else if (out.lookups >= 8) {
    out.checks.push({ status: "warning", title: `Cerca del límite de consultas DNS (${out.lookups}/10)` });
  } else {
    out.checks.push({ status: "ok", title: `Consultas DNS: ${out.lookups}/10` });
  }
  if (out.voidLookups > 2) out.checks.push({ status: "error", title: `Demasiadas consultas vacías (${out.voidLookups}/2)`, detail: "Revise includes o dominios que no existen." });
  const walk = (n: SpfNode): SpfNode[] => [n, ...n.children.flatMap(walk)];
  const all = walk(tree);
  if (all.some((n) => n.mechanisms.some((m) => m.type === "ptr"))) {
    out.checks.push({ status: "warning", title: "Uso del mecanismo ptr (obsoleto)", detail: "RFC 7208 desaconseja ptr; es lento y poco fiable." });
  }
  for (const n of all.slice(1)) if (n.error) out.checks.push({ status: "warning", title: `include:${n.domain} — ${n.error}` });
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
    if (fromReports) out.checks.push({ status: "error", title: `Selector ${selector} no publicado`, detail: "Aparece en reportes pero no existe en DNS." });
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
    out.checks.push({ status: fromReports ? "warning" : "info", title: `Clave ${selector} revocada (p= vacío)` });
    return out;
  }
  const info = keyInfo(p, k);
  out.keyType = info.type;
  out.keyBits = info.bits;
  if (info.type === "rsa" && info.bits !== null) {
    if (info.bits < 1024) out.checks.push({ status: "error", title: `Clave RSA débil (${info.bits} bits)`, detail: "Los receptores la rechazan. Use 2048 bits." });
    else if (info.bits < 2048) out.checks.push({ status: "warning", title: `Clave RSA de ${info.bits} bits`, detail: "Recomendado: 2048 bits." });
    else out.checks.push({ status: "ok", title: `Clave RSA de ${info.bits} bits` });
  } else if (info.bits === null) {
    out.checks.push({ status: "error", title: "Clave pública ilegible", detail: "El valor p= no es una clave válida." });
  } else {
    out.checks.push({ status: "ok", title: `Clave ${info.type}` });
  }
  if (out.testing) out.checks.push({ status: "warning", title: "Selector en modo prueba (t=y)" });
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
    checks.push({
      status: "warning",
      title: "No se encontraron claves DKIM",
      detail: "Los selectores se detectan desde los reportes; si aún no hay reportes, añada el selector manualmente.",
    });
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
  if (hosts.length === 0) checks.push({ status: "info", title: "Sin registros MX", detail: "El dominio no recibe correo. Considere SPF \"v=spf1 -all\" y DMARC p=reject si tampoco envía." });
  else if (hosts.length === 1 && hosts[0]!.exchange === "") checks.push({ status: "info", title: "Null MX (RFC 7505): el dominio no acepta correo" });
  else checks.push({ status: "ok", title: `${hosts.length} servidor(es) MX` });
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
    checks.push({ status: "info", title: "MTA-STS no configurado", detail: "MTA-STS obliga a usar TLS para el correo entrante." });
    return { record, policy, checks };
  }
  const body = await fetchText(`https://mta-sts.${domain}/.well-known/mta-sts.txt`);
  if (!body) {
    checks.push({ status: "error", title: "Política MTA-STS inaccesible", detail: `No se pudo descargar https://mta-sts.${domain}/.well-known/mta-sts.txt` });
    return { record, policy, checks };
  }
  const lines = body.split(/\r?\n/).map((l) => l.split(":").map((s) => s.trim()));
  policy = {
    mode: lines.find((l) => l[0] === "mode")?.[1] ?? null,
    mx: lines.filter((l) => l[0] === "mx").map((l) => l[1] ?? ""),
    maxAge: Number(lines.find((l) => l[0] === "max_age")?.[1]) || null,
  };
  if (policy.mode === "enforce") checks.push({ status: "ok", title: "MTA-STS en modo enforce" });
  else if (policy.mode === "testing") checks.push({ status: "warning", title: "MTA-STS en modo testing" });
  else checks.push({ status: "warning", title: `MTA-STS en modo ${policy.mode ?? "desconocido"}` });
  return { record, policy, checks };
}

async function checkTlsRpt(domain: string) {
  const records = ((await txt(`_smtp._tls.${domain}`)) ?? []).filter((r) => /^v=TLSRPTv1/i.test(r));
  const record = records[0] ?? null;
  const rua = record ? (parseTags(record).rua ?? "").split(",").map((s) => s.trim()).filter(Boolean) : [];
  const checks: Check[] = record
    ? [{ status: "ok", title: "TLS-RPT configurado", detail: rua.join(", ") }]
    : [{ status: "info", title: "TLS-RPT no configurado", detail: "Recibiría reportes de fallos de TLS en la entrega." }];
  return { record, rua, checks };
}

async function checkBimi(domain: string, dmarcPolicy: string | undefined) {
  const records = ((await txt(`default._bimi.${domain}`)) ?? []).filter((r) => /^v=BIMI1/i.test(r));
  const record = records[0] ?? null;
  const t = record ? parseTags(record) : {};
  const checks: Check[] = [];
  if (!record) checks.push({ status: "info", title: "BIMI no configurado", detail: "Muestra el logo de la marca en clientes compatibles; requiere p=quarantine o reject." });
  else {
    checks.push({ status: "ok", title: "Registro BIMI publicado" });
    if (!dmarcPolicy || dmarcPolicy === "none") checks.push({ status: "warning", title: "BIMI requiere DMARC quarantine o reject" });
    if (!t.a) checks.push({ status: "info", title: "Sin certificado VMC/CMC (a=)", detail: "Gmail y Apple exigen certificado." });
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
