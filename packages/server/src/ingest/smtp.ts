import { readFileSync } from "node:fs";
import { SMTPServer, type SMTPServerOptions } from "smtp-server";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { getSettings, onSettingsChange } from "../settings.js";
import { ingestBlob } from "./store.js";

let server: SMTPServer | null = null;
let lastError: string | null = null;
let received = 0;

export function smtpStatus() {
  return {
    running: !!server,
    host: config.smtp.host,
    port: config.smtp.port,
    tls: !!(config.smtp.tlsKey && config.smtp.tlsCert),
    received,
    lastError,
  };
}

function recipientAllowed(address: string): boolean {
  const allowed = getSettings().smtpReceiver.allowedRecipients.map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) return true;
  const addr = address.toLowerCase();
  // Entries can be full addresses or "@domain" to accept a whole domain.
  return allowed.some((a) => (a.startsWith("@") ? addr.endsWith(a) : addr === a));
}

export async function startSmtp(): Promise<void> {
  if (server) return;
  const opts: SMTPServerOptions = {
    name: "dmark-hole",
    banner: "DMARK-Hole DMARC report receiver",
    authOptional: true,
    disabledCommands: ["AUTH"],
    size: config.smtp.maxSize,
    logger: false,
    onRcptTo(address, _session, cb) {
      if (!recipientAllowed(address.address)) {
        const err = new Error("Recipient not accepted") as Error & { responseCode: number };
        err.responseCode = 550;
        return cb(err);
      }
      cb();
    },
    onData(stream, session, cb) {
      const chunks: Buffer[] = [];
      let tooBig = false;
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        tooBig = (stream as unknown as { sizeExceeded?: boolean }).sizeExceeded === true;
        if (tooBig) {
          const err = new Error("Message exceeds maximum size") as Error & { responseCode: number };
          err.responseCode = 552;
          return cb(err);
        }
        received++;
        const data = Buffer.concat(chunks);
        const peer = session.remoteAddress;
        // Accept immediately; processing errors are recorded in the ingest log, not bounced.
        cb();
        ingestBlob(data, `smtp:${peer}`, `smtp-${Date.now()}.eml`).catch((err) =>
          logger.error({ err, peer }, "smtp ingest failed"),
        );
      });
    },
  };
  if (config.smtp.tlsKey && config.smtp.tlsCert) {
    opts.key = readFileSync(config.smtp.tlsKey);
    opts.cert = readFileSync(config.smtp.tlsCert);
  } else {
    opts.disabledCommands = ["AUTH", "STARTTLS"];
  }

  const s = new SMTPServer(opts);
  s.on("error", (err) => {
    lastError = err.message;
    logger.warn({ err: err.message }, "smtp server error");
  });
  await new Promise<void>((resolve, reject) => {
    s.server.once("error", reject);
    s.listen(config.smtp.port, config.smtp.host, () => {
      s.server.off("error", reject);
      resolve();
    });
  }).catch((err: Error) => {
    lastError = err.message;
    throw err;
  });
  server = s;
  lastError = null;
  logger.info({ port: config.smtp.port }, "SMTP receiver listening");
}

export async function stopSmtp(): Promise<void> {
  if (!server) return;
  const s = server;
  server = null;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  logger.info("SMTP receiver stopped");
}

export function initSmtp() {
  const apply = (enabled: boolean) => {
    (enabled ? startSmtp() : stopSmtp()).catch((err) => logger.error({ err: err.message }, "cannot toggle SMTP receiver"));
  };
  apply(getSettings().smtpReceiver.enabled);
  onSettingsChange((next, prev) => {
    if (next.smtpReceiver.enabled !== prev.smtpReceiver.enabled) apply(next.smtpReceiver.enabled);
  });
}
