import { db, nowSec } from "./db/index.js";
import { detectComplianceDrops, notify } from "./alerts/index.js";
import { overview, defaultRange } from "./analysis/stats.js";
import { checkDueDomains } from "./dns/service.js";
import { enrichBacklog } from "./enrich/ip.js";
import { pollDueMailboxes } from "./ingest/imap.js";
import { t } from "./i18n/index.js";
import { logger } from "./lib/logger.js";
import { getSettings } from "./settings.js";

const timers: NodeJS.Timeout[] = [];
const busy = new Set<string>();

function every(name: string, ms: number, fn: () => Promise<void> | void, initialDelay = 5_000) {
  const run = async () => {
    if (busy.has(name)) return;
    busy.add(name);
    try {
      await fn();
    } catch (err) {
      logger.error({ err, task: name }, "scheduled task failed");
    } finally {
      busy.delete(name);
    }
  };
  timers.push(setTimeout(run, initialDelay));
  timers.push(setInterval(run, ms));
}

function getMarker(key: string): string | null {
  return db.get<{ value: string }>("SELECT value FROM settings WHERE key = ?", [`marker:${key}`])?.value ?? null;
}
function setMarker(key: string, value: string) {
  db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [`marker:${key}`, value]);
}

export function applyRetention() {
  const s = getSettings();
  if (s.retentionDays > 0) {
    const cutoff = nowSec() - s.retentionDays * 86400;
    const r = db.run("DELETE FROM reports WHERE end_ts < ?", [cutoff]);
    if (r.changes) logger.info({ deleted: r.changes }, "retention: removed old aggregate reports");
  }
  if (s.forensicRetentionDays > 0) {
    db.run("DELETE FROM forensic_reports WHERE received_at < ?", [nowSec() - s.forensicRetentionDays * 86400]);
  }
  db.run("DELETE FROM ingest_log WHERE ts < ?", [nowSec() - 90 * 86400]);
  db.run("DELETE FROM alerts WHERE created_at < ?", [nowSec() - 365 * 86400]);
  db.run("DELETE FROM sessions WHERE expires_at < ?", [nowSec()]);
}

async function weeklyDigest() {
  const now = new Date();
  const week = `${now.getUTCFullYear()}-W${Math.ceil(((+now - Date.UTC(now.getUTCFullYear(), 0, 1)) / 86400_000 + 1) / 7)}`;
  if (!getSettings().notifications.weeklyDigest || now.getDay() !== 1 || now.getHours() < 8 || getMarker("digest") === week) return;
  setMarker("digest", week);
  const range = defaultRange(7);
  const locale = getSettings().language;
  const lines: string[] = [];
  for (const d of db.all<{ id: number; name: string }>("SELECT id, name FROM domains ORDER BY name")) {
    const o = overview({ domainId: d.id, ...range });
    if (!o.messages) continue;
    lines.push(`• ${t(locale, "alert.digest.line", { domain: d.name, messages: o.messages, compliance: o.compliance, fail: o.categories.fail })}`);
  }
  if (lines.length) await notify(t(locale, "alert.digest.title"), lines.join("\n"), "info");
}

async function daily() {
  const today = new Date().toISOString().slice(0, 10);
  if (getMarker("daily") === today) return;
  setMarker("daily", today);
  applyRetention();
  detectComplianceDrops();
  db.exec("PRAGMA optimize");
}

export function startScheduler() {
  every("imap", 60_000, pollDueMailboxes, 10_000);
  every("dns", 10 * 60_000, checkDueDomains, 20_000);
  every("enrich", 15 * 60_000, enrichBacklog, 15_000);
  every("daily", 30 * 60_000, daily, 30_000);
  every("digest", 30 * 60_000, weeklyDigest, 60_000);
  logger.info("scheduler started");
}

export function stopScheduler() {
  for (const t of timers) clearInterval(t);
}
