import { createHash, createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || "dmark-hole-default-32-byte-key!!";
  return scryptSync(secret, "dmark-salt", KEY_LENGTH);
}

export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

export function decrypt(encryptedText: string): string {
  const key = getEncryptionKey();
  const parts = encryptedText.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted text format");
  const [ivHex, authTagHex, encrypted] = parts;
  const iv = Buffer.from(ivHex!, "hex");
  const authTag = Buffer.from(authTagHex!, "hex");
  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted!, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

export function generateToken(length = 32): string {
  return randomBytes(length).toString("hex");
}

export function generateApiKey(): { key: string; hash: string } {
  const key = `dmk_${randomBytes(24).toString("base64url")}`;
  const hash = sha256(key);
  return { key, hash };
}

export function sanitizeXml(xml: string): string {
  return xml
    .replace(/<!ENTITY[^>]*>/gi, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<xi:include[^>]*\/>/gi, "")
    .replace(/<\?xml-stylesheet[^?]*\?>/gi, "");
}

export function parseDateSafe(input: unknown): Date | null {
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  if (typeof input === "number") {
    const d = new Date(input * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof input === "string") {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function isValidDomain(domain: string): boolean {
  return /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(domain);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function exponentialBackoff(attempt: number, baseDelayMs = 1000, maxDelayMs = 60000): number {
  const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  const jitter = delay * 0.1 * Math.random();
  return Math.floor(delay + jitter);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export function retry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; baseDelay?: number; onRetry?: (error: Error, attempt: number) => void } = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelay = 1000, onRetry } = options;

  return new Promise((resolve, reject) => {
    let attempt = 0;

    const execute = async () => {
      try {
        attempt++;
        const result = await fn();
        resolve(result);
      } catch (error) {
        if (attempt >= maxAttempts) {
          reject(error);
          return;
        }
        onRetry?.(error as Error, attempt);
        setTimeout(execute, exponentialBackoff(attempt, baseDelay));
      }
    };

    execute();
  });
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

export function percentage(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 10000) / 100;
}

export function computeHealthScore(scores: { spf: number; dkim: number; dmarc: number }): number {
  return Math.round((scores.spf * 0.3 + scores.dkim * 0.3 + scores.dmarc * 0.4) * 100) / 100;
}

export function dedupByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function sanitizeForensicBody(body: string, maxLength = 500): string {
  const truncated = truncate(body, maxLength);
  return truncated
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[REDACTED_EMAIL]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (match) => {
      const parts = match.split(".");
      return `${parts[0]}.${parts[1]}.[REDACTED].[REDACTED]`;
    });
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function maskCredentials(obj: Record<string, unknown>): Record<string, unknown> {
  const sensitive = ["password", "secret", "token", "key", "pass"];
  const masked = { ...obj };
  for (const key of Object.keys(masked)) {
    if (sensitive.some((s) => key.toLowerCase().includes(s))) {
      masked[key] = "********";
    }
  }
  return masked;
}
