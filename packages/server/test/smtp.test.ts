import { gzipSync } from "node:zlib";
import nodemailer from "nodemailer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

process.env.SMTP_PORT = "25251";
process.env.SMTP_LISTEN_HOST = "127.0.0.1";
const { db } = await import("../src/db/index.js");
const { updateSettings } = await import("../src/settings.js");
const { startSmtp, stopSmtp } = await import("../src/ingest/smtp.js");

const transport = nodemailer.createTransport({ host: "127.0.0.1", port: 25251, secure: false, ignoreTLS: true });
const send = (to: string) =>
  transport.sendMail({
    from: "noreply@reporter.example",
    to,
    subject: "Report domain: example.com",
    text: "report",
    attachments: [{ filename: "r.xml.gz", content: gzipSync(fixture("google.xml")) }],
  });

beforeAll(async () => {
  db.migrate();
  updateSettings({ enrichment: false, alerts: { enabled: false } });
  await startSmtp();
});
afterAll(() => stopSmtp());

describe("SMTP receiver", () => {
  it("refuses all mail until an allow-list is configured", async () => {
    await expect(send("dmarc@reports.example")).rejects.toThrow(/550|allowed recipients/i);
  });

  it("accepts allowed recipients and ingests the report", async () => {
    updateSettings({ smtpReceiver: { allowedRecipients: ["@reports.example"] } });
    await expect(send("someone@other.example")).rejects.toThrow(/550/);
    const r = await send("dmarc@reports.example");
    expect(r.accepted).toContain("dmarc@reports.example");
    // Ingestion runs after the 250 reply.
    for (let i = 0; i < 50 && !db.get("SELECT 1 FROM reports"); i++) await new Promise((res) => setTimeout(res, 20));
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM reports")?.n).toBe(1);
  });
});
