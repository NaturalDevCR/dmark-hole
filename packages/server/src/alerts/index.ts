import nodemailer from "nodemailer";
import { db, nowSec } from "../db/index.js";
import { onDnsChange } from "../dns/service.js";
import { events } from "../lib/events.js";
import { logger } from "../lib/logger.js";
import { getSettings, smtpPassword } from "../settings.js";
import { renderAlert } from "./render.js";

export type Severity = "info" | "warning" | "critical";
const RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };

export interface NewAlert {
  domainId: number | null;
  type: string;
  severity: Severity;
  /** Everything needed to render the text (see alerts/render.ts); also stored with the alert. */
  data: Record<string, unknown>;
  /** Alerts with the same key within `dedupHours` are dropped. */
  dedupKey?: string;
  dedupHours?: number;
}

export function raiseAlert(a: NewAlert): number | null {
  const settings = getSettings();
  // Stored text is English (back-compat for readers of the columns); the UI re-renders it
  // per request locale and notifications use the configured language.
  const stored = renderAlert("en", a.type, a.data) ?? { title: a.type, message: "" };
  const outgoing = renderAlert(settings.language, a.type, a.data) ?? stored;
  if (!settings.alerts.enabled) return null;
  if (a.dedupKey) {
    const recent = db.get("SELECT 1 FROM alerts WHERE dedup_key = ? AND created_at > ?", [a.dedupKey, nowSec() - (a.dedupHours ?? 24) * 3600]);
    if (recent) return null;
  }
  const r = db.run(
    "INSERT INTO alerts (domain_id, type, severity, title, message, data, dedup_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [a.domainId, a.type, a.severity, stored.title, stored.message, JSON.stringify(a.data), a.dedupKey ?? null, nowSec()],
  );
  if (RANK[a.severity] >= RANK[settings.alerts.minSeverity]) {
    notify(outgoing.title, outgoing.message, a.severity)
      .then(() => db.run("UPDATE alerts SET notified_at = ? WHERE id = ?", [nowSec(), r.lastInsertRowid]))
      .catch((err) => logger.warn({ err: (err as Error).message }, "alert notification failed"));
  }
  return r.lastInsertRowid;
}

// ---------------------------------------------------------------------------
// Notification channels
// ---------------------------------------------------------------------------

const EMOJI: Record<Severity, string> = { info: "ℹ️", warning: "⚠️", critical: "🚨" };

function webhookPayload(url: string, format: string, title: string, message: string, severity: Severity) {
  const fmt =
    format !== "auto"
      ? format
      : /hooks\.slack\.com/.test(url)
        ? "slack"
        : /discord(app)?\.com\/api\/webhooks/.test(url)
          ? "discord"
          : /webhook\.office\.com|logic\.azure\.com|powerautomate/.test(url)
            ? "teams"
            : "generic";
  const text = `${EMOJI[severity]} *${title}*\n${message}`;
  switch (fmt) {
    case "slack":
      return { text };
    case "discord":
      return { content: text.replace(/\*/g, "**").slice(0, 1900) };
    case "teams":
      return {
        type: "message",
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: {
              type: "AdaptiveCard",
              version: "1.4",
              body: [
                { type: "TextBlock", text: `${EMOJI[severity]} ${title}`, weight: "Bolder", size: "Medium", wrap: true },
                { type: "TextBlock", text: message, wrap: true },
              ],
            },
          },
        ],
      };
    default:
      return { source: "dmark-hole", severity, title, message, timestamp: new Date().toISOString() };
  }
}

export async function notify(title: string, message: string, severity: Severity = "info") {
  const n = getSettings().notifications;
  const tasks: Promise<unknown>[] = [];
  if (n.webhookUrl) {
    tasks.push(
      fetch(n.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(webhookPayload(n.webhookUrl, n.webhookFormat, title, message, severity)),
        signal: AbortSignal.timeout(10_000),
      }).then((r) => {
        if (!r.ok) throw new Error(`Webhook HTTP ${r.status}`);
      }),
    );
  }
  if (n.email.enabled && n.email.host && n.email.to) {
    const transport = nodemailer.createTransport({
      host: n.email.host,
      port: n.email.port,
      secure: n.email.secure,
      auth: n.email.username ? { user: n.email.username, pass: smtpPassword() } : undefined,
    });
    tasks.push(
      transport.sendMail({
        from: n.email.from || n.email.username,
        to: n.email.to,
        subject: `[DMARK-Hole] ${title}`,
        text: message,
      }),
    );
  }
  const results = await Promise.allSettled(tasks);
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed.length) throw new Error(failed.map((f) => (f.reason as Error).message).join("; "));
}

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

