import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

const dataDir = resolve(process.env.DATA_DIR || resolve(here, "../../../data"));
mkdirSync(dataDir, { recursive: true });

/**
 * Secret used for session signing and credential encryption. Generated on first
 * run and persisted in the data directory so a plain `docker run` just works.
 */
function loadSecret(): string {
  if (process.env.SECRET_KEY && process.env.SECRET_KEY.length >= 32) return process.env.SECRET_KEY;
  const file = resolve(dataDir, ".secret");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const secret = randomBytes(48).toString("base64url");
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export const config = {
  dataDir,
  dbPath: resolve(dataDir, "dmark-hole.db"),
  host: process.env.HOST || "0.0.0.0",
  port: envInt("PORT", 8080),
  secret: loadSecret(),
  logLevel: process.env.LOG_LEVEL || "info",
  trustProxy: envBool("TRUST_PROXY", false),
  /** Set to true when served behind HTTPS so cookies get the Secure flag. */
  secureCookies: envBool("SECURE_COOKIES", false),
  webDist: resolve(process.env.WEB_DIST || resolve(here, "../../web/dist")),
  smtp: {
    enabled: envBool("SMTP_ENABLED", false),
    host: process.env.SMTP_LISTEN_HOST || "0.0.0.0",
    port: envInt("SMTP_PORT", 2525),
    /** Max message size accepted by the built-in SMTP receiver. */
    maxSize: envInt("SMTP_MAX_SIZE_MB", 25) * 1024 * 1024,
    tlsKey: process.env.SMTP_TLS_KEY,
    tlsCert: process.env.SMTP_TLS_CERT,
  },
  bootstrapAdmin: {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  },
  disableScheduler: envBool("DISABLE_SCHEDULER", false),
  version: "2.0.0",
};
