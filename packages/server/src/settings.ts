import { z } from "zod";
import { config } from "./config.js";
import { db } from "./db/index.js";

export const settingsSchema = z.object({
  /** Create domains automatically when a report arrives for an unknown policy_domain. */
  autoCreateDomains: z.boolean(),
  /** Keep the raw XML of every report (compressed) so it can be downloaded later. */
  storeRawXml: z.boolean(),
  /** Days to keep aggregate report data. 0 = forever. */
  retentionDays: z.number().int().min(0).max(3650),
  /** Days to keep forensic (RUF) reports; they contain personal data. 0 = forever. */
  forensicRetentionDays: z.number().int().min(0).max(3650),
  /** Reverse DNS + ASN/country lookups (Team Cymru over DNS) for source IPs. */
  enrichment: z.boolean(),
  /** Hours between automatic DNS checks for every domain. 0 = disabled. */
  dnsCheckHours: z.number().int().min(0).max(24 * 30),
  smtpReceiver: z.object({
    enabled: z.boolean(),
    /** Optional allow-list of RCPT TO addresses. Empty = accept any recipient. */
    allowedRecipients: z.array(z.string()),
  }),
  alerts: z.object({
    enabled: z.boolean(),
    /** Minimum messages from a new failing source before it raises an alert. */
    newSourceMinMessages: z.number().int().min(1),
    /** Raise an alert when a domain's DMARC compliance for a day drops below this %. */
    complianceThreshold: z.number().min(0).max(100),
    minSeverity: z.enum(["info", "warning", "critical"]),
  }),
  notifications: z.object({
    webhookUrl: z.string(),
    /** Payload shape: auto-detects Slack/Discord/Teams/ntfy/Gotify from the URL. */
    webhookFormat: z.enum(["auto", "slack", "discord", "teams", "generic"]),
    email: z.object({
      enabled: z.boolean(),
      host: z.string(),
      port: z.number().int(),
      secure: z.boolean(),
      username: z.string(),
      password: z.string(),
      from: z.string(),
      to: z.string(),
    }),
    /** Send a weekly digest (Monday 08:00 server time) to the notification channels. */
    weeklyDigest: z.boolean(),
  }),
});

export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = {
  autoCreateDomains: true,
  storeRawXml: true,
  retentionDays: 365,
  forensicRetentionDays: 30,
  enrichment: true,
  dnsCheckHours: 12,
  smtpReceiver: { enabled: config.smtp.enabled, allowedRecipients: [] },
  alerts: {
    enabled: true,
    newSourceMinMessages: 5,
    complianceThreshold: 90,
    minSeverity: "warning",
  },
  notifications: {
    webhookUrl: "",
    webhookFormat: "auto",
    email: { enabled: false, host: "", port: 587, secure: false, username: "", password: "", from: "", to: "" },
    weeklyDigest: false,
  },
};

type Listener = (next: Settings, prev: Settings) => void;
const listeners: Listener[] = [];
let cached: Settings | null = null;

function deepMerge<T>(base: T, patch: unknown): T {
  if (typeof base !== "object" || base === null || Array.isArray(base)) {
    return (patch === undefined ? base : patch) as T;
  }
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (k in out) out[k] = deepMerge(out[k], v);
  }
  return out as T;
}

export function getSettings(): Settings {
  if (cached) return cached;
  const row = db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'app'");
  let stored: unknown = {};
  try {
    stored = row ? JSON.parse(row.value) : {};
  } catch {
    stored = {};
  }
  const merged = deepMerge(defaultSettings, stored);
  const parsed = settingsSchema.safeParse(merged);
  cached = parsed.success ? parsed.data : defaultSettings;
  return cached;
}

export function updateSettings(patch: unknown): Settings {
  const prev = getSettings();
  const next = settingsSchema.parse(deepMerge(prev, patch));
  db.run(
    "INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [JSON.stringify(next)],
  );
  cached = next;
  for (const l of listeners) {
    try {
      l(next, prev);
    } catch {
      /* listeners must not break settings writes */
    }
  }
  return next;
}

export function onSettingsChange(fn: Listener): void {
  listeners.push(fn);
}
