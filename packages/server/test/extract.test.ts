import { gzipSync, strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseAggregate } from "../src/dmarc/aggregate.js";
import { extractDocuments, parseFeedbackReport } from "../src/dmarc/extract.js";
import { fixture } from "./helpers.js";

const googleXml = fixture("google.xml");
const yahooXml = fixture("yahoo.xml");
const enc = (s: string) => strToU8(s);

function b64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64").replace(/(.{76})/g, "$1\r\n");
}

/** Builds a multipart/mixed report email carrying one base64 attachment. */
function emailWithAttachment(opts: { filename: string; contentType: string; data: Uint8Array }): Uint8Array {
  const lines = [
    "From: noreply-dmarc-support@example.net",
    "To: dmarc@example.com",
    "Subject: Report Domain: example.com Submitter: example.net Report-ID: 42",
    "Message-ID: <report-42@example.net>",
    "Date: Wed, 01 Oct 2025 02:00:00 +0000",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="BOUNDARY42"',
    "",
    "--BOUNDARY42",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    "This is an aggregate DMARC report.",
    "",
    "--BOUNDARY42",
    `Content-Type: ${opts.contentType}; name="${opts.filename}"`,
    `Content-Disposition: attachment; filename="${opts.filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    b64(opts.data),
    "",
    "--BOUNDARY42--",
    "",
  ];
  return enc(lines.join("\r\n"));
}

describe("extractDocuments: aggregate containers", () => {
  it("raw XML", async () => {
    const r = await extractDocuments(enc(googleXml), "google.xml");
    expect(r.warnings).toEqual([]);
    expect(r.documents).toHaveLength(1);
    const doc = r.documents[0]!;
    expect(doc.kind).toBe("aggregate");
    expect(doc.name).toBe("google.xml");
    if (doc.kind === "aggregate") expect(parseAggregate(doc.xml).orgName).toBe("google.com");
  });

  it("raw XML with BOM is stripped", async () => {
    const r = await extractDocuments(enc("﻿" + yahooXml), "yahoo.xml");
    expect(r.documents).toHaveLength(1);
    const doc = r.documents[0]!;
    if (doc.kind !== "aggregate") throw new Error("expected aggregate");
    expect(doc.xml.charCodeAt(0)).not.toBe(0xfeff);
    expect(parseAggregate(doc.xml).reportId).toBe("0012345678901234567890");
  });

  it("gzip", async () => {
    const r = await extractDocuments(gzipSync(enc(googleXml)), "google.com!example.com!1.xml.gz");
    expect(r.warnings).toEqual([]);
    expect(r.documents).toHaveLength(1);
    expect(r.documents[0]!.name).toBe("google.com!example.com!1.xml");
    expect(r.documents[0]!.kind).toBe("aggregate");
  });

  it("zip with two XML files", async () => {
    const zip = zipSync({ "google.xml": enc(googleXml), "yahoo.xml": enc(yahooXml) });
    const r = await extractDocuments(zip, "reports.zip");
    expect(r.warnings).toEqual([]);
    expect(r.documents.map((d) => d.name).sort()).toEqual(["google.xml", "yahoo.xml"]);
    const ids = r.documents
      .map((d) => (d.kind === "aggregate" ? parseAggregate(d.xml).reportId : ""))
      .sort();
    expect(ids).toEqual(["0012345678901234567890", "13500954812349287491"]);
  });

  it("zip containing a gzip (nesting)", async () => {
    const zip = zipSync({ "inner.xml.gz": gzipSync(enc(googleXml)) });
    const r = await extractDocuments(zip, "nested.zip");
    expect(r.documents).toHaveLength(1);
    expect(r.documents[0]!.name).toBe("inner.xml");
  });

  it("corrupt gzip yields a warning", async () => {
    const bad = gzipSync(enc(googleXml)).slice(0, 20);
    const r = await extractDocuments(bad, "broken.xml.gz");
    expect(r.documents).toHaveLength(0);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/broken\.xml\.gz: cannot decompress/);
  });
});

describe("extractDocuments: emails", () => {
  it("email with gzip attachment", async () => {
    const eml = emailWithAttachment({
      filename: "example.net!example.com!1759276800!1759363199.xml.gz",
      contentType: "application/gzip",
      data: gzipSync(enc(googleXml)),
    });
    const r = await extractDocuments(eml, "msg.eml");
    expect(r.warnings).toEqual([]);
    expect(r.subject).toBe("Report Domain: example.com Submitter: example.net Report-ID: 42");
    expect(r.from).toBe("noreply-dmarc-support@example.net");
    expect(r.documents).toHaveLength(1);
    const doc = r.documents[0]!;
    expect(doc.kind).toBe("aggregate");
    expect(doc.name).toBe("example.net!example.com!1759276800!1759363199.xml");
    if (doc.kind === "aggregate") expect(parseAggregate(doc.xml).records).toHaveLength(4);
  });

  it("email with zip attachment", async () => {
    const eml = emailWithAttachment({
      filename: "report.zip",
      contentType: "application/zip",
      data: zipSync({ "a.xml": enc(googleXml), "b.xml": enc(yahooXml) }),
    });
    const r = await extractDocuments(eml, "msg.eml");
    expect(r.warnings).toEqual([]);
    expect(r.documents).toHaveLength(2);
    expect(r.documents.every((d) => d.kind === "aggregate")).toBe(true);
    expect(r.documents.map((d) => d.name).sort()).toEqual(["a.xml", "b.xml"]);
  });

  it("email with plain XML attachment", async () => {
    const eml = emailWithAttachment({ filename: "r.xml", contentType: "text/xml", data: enc(googleXml) });
    const r = await extractDocuments(eml, "msg.eml");
    expect(r.documents).toHaveLength(1);
    expect(r.documents[0]!.name).toBe("r.xml");
  });

  it("email with no DMARC attachment warns", async () => {
    const eml = enc(
      ["From: a@example.net", "To: b@example.com", "Subject: hi", "Message-ID: <x@example.net>", "", "hello there", ""].join("\r\n"),
    );
    const r = await extractDocuments(eml, "plain.eml");
    expect(r.documents).toHaveLength(0);
    expect(r.warnings).toEqual(["plain.eml: email has no DMARC attachment"]);
  });

  it("inline XML body", async () => {
    const eml = enc(
      ["From: a@example.net", "To: b@example.com", "Subject: inline", "Content-Type: text/plain; charset=utf-8", "", googleXml, ""].join("\r\n"),
    );
    const r = await extractDocuments(eml, "inline.eml");
    expect(r.documents).toHaveLength(1);
    expect(r.documents[0]!.name).toBe("inline.eml#body");
  });
});

describe("extractDocuments: forensic (ARF)", () => {
  it("parses forensic.eml", async () => {
    const raw = fixture("forensic.eml");
    const r = await extractDocuments(enc(raw), "forensic.eml");
    expect(r.warnings).toEqual([]);
    expect(r.subject).toBe("DMARC failure report for example.com");
    expect(r.from).toBe("dmarc-noreply@example.net");
    expect(r.documents).toHaveLength(1);
    const doc = r.documents[0]!;
    expect(doc.kind).toBe("forensic");
    if (doc.kind !== "forensic") return;
    expect(doc.name).toBe("forensic.eml");
    expect(doc.raw).toBe(raw);
    expect(doc.report).toMatchObject({
      reporter: "dmarc-noreply@example.net",
      feedbackType: "auth-failure",
      authFailure: "dmarc",
      deliveryResult: "reject",
      reportedDomain: "example.com",
      sourceIp: "203.0.113.77",
      arrivalTs: Date.UTC(2025, 8, 30, 10, 15, 0) / 1000,
      originalMailFrom: "bounce@example.com",
      originalRcptTo: "victim@example.net",
      dkimDomain: "example.com",
      dkimSelector: "s1",
      spfDns: null,
      subject: "Urgent: verify your account",
      messageId: "spoofed-123@example.com",
      headerFrom: "example.com",
    });
    expect(doc.report.headers).toContain("From: someone@example.com");
  });

  it("parseFeedbackReport falls back to the original headers", () => {
    const rep = parseFeedbackReport(
      "Feedback-Type: auth-failure\r\nAuth-Failure: dmarc\r\n",
      "From: Someone <someone@Example.NET>\r\nDate: Tue, 30 Sep 2025 10:15:00 +0000\r\nSubject: x\r\n\r\nbody",
    );
    expect(rep.reportedDomain).toBe("example.net");
    expect(rep.arrivalTs).toBe(Date.UTC(2025, 8, 30, 10, 15, 0) / 1000);
    expect(rep.headers).toBe("From: Someone <someone@Example.NET>\nDate: Tue, 30 Sep 2025 10:15:00 +0000\nSubject: x");
  });

  it("parseFeedbackReport handles missing data", () => {
    const rep = parseFeedbackReport("Feedback-Type: abuse\n", null);
    expect(rep).toMatchObject({ feedbackType: "abuse", arrivalTs: null, headers: null, subject: null, reportedDomain: null });
  });
});

describe("extractDocuments: unsupported content", () => {
  it("random text", async () => {
    const r = await extractDocuments(enc("just some text with no structure"), "notes.txt");
    expect(r.documents).toEqual([]);
    expect(r.warnings).toEqual(["notes.txt: unsupported content"]);
  });

  it("random binary", async () => {
    const r = await extractDocuments(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), "blob.bin");
    expect(r.documents).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });

  it("XML that is not a DMARC report", async () => {
    const r = await extractDocuments(enc('<?xml version="1.0"?><html><body>hi</body></html>'), "page.xml");
    expect(r.documents).toEqual([]);
    expect(r.warnings).toEqual(["page.xml: XML is not a DMARC aggregate report"]);
  });

  it("empty input", async () => {
    const r = await extractDocuments(new Uint8Array(), "empty");
    expect(r.documents).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });
});
