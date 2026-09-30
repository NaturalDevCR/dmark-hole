import { i18n, t } from "@/i18n";
import { num, type Tone } from "@/lib/format";

export type LogStatus = "ok" | "duplicate" | "error" | "ignored";

function logStatus(s: LogStatus, tone: Tone) {
  return {
    get label() {
      return t(`ingest.status.${s}`);
    },
    tone,
  };
}

/** Labels are getters so they follow the active locale. */
export const LOG_STATUS: Record<LogStatus, { readonly label: string; tone: Tone }> = {
  ok: logStatus("ok", "pass"),
  duplicate: logStatus("duplicate", "neutral"),
  error: logStatus("error", "fail"),
  ignored: logStatus("ignored", "misaligned"),
};

/** Lowercase count phrase used in count badges ("3 duplicates"). */
export const logStatusCount = (s: LogStatus, n: number) => i18n.global.t(`ingest.statusCount.${s}`, { n: num(n) }, n);

export function kindLabel(kind: string): string {
  return kind === "aggregate" || kind === "forensic" || kind === "unknown" ? t(`ingest.kind.${kind}`) : kind;
}