/** After each report: flag IPs never seen before that send failing mail for our domain. */
function detectNewFailingSources(reportId: number, domainId: number, domain: string) {
  const min = getSettings().alerts.newSourceMinMessages;
  const candidates = db.all<{ source_ip: string; fail: number; total: number; begin_ts: number }>(
    `SELECT source_ip, SUM(CASE WHEN dmarc_pass = 0 THEN count ELSE 0 END) fail, SUM(count) total, MIN(begin_ts) begin_ts
     FROM records WHERE report_id = ? GROUP BY source_ip HAVING fail >= ?`,
    [reportId, min],
  );
  // Without history every sender looks new; stay quiet during the first days of a domain.
  const history = db.get("SELECT 1 FROM records WHERE domain_id = ? AND report_id != ? AND begin_ts < ? LIMIT 1", [
    domainId,
    reportId,
    (candidates[0]?.begin_ts ?? 0) - 3 * 86400,
  ]);
  if (!history) return;
  for (const c of candidates) {
    const seenBefore = db.get(
      "SELECT 1 FROM records WHERE domain_id = ? AND source_ip = ? AND report_id != ? AND begin_ts < ? AND begin_ts > ? LIMIT 1",
      [domainId, c.source_ip, reportId, c.begin_ts, c.begin_ts - 90 * 86400],
    );
    if (seenBefore) continue;
    const info = db.get<{ ptr: string | null; provider: string | null; country: string | null }>("SELECT ptr, provider, country FROM ip_info WHERE ip = ?", [c.source_ip]);
    raiseAlert({
      domainId,
      type: "new_failing_source",
      severity: c.fail >= min * 10 ? "critical" : "warning",
      data: { domain, ip: c.source_ip, origin: info?.provider ?? info?.ptr ?? null, country: info?.country ?? null, fail: c.fail, total: c.total, reportId },
      dedupKey: `new_failing_source:${domainId}:${c.source_ip}`,
      dedupHours: 24 * 7,
    });
  }
}

/**
 * Daily: compliance below threshold. Checks the day before yesterday because
 * reporters send day D's report during D+1, so yesterday is still incomplete.
 */
export function detectComplianceDrops() {
  const { complianceThreshold } = getSettings().alerts;
  const day = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
  const rows = db.all<{ domain_id: number; name: string; pass: number; total: number }>(
    `SELECT r.domain_id, d.name, SUM(CASE WHEN r.dmarc_pass = 1 THEN r.count ELSE 0 END) pass, SUM(r.count) total
     FROM records r JOIN domains d ON d.id = r.domain_id WHERE r.day = ? GROUP BY r.domain_id HAVING total >= 20`,
    [day],
  );
  for (const r of rows) {
    const rate = (r.pass / r.total) * 100;
    if (rate >= complianceThreshold) continue;
    raiseAlert({
      domainId: r.domain_id,
      type: "compliance_drop",
      severity: rate < complianceThreshold - 20 ? "critical" : "warning",
      data: { domain: r.name, day, pass: r.pass, total: r.total, rate: Math.round(rate * 10) / 10, threshold: complianceThreshold },
      dedupKey: `compliance_drop:${r.domain_id}:${day}`,
      dedupHours: 48,
    });
  }
}

export function initAlerts() {
  events.on("report:stored", (e) => {
    try {
      detectNewFailingSources(e.reportId, e.domainId, e.domain);
    } catch (err) {
      logger.error({ err }, "alert detection failed");
    }
  });
  events.on("forensic:stored", (e) => {
    raiseAlert({
      domainId: e.domainId,
      type: "forensic_report",
      severity: "info",
      data: {},
      dedupKey: `forensic:${e.domainId}`,
      dedupHours: 6,
    });
  });
  onDnsChange((c) => {
    const changed = Object.keys(c.after).filter((k) => JSON.stringify(c.before[k]) !== JSON.stringify(c.after[k]));
    const critical = changed.includes("dmarc") || changed.includes("spf");
    raiseAlert({
      domainId: c.domainId,
      type: "dns_change",
      severity: critical ? "warning" : "info",
      data: { domain: c.domain, changed, before: c.before, after: c.after },
    });
  });
}
