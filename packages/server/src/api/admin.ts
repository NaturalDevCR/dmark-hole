import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { notify } from "../alerts/index.js";
import { config } from "../config.js";
import { db, nowSec } from "../db/index.js";
import { enrichmentStatus } from "../enrich/ip.js";
import { isMailboxRunning, runMailbox, testMailbox, type MailboxRow } from "../ingest/imap.js";
import { smtpStatus } from "../ingest/smtp.js";
import { ingestBlob } from "../ingest/store.js";
import { decrypt, encrypt, randomToken, sha256 } from "../lib/crypto.js";
import { getSettings, updateSettings, type Settings } from "../settings.js";
import { HttpError, requireAdmin } from "./auth.js";

const MASK = "••••••••";

const mailboxBody = z.object({
  name: z.string().trim().min(1).max(100),
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535).default(993),
  secure: z.boolean().default(true),
  username: z.string().trim().min(1).max(255),
  password: z.string().max(1000).optional(),
  folder: z.string().trim().min(1).max(255).default("INBOX"),
  afterAction: z.enum(["seen", "move", "delete"]).default("move"),
  processedFolder: z.string().trim().min(1).max(255).default("DMARC/Processed"),
  failedFolder: z.string().trim().min(1).max(255).default("DMARC/Failed"),
  onlyUnseen: z.boolean().default(true),
  tlsRejectUnauthorized: z.boolean().default(true),
  enabled: z.boolean().default(true),
  pollMinutes: z.coerce.number().int().min(1).max(1440).default(15),
});

// Marking as seen while reading every message would re-download the same mails forever.
function checkMailbox<T extends { onlyUnseen: boolean; afterAction: string }>(b: T): T {
  if (!b.onlyUnseen && b.afterAction === "seen") {
    throw new HttpError(400, "Con «marcar como leído» debe procesar solo mensajes no leídos; use «mover» para procesar todos");
  }
  return b;
}

function mailboxOut(m: MailboxRow & Record<string, unknown>) {
  return {
    id: m.id,
    name: m.name,
    host: m.host,
    port: m.port,
    secure: !!m.secure,
    username: m.username,
    folder: m.folder,
    afterAction: m.after_action,
    processedFolder: m.processed_folder,
    failedFolder: m.failed_folder,
    onlyUnseen: !!m.only_unseen,
    tlsRejectUnauthorized: !!m.tls_reject_unauthorized,
    enabled: !!m.enabled,
    pollMinutes: m.poll_minutes,
    lastRunAt: m.last_run_at,
    lastStatus: m.last_status,
    lastError: m.last_error,
    totalMessages: m.total_messages,
    totalReports: m.total_reports,
    running: isMailboxRunning(m.id),
  };
}

function maskSettings(s: Settings) {
  return {
    ...s,
    notifications: { ...s.notifications, email: { ...s.notifications.email, password: s.notifications.email.password ? MASK : "" } },
  };
}

function ingestToken(): string {
  const row = db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'ingest_token'");
  if (row) return row.value;
  const token = randomToken(24);
  db.run("INSERT INTO settings (key, value) VALUES ('ingest_token', ?)", [token]);
  return token;
}

