import type { Category, CheckStatus, SourceStatus } from "./types";

const nf = new Intl.NumberFormat("es");
const compact = new Intl.NumberFormat("es", { notation: "compact", maximumFractionDigits: 1 });

export const num = (n: number | null | undefined) => (n === null || n === undefined ? "—" : nf.format(n));
export const short = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n < 10000 ? nf.format(n) : compact.format(n));
export const pct = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined ? "—" : `${n.toLocaleString("es", { maximumFractionDigits: digits, minimumFractionDigits: n % 1 === 0 ? 0 : Math.min(1, digits) })}%`;
export const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export function date(ts: number | null | undefined, withTime = false) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("es", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

/**
 * Aggregate report windows are defined in UTC (usually 00:00–23:59:59), so
 * they are shown in UTC to avoid a single day looking like two.
 */
export function period(begin: number, end: number, withTime = false) {
  const opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", timeZone: "UTC", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) };
  const b = new Date(begin * 1000).toLocaleString("es", opts);
  // end_ts is inclusive (…:59:59); subtract a second so a full day stays one day.
  const e = new Date(Math.max(begin, end - 1) * 1000).toLocaleString("es", opts);
  return `${b === e ? b : `${b} – ${e}`}${withTime ? " UTC" : ""}`;
}

export function day(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("es", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function ago(ts: number | null | undefined) {
  if (!ts) return "nunca";
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return "hace un momento";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 30) return `hace ${Math.floor(s / 86400)} d`;
  return date(ts);
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${u[i]}`;
}

export const CATEGORY: Record<Category, { label: string; hint: string; color: string }> = {
  pass: { label: "Autenticado", hint: "Pasa DMARC con SPF o DKIM alineado", color: "var(--c-pass)" },
  forwarded: { label: "Reenviado", hint: "Correo legítimo reenviado o de listas de correo", color: "var(--c-forwarded)" },
  misaligned: { label: "Sin alinear", hint: "Pasa SPF/DKIM pero con otro dominio: servicio legítimo mal configurado", color: "var(--c-misaligned)" },
  fail: { label: "No autenticado", hint: "Falla SPF y DKIM: posible suplantación", color: "var(--c-fail)" },
};

export const SOURCE_STATUS: Record<SourceStatus, { label: string; tone: Tone }> = {
  authorized: { label: "Autorizado", tone: "pass" },
  forwarder: { label: "Reenviador", tone: "forwarded" },
  needs_config: { label: "Requiere configuración", tone: "misaligned" },
  suspicious: { label: "Sospechoso", tone: "fail" },
  mixed: { label: "Mixto", tone: "neutral" },
};

export type Tone = "pass" | "forwarded" | "misaligned" | "fail" | "neutral" | "brand";

export const CHECK_TONE: Record<CheckStatus, Tone> = { ok: "pass", info: "forwarded", warning: "misaligned", error: "fail" };

export function healthTone(score: number | null | undefined): Tone {
  if (score === null || score === undefined) return "neutral";
  if (score >= 85) return "pass";
  if (score >= 60) return "misaligned";
  return "fail";
}

export const POLICY_LABEL: Record<string, string> = { none: "Monitoreo", quarantine: "Cuarentena", reject: "Rechazo" };

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(["es"], { type: "region" });
  } catch {
    return null;
  }
})();

export function countryName(cc: string | null | undefined) {
  if (!cc || cc === "??") return "Desconocido";
  try {
    return regionNames?.of(cc.toUpperCase()) ?? cc;
  } catch {
    return cc;
  }
}

export function flag(cc: string | null | undefined) {
  if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return "🌐";
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}
