import { currentLocale, t } from "@/i18n";
import type { Category, CheckStatus, SourceStatus } from "./types";

/*
 * All formatters read the active UI locale on every call, so they re-render
 * correctly when the user switches language (the locale is reactive).
 */

const cache = new Map<string, Intl.NumberFormat>();
function nf(opts: Intl.NumberFormatOptions = {}) {
  const key = `${currentLocale()}|${JSON.stringify(opts)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(currentLocale(), opts);
    cache.set(key, f);
  }
  return f;
}

export const num = (n: number | null | undefined) => (n === null || n === undefined ? "—" : nf().format(n));
export const short = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n < 10000 ? nf().format(n) : nf({ notation: "compact", maximumFractionDigits: 1 }).format(n);
export const pct = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined
    ? "—"
    : `${nf({ maximumFractionDigits: digits, minimumFractionDigits: n % 1 === 0 ? 0 : Math.min(1, digits) }).format(n)}%`;
export const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export function date(ts: number | null | undefined, withTime = false) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString(currentLocale(), {
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
  const b = new Date(begin * 1000).toLocaleString(currentLocale(), opts);
  // end_ts is inclusive (…:59:59); subtract a second so a full day stays one day.
  const e = new Date(Math.max(begin, end - 1) * 1000).toLocaleString(currentLocale(), opts);
  return `${b === e ? b : `${b} – ${e}`}${withTime ? " UTC" : ""}`;
}

export function day(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(currentLocale(), { month: "short", day: "numeric", timeZone: "UTC" });
}

export function ago(ts: number | null | undefined) {
  if (!ts) return t("common.time.never");
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return t("common.time.justNow");
  if (s < 3600) return t("common.time.minutesAgo", { n: Math.floor(s / 60) });
  if (s < 86400) return t("common.time.hoursAgo", { n: Math.floor(s / 3600) });
  if (s < 86400 * 30) return t("common.time.daysAgo", { n: Math.floor(s / 86400) });
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

function category(c: Category, color: string) {
  return {
    get label() {
      return t(`common.category.${c}.label`);
    },
    get hint() {
      return t(`common.category.${c}.hint`);
    },
    color,
  };
}

/** Labels are getters so they follow the active locale. */
export const CATEGORY: Record<Category, { readonly label: string; readonly hint: string; color: string }> = {
  pass: category("pass", "var(--c-pass)"),
  forwarded: category("forwarded", "var(--c-forwarded)"),
  misaligned: category("misaligned", "var(--c-misaligned)"),
  fail: category("fail", "var(--c-fail)"),
};

export type Tone = "pass" | "forwarded" | "misaligned" | "fail" | "neutral" | "brand";

function status(s: SourceStatus, tone: Tone) {
  return {
    get label() {
      return t(`common.sourceStatus.${s}`);
    },
    tone,
  };
}

export const SOURCE_STATUS: Record<SourceStatus, { readonly label: string; tone: Tone }> = {
  authorized: status("authorized", "pass"),
  forwarder: status("forwarder", "forwarded"),
  needs_config: status("needs_config", "misaligned"),
  suspicious: status("suspicious", "fail"),
  mixed: status("mixed", "neutral"),
};

export const CHECK_TONE: Record<CheckStatus, Tone> = { ok: "pass", info: "forwarded", warning: "misaligned", error: "fail" };

export function healthTone(score: number | null | undefined): Tone {
  if (score === null || score === undefined) return "neutral";
  if (score >= 85) return "pass";
  if (score >= 60) return "misaligned";
  return "fail";
}

export const policyLabel = (p: string) => t(`common.policy.${p}`);

const regionNames = new Map<string, Intl.DisplayNames | null>();
export function countryName(cc: string | null | undefined) {
  if (!cc || cc === "??") return t("common.unknown");
  const loc = currentLocale();
  if (!regionNames.has(loc)) {
    try {
      regionNames.set(loc, new Intl.DisplayNames([loc], { type: "region" }));
    } catch {
      regionNames.set(loc, null);
    }
  }
  try {
    return regionNames.get(loc)?.of(cc.toUpperCase()) ?? cc;
  } catch {
    return cc;
  }
}

export function flag(cc: string | null | undefined) {
  if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return "🌐";
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}