export async function adminRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------- mailboxes
  app.get("/api/mailboxes", async () => db.all<MailboxRow & Record<string, unknown>>("SELECT * FROM mailboxes ORDER BY name").map(mailboxOut));

  app.post("/api/mailboxes", async (req) => {
    requireAdmin(req);
    const b = checkMailbox(mailboxBody.parse(req.body));
    if (!b.password) throw new HttpError(400, "La contraseña es obligatoria");
    const r = db.run(
      `INSERT INTO mailboxes (name, host, port, secure, username, password_enc, folder, after_action, processed_folder, failed_folder,
         only_unseen, tls_reject_unauthorized, enabled, poll_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [b.name, b.host, b.port, b.secure ? 1 : 0, b.username, encrypt(b.password), b.folder, b.afterAction, b.processedFolder, b.failedFolder,
        b.onlyUnseen ? 1 : 0, b.tlsRejectUnauthorized ? 1 : 0, b.enabled ? 1 : 0, b.pollMinutes, nowSec()],
    );
    return { id: r.lastInsertRowid };
  });

  app.put<{ Params: { id: string } }>("/api/mailboxes/:id", async (req) => {
    requireAdmin(req);
    const id = Number(req.params.id);
    const b = checkMailbox(mailboxBody.parse(req.body));
    const existing = db.get<MailboxRow>("SELECT * FROM mailboxes WHERE id = ?", [id]);
    if (!existing) throw new HttpError(404, "Buzón no encontrado");
    const pw = b.password && b.password !== MASK ? encrypt(b.password) : existing.password_enc;
    db.run(
      `UPDATE mailboxes SET name = ?, host = ?, port = ?, secure = ?, username = ?, password_enc = ?, folder = ?, after_action = ?,
         processed_folder = ?, failed_folder = ?, only_unseen = ?, tls_reject_unauthorized = ?, enabled = ?, poll_minutes = ? WHERE id = ?`,
      [b.name, b.host, b.port, b.secure ? 1 : 0, b.username, pw, b.folder, b.afterAction, b.processedFolder, b.failedFolder,
        b.onlyUnseen ? 1 : 0, b.tlsRejectUnauthorized ? 1 : 0, b.enabled ? 1 : 0, b.pollMinutes, id],
    );
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/mailboxes/:id", async (req) => {
    requireAdmin(req);
    db.run("DELETE FROM mailboxes WHERE id = ?", [Number(req.params.id)]);
    return { ok: true };
  });

  /** Test a mailbox config before saving; `id` lets the UI reuse a stored password. */
  app.post("/api/mailboxes/test", async (req) => {
    requireAdmin(req);
    const b = mailboxBody.extend({ id: z.number().int().optional() }).parse(req.body);
    let password = b.password && b.password !== MASK ? b.password : null;
    if (!password && b.id) {
      const row = db.get<{ password_enc: string }>("SELECT password_enc FROM mailboxes WHERE id = ?", [b.id]);
      if (row) password = decrypt(row.password_enc);
    }
    if (!password) throw new HttpError(400, "La contraseña es obligatoria");
    try {
      return await testMailbox(
        { host: b.host, port: b.port, secure: b.secure ? 1 : 0, username: b.username, tls_reject_unauthorized: b.tlsRejectUnauthorized ? 1 : 0, folder: b.folder },
        password,
      );
    } catch (err) {
      const e = err as Error & { responseText?: string; authenticationFailed?: boolean };
      throw new HttpError(400, e.authenticationFailed ? "Autenticación fallida" : e.responseText || e.message);
    }
  });

  app.post<{ Params: { id: string } }>("/api/mailboxes/:id/run", async (req) => {
    requireAdmin(req);
    try {
      return await runMailbox(Number(req.params.id));
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  // ------------------------------------------------------------------ ingest
  app.post("/api/ingest/upload", async (req) => {
    requireAdmin(req);
    const results = [];
    for await (const part of req.files()) {
      const buf = await part.toBuffer();
      const r = await ingestBlob(buf, `upload:${req.user!.email}`, part.filename || "upload");
      results.push({ file: part.filename, ...r });
    }
    return results;
  });

  /**
   * Machine ingestion: POST the raw report (xml/gz/zip/eml) with
   * `Authorization: Bearer <ingest token>`. Useful for mail pipelines
   * (e.g. a Postfix pipe or a mail provider webhook) and scripts.
   */
  app.post("/api/ingest/raw", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => {
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token || sha256(token) !== sha256(ingestToken())) throw new HttpError(401, "Invalid ingest token");
    const body = req.body;
    const buf = Buffer.isBuffer(body) ? body : typeof body === "string" ? Buffer.from(body) : null;
    if (!buf?.length) throw new HttpError(400, "Empty body");
    return ingestBlob(buf, "http", String(req.headers["x-filename"] ?? "http-upload"));
  });

  app.get("/api/ingest/log", async (req) => {
    const q = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50), status: z.enum(["ok", "duplicate", "error", "ignored"]).optional() }).parse(req.query);
    const w = q.status ? "WHERE status = ?" : "";
    const p = q.status ? [q.status] : [];
    const total = db.get<{ n: number }>(`SELECT COUNT(*) n FROM ingest_log ${w}`, p)?.n ?? 0;
    const items = db.all(
      `SELECT id, ts, source, status, kind, message, subject, domain, report_ref reportRef FROM ingest_log ${w} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?`,
      [...p, q.pageSize, (q.page - 1) * q.pageSize],
    );
    return { items, total, page: q.page, pageSize: q.pageSize };
  });

  app.get("/api/ingest/status", async (req) => {
    const counts = db.get<{ reports: number; forensic: number; last: number | null }>(
      "SELECT (SELECT COUNT(*) FROM reports) reports, (SELECT COUNT(*) FROM forensic_reports) forensic, (SELECT MAX(received_at) FROM reports) last",
    );
    return {
      smtp: smtpStatus(),
      enrichment: enrichmentStatus(),
      counts,
      ingestToken: req.user?.role === "admin" ? ingestToken() : null,
    };
  });

  // ---------------------------------------------------------------- settings
  app.get("/api/settings", async (req) => {
    requireAdmin(req);
    return maskSettings(getSettings());
  });

  app.put("/api/settings", async (req) => {
    requireAdmin(req);
    const patch = req.body as Record<string, unknown>;
    // The UI echoes the mask back when the password was not changed.
    const email = (patch?.notifications as { email?: { password?: string } } | undefined)?.email;
    if (email?.password === MASK) email.password = getSettings().notifications.email.password;
    try {
      return maskSettings(updateSettings(patch));
    } catch (err) {
      if (err instanceof z.ZodError) throw err;
      throw new HttpError(400, (err as Error).message);
    }
  });

  app.post("/api/settings/test-notification", async (req) => {
    requireAdmin(req);
    try {
      await notify("Prueba de notificación", "Si ve este mensaje, las notificaciones de DMARK-Hole funcionan correctamente.", "info");
      return { ok: true };
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  app.post("/api/settings/ingest-token/rotate", async (req) => {
    requireAdmin(req);
    const token = randomToken(24);
    db.run("INSERT INTO settings (key, value) VALUES ('ingest_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [token]);
    return { token };
  });

  app.get("/api/system", async () => ({
    version: config.version,
    node: process.version,
    uptime: Math.round(process.uptime()),
    dataDir: config.dataDir,
    dbSizeBytes: (db.get<{ s: number }>("SELECT page_count * page_size s FROM pragma_page_count(), pragma_page_size()")?.s ?? 0),
    smtpPort: config.smtp.port,
  }));
}
