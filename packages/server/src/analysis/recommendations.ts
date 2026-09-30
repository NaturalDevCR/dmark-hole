import { db, json } from "../db/index.js";
import type { DnsReport } from "../dns/checks.js";
import { defaultRange, overview, providers, sources } from "./stats.js";

export interface Recommendation {
  id: string;
  severity: "critical" | "warning" | "info" | "success";
  title: string;
  detail: string;
  /** Suggested DNS record or action, when applicable. */
  action?: string;
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
export function recommendations(domainId: number): Recommendation[] {
  const d = db.get<{ name: string; dns_result: string | null }>("SELECT name, dns_result FROM domains WHERE id = ?", [domainId]);
  if (!d) return [];
  const dns = json<DnsReport | null>(d.dns_result, null);
  const range = defaultRange(30);
  const ov = overview({ domainId, ...range });
  const provs = providers({ domainId, ...range });
  const recs: Recommendation[] = [];
  const policy = dns?.dmarc.tags.p?.toLowerCase();

  if (!dns) {
    recs.push({ id: "dns-pending", severity: "info", title: "Verificación DNS pendiente", detail: "Ejecute una verificación DNS para obtener recomendaciones completas." });
  } else {
    if (!dns.dmarc.record) {
      recs.push({
        id: "dmarc-missing",
        severity: "critical",
        title: "Publique un registro DMARC",
        detail: "Sin DMARC los receptores no envían reportes y el dominio puede ser suplantado.",
        action: `_dmarc.${d.name}  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@${d.name}; fo=1"`,
      });
    }
    if (dns.dmarc.record && dns.dmarc.rua.length === 0) {
      recs.push({ id: "dmarc-rua", severity: "critical", title: "Agregue rua= al registro DMARC", detail: "Sin rua no llegarán reportes agregados a esta herramienta." });
    }
    if (!dns.spf.record) {
      recs.push({ id: "spf-missing", severity: "critical", title: "Publique un registro SPF", detail: "Declare los servidores autorizados a enviar como su dominio.", action: `${d.name}  TXT  "v=spf1 mx ~all"` });
    } else if (dns.spf.lookups > 10) {
      recs.push({ id: "spf-lookups", severity: "critical", title: `SPF excede 10 consultas DNS (${dns.spf.lookups})`, detail: "Los receptores devuelven permerror y SPF falla para todo el correo. Elimine includes de servicios que no usa o use subdominios para servicios de terceros." });
    } else if (dns.spf.all === "+all" || dns.spf.all === "?all") {
      recs.push({ id: "spf-all", severity: "warning", title: `SPF termina en ${dns.spf.all}`, detail: "Cambie a ~all o -all para que SPF tenga efecto." });
    }
    for (const s of dns.dkim.selectors) {
      if (s.fromReports && !s.found) {
        recs.push({ id: `dkim-missing-${s.selector}`, severity: "warning", title: `Selector DKIM ${s.selector} no existe en DNS`, detail: `Los reportes muestran firmas con ${s.selector}._domainkey.${s.domain}, pero la clave no está publicada.` });
      } else if (s.found && s.keyBits !== null && s.keyType === "rsa" && s.keyBits < 2048) {
        recs.push({ id: `dkim-weak-${s.selector}`, severity: s.keyBits < 1024 ? "critical" : "warning", title: `Rote la clave DKIM ${s.selector} a 2048 bits`, detail: `La clave actual es de ${s.keyBits} bits.` });
      }
    }
    if (dns.dmarc.tags.sp === "none" && policy && policy !== "none") {
      recs.push({ id: "dmarc-sp", severity: "warning", title: "Proteja los subdominios", detail: "sp=none deja los subdominios sin protección.", action: suggestedDmarc(dns.dmarc.tags, policy) });
    }
    if (!dns.mtaSts.record) recs.push({ id: "mta-sts", severity: "info", title: "Considere MTA-STS y TLS-RPT", detail: "Protegen el correo entrante contra ataques de degradación de TLS." });
  }

  // Report-driven recommendations.
  const misaligned = provs.filter((p) => p.misaligned > 0 && p.misaligned / p.messages > 0.2 && p.messages >= 10);
  for (const p of misaligned.slice(0, 5)) {
    recs.push({
      id: `align-${p.name}`,
      severity: policy === "reject" || policy === "quarantine" ? "critical" : "warning",
      title: `Alinee ${p.name}`,
      detail: `${p.misaligned.toLocaleString()} mensajes de ${p.name} pasan SPF/DKIM pero con otro dominio, por lo que fallan DMARC. Configure DKIM personalizado (dominio propio) o un Return-Path en su dominio en ese servicio.`,
    });
  }
  const failing = sources({ domainId, ...range, category: "suspicious", limit: 1_000_000 });
  const failingMsgs = failing.reduce((a, s) => a + s.fail, 0);
  if (failingMsgs > 0) {
    const protectedNow = policy === "reject" || policy === "quarantine";
    recs.push({
      id: "spoofing",
      severity: protectedNow ? "info" : "warning",
      title: `${failingMsgs.toLocaleString()} mensajes de ${failing.length} fuentes no autenticadas`,
      detail: protectedNow
        ? `Su política ${policy} está bloqueando estos intentos. Revise la lista por si alguna fuente es legítima.`
        : "Posible suplantación o servicios legítimos sin configurar. Revíselas antes de endurecer la política.",
    });
  }

  if (dns?.dmarc.record && ov.messages >= 100 && ov.compliance !== null) {
    const tags = dns.dmarc.tags;
    const pctTag = tags.pct ? Number(tags.pct) : 100;
    if (policy === "none" && ov.compliance >= 98) {
      recs.push({ id: "raise-quarantine", severity: "success", title: "Listo para p=quarantine", detail: `${ov.compliance}% de cumplimiento en 30 días. Puede endurecer la política con seguridad.`, action: `_dmarc.${d.name}  TXT  "${suggestedDmarc(tags, "quarantine")}"` });
    } else if (policy === "none" && ov.compliance < 98) {
      recs.push({ id: "fix-before-enforce", severity: "info", title: `Cumplimiento ${ov.compliance}%: alinee fuentes antes de endurecer`, detail: "Apunte a ≥98% de correo legítimo alineado antes de pasar a quarantine." });
    } else if (policy === "quarantine" && pctTag < 100 && ov.compliance >= 98) {
      recs.push({ id: "raise-pct", severity: "success", title: `Suba pct de ${pctTag} a 100`, detail: "El cumplimiento es alto; aplique la política a todo el correo.", action: `_dmarc.${d.name}  TXT  "${suggestedDmarc({ ...tags, pct: "" }, "quarantine")}"` });
    } else if (policy === "quarantine" && pctTag === 100 && ov.compliance >= 99) {
      recs.push({ id: "raise-reject", severity: "success", title: "Listo para p=reject", detail: `${ov.compliance}% de cumplimiento en 30 días.`, action: `_dmarc.${d.name}  TXT  "${suggestedDmarc(tags, "reject")}"` });
    } else if (policy === "reject" && ov.compliance >= 99) {
      recs.push({ id: "all-good", severity: "success", title: "Protección DMARC completa", detail: "Política reject con alto cumplimiento. Mantenga el monitoreo de nuevas fuentes." });
    }
  } else if (ov.messages === 0) {
    recs.push({ id: "no-data", severity: "info", title: "Aún no hay reportes en los últimos 30 días", detail: "Los receptores envían reportes una vez al día. Verifique el rua y la configuración de ingesta." });
  }

  const order = { critical: 0, warning: 1, info: 2, success: 3 };
  return recs.sort((a, b) => order[a.severity] - order[b.severity]);
}
