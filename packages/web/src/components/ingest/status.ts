import type { Tone } from "@/lib/format";

export type LogStatus = "ok" | "duplicate" | "error" | "ignored";

export const LOG_STATUS: Record<LogStatus, { label: string; tone: Tone }> = {
  ok: { label: "Correcto", tone: "pass" },
  duplicate: { label: "Duplicado", tone: "neutral" },
  error: { label: "Error", tone: "fail" },
  ignored: { label: "Ignorado", tone: "misaligned" },
};

/** Lowercase plural form used in count badges ("3 duplicados"). */
export const LOG_STATUS_COUNT: Record<LogStatus, string> = {
  ok: "correctos",
  duplicate: "duplicados",
  error: "con error",
  ignored: "ignorados",
};

export const KIND_LABEL: Record<string, string> = {
  aggregate: "Agregado",
  forensic: "Forense",
  unknown: "Desconocido",
};
