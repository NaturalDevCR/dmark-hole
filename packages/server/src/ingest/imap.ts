import { ImapFlow } from "imapflow";
import { db, nowSec } from "../db/index.js";
import { decrypt } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";
import { ingestBlob } from "./store.js";

export interface MailboxRow {
  id: number;
  name: string;
  host: string;
  port: number;
  secure: number;
  username: string;
  password_enc: string;
  folder: string;
  after_action: "seen" | "move" | "delete";
  processed_folder: string;
  failed_folder: string;
  only_unseen: number;
  tls_reject_unauthorized: number;
  enabled: number;
  poll_minutes: number;
  last_run_at: number | null;
}

export interface MailboxRunResult {
  messages: number;
  reports: number;
  duplicates: number;
  errors: number;
  ignored: number;
}

const MAX_MESSAGES_PER_RUN = 500;
const running = new Set<number>();

function client(mb: Pick<MailboxRow, "host" | "port" | "secure" | "username" | "tls_reject_unauthorized">, password: string) {
  return new ImapFlow({
    host: mb.host,
    port: mb.port,
    secure: !!mb.secure,
    auth: { user: mb.username, pass: password },
    tls: { rejectUnauthorized: !!mb.tls_reject_unauthorized },
    logger: false,
    socketTimeout: 120_000,
    connectionTimeout: 30_000,
  });
}

export async function testMailbox(mb: Pick<MailboxRow, "host" | "port" | "secure" | "username" | "tls_reject_unauthorized" | "folder">, password: string) {
  const c = client(mb, password);
  await c.connect();
  try {
    const list = await c.list();
    const status = await c.status(mb.folder, { messages: true, unseen: true });
    return { folders: list.map((f) => f.path), messages: status ? (status.messages ?? 0) : 0, unseen: status ? (status.unseen ?? 0) : 0 };
  } finally {
    await c.logout().catch(() => undefined);
  }
}

async function ensureFolder(c: ImapFlow, path: string) {
  try {
    await c.mailboxCreate(path);
  } catch {
    /* already exists */
  }
}

export function isMailboxRunning(id: number) {
  return running.has(id);
}

export async function runMailbox(id: number): Promise<MailboxRunResult> {
  const mb = db.get<MailboxRow>("SELECT * FROM mailboxes WHERE id = ?", [id]);
  if (!mb) throw new Error("Mailbox not found");
  if (running.has(id)) throw new Error("Mailbox sync already in progress");
  running.add(id);
  const result: MailboxRunResult = { messages: 0, reports: 0, duplicates: 0, errors: 0, ignored: 0 };
  const source = `imap:${mb.name}`;
  const c = client(mb, decrypt(mb.password_enc));

  try {
    await c.connect();
    const lock = await c.getMailboxLock(mb.folder);
    try {
      const query = mb.only_unseen ? { seen: false } : { all: true };
      const uids = ((await c.search(query, { uid: true })) || []).slice(0, MAX_MESSAGES_PER_RUN);
      if (uids.length && mb.after_action === "move") {
        await ensureFolder(c, mb.processed_folder);
        await ensureFolder(c, mb.failed_folder);
      }
      const done: number[] = [];
      const failed: number[] = [];
      // Download first, then act on flags: IMAP forbids commands while a FETCH stream is open.
      const messages: { uid: number; source: Buffer }[] = [];
      for await (const msg of c.fetch(uids, { uid: true, source: true }, { uid: true })) {
        if (msg.source) messages.push({ uid: msg.uid, source: msg.source });
      }
      for (const msg of messages) {
        result.messages++;
        try {
          const r = await ingestBlob(msg.source, source, `uid-${msg.uid}.eml`);
          result.reports += r.counts.ok;
          result.duplicates += r.counts.duplicate;
          result.ignored += r.counts.ignored;
          result.errors += r.counts.error;
          (r.counts.error > 0 && r.counts.ok === 0 ? failed : done).push(msg.uid);
        } catch (err) {
          result.errors++;
          failed.push(msg.uid);
          logger.error({ err, uid: msg.uid, mailbox: mb.name }, "failed to ingest message");
        }
      }
      await applyAfterAction(c, mb, done, mb.processed_folder);
      await applyAfterAction(c, mb, failed, mb.failed_folder);
    } finally {
      lock.release();
    }
    db.run(
      `UPDATE mailboxes SET last_run_at = ?, last_status = 'ok', last_error = NULL,
        total_messages = total_messages + ?, total_reports = total_reports + ? WHERE id = ?`,
      [nowSec(), result.messages, result.reports, id],
    );
    if (result.messages) logger.info({ mailbox: mb.name, ...result }, "mailbox sync finished");
    return result;
  } catch (err) {
    const msg = (err as Error & { responseText?: string }).responseText || (err as Error).message;
    db.run("UPDATE mailboxes SET last_run_at = ?, last_status = 'error', last_error = ? WHERE id = ?", [nowSec(), msg, id]);
    logger.warn({ mailbox: mb.name, err: msg }, "mailbox sync failed");
    throw new Error(msg);
  } finally {
    running.delete(id);
    await c.logout().catch(() => undefined);
  }
}

async function applyAfterAction(c: ImapFlow, mb: MailboxRow, uids: number[], moveTo: string) {
  if (!uids.length) return;
  const range = uids.join(",");
  if (mb.after_action === "delete" && moveTo === mb.processed_folder) {
    await c.messageDelete(range, { uid: true });
  } else if (mb.after_action === "move") {
    await c.messageMove(range, moveTo, { uid: true });
  } else {
    await c.messageFlagsAdd(range, ["\\Seen"], { uid: true });
  }
}

/** Called by the scheduler every minute; runs mailboxes whose poll interval elapsed. */
export async function pollDueMailboxes() {
  const now = nowSec();
  const due = db.all<{ id: number }>(
    "SELECT id FROM mailboxes WHERE enabled = 1 AND (last_run_at IS NULL OR last_run_at + poll_minutes * 60 <= ?)",
    [now],
  );
  for (const { id } of due) {
    if (running.has(id)) continue;
    await runMailbox(id).catch(() => undefined);
  }
}
