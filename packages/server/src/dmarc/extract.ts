import { gunzipSync } from "node:zlib";
import { unzipSync } from "fflate";
import { simpleParser, type ParsedMail } from "mailparser";
import { looksLikeAggregate } from "./aggregate.js";
import type { ExtractedDocument, ForensicReport } from "./types.js";

const MAX_DEPTH = 4;
/**
 * Decompression budget shared by every nested archive in one blob. Real aggregate
 * reports are at most a few MB; this only has to stop compression bombs.
 */
const MAX_UNCOMPRESSED = 64 * 1024 * 1024;

export interface ExtractResult {
  documents: ExtractedDocument[];
  /** Non-fatal problems (unreadable attachments, unsupported formats). */
  warnings: string[];
  subject?: string | null;
  from?: string | null;
}

function isGzip(b: Uint8Array) {
  return b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
}
function isZip(b: Uint8Array) {
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

function decodeText(b: Uint8Array): string {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(b);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeXml(text: string): boolean {
  return /^\s*<(\?xml|(\w+:)?feedback)/i.test(text);
}

function looksLikeEmail(text: string): boolean {
  const head = text.slice(0, 8192);
  return /^(received|from|return-path|delivered-to|message-id|mime-version|date|subject|to|x-[\w-]+|dkim-signature|arc-[\w-]+|authentication-results):/im.test(head)
    && /\r?\n\r?\n/.test(text);
}

/**
 * Takes any blob a user or mailbox may hand us (raw XML, .gz, .zip, a full
 * .eml with attachments, nested combinations) and returns the DMARC documents
 * it contains.
 */
export async function extractDocuments(data: Uint8Array, name = "upload", depth = 0, budget = { left: MAX_UNCOMPRESSED }): Promise<ExtractResult> {
  const out: ExtractResult = { documents: [], warnings: [] };
  if (depth > MAX_DEPTH) {
    out.warnings.push(`${name}: nesting too deep`);
    return out;
  }

  try {
    if (isGzip(data)) {
      // maxOutputLength aborts inflation early instead of allocating the whole bomb.
      const inner = gunzipSync(data, { maxOutputLength: Math.max(1, budget.left) });
      budget.left -= inner.length;
      return merge(out, await extractDocuments(inner, name.replace(/\.gz$/i, ""), depth + 1, budget));
    }
    if (isZip(data)) {
      // fflate caps each entry at its declared size, so budgeting declared sizes is enough.
      const files = unzipSync(data, {
        filter: (f) => {
          if (f.name.endsWith("/") || f.originalSize > budget.left) return false;
          budget.left -= f.originalSize;
          return true;
        },
      });
      for (const [fname, content] of Object.entries(files)) {
        merge(out, await extractDocuments(content, fname, depth + 1, budget));
      }
      return out;
    }
  } catch (err) {
    out.warnings.push(`${name}: cannot decompress (${(err as Error).message})`);
    return out;
  }

  const text = decodeText(data);
  if (looksLikeXml(text)) {
    if (looksLikeAggregate(text)) out.documents.push({ kind: "aggregate", xml: text, name });
    else out.warnings.push(`${name}: XML is not a DMARC aggregate report`);
    return out;
  }
  if (looksLikeEmail(text)) {
    return merge(out, await extractFromEmail(data, name, depth, budget));
  }
  out.warnings.push(`${name}: unsupported content`);
  return out;
}

function merge(target: ExtractResult, src: ExtractResult): ExtractResult {
  target.documents.push(...src.documents);
  target.warnings.push(...src.warnings);
  if (src.subject !== undefined && target.subject === undefined) target.subject = src.subject;
  if (src.from !== undefined && target.from === undefined) target.from = src.from;
  return target;
}

async function extractFromEmail(data: Uint8Array, name: string, depth: number, budget: { left: number }): Promise<ExtractResult> {
  const out: ExtractResult = { documents: [], warnings: [] };
  let mail: ParsedMail;
  try {
    mail = await simpleParser(Buffer.from(data), { skipHtmlToText: true, skipTextLinks: true, skipImageLinks: true });
  } catch (err) {
    out.warnings.push(`${name}: cannot parse email (${(err as Error).message})`);
    return out;
  }
  out.subject = mail.subject ?? null;
  out.from = mail.from?.value?.[0]?.address ?? null;

  const feedbackPart = mail.attachments.find((a) => a.contentType?.toLowerCase() === "message/feedback-report");
  if (feedbackPart) {
    const original = mail.attachments.find((a) =>
      ["message/rfc822", "text/rfc822-headers", "message/rfc822-headers"].includes(a.contentType?.toLowerCase() ?? ""),
    );
    const report = parseFeedbackReport(feedbackPart.content.toString("utf8"), original?.content.toString("utf8") ?? null);
    report.reporter = report.reporter ?? out.from;
    out.documents.push({ kind: "forensic", report, raw: Buffer.from(data).toString("utf8"), name });
    return out;
  }

  for (const att of mail.attachments) {
    const fname = att.filename || `${name}#${att.contentType}`;
    const ct = att.contentType?.toLowerCase() ?? "";
    if (ct.startsWith("image/") || ct === "text/html") continue;
    merge(out, await extractDocuments(att.content, fname, depth + 1, budget));
  }

  // A few reporters inline the XML in the body instead of attaching it.
  if (out.documents.length === 0 && mail.text && looksLikeXml(mail.text) && looksLikeAggregate(mail.text)) {
    out.documents.push({ kind: "aggregate", xml: mail.text, name: `${name}#body` });
  }
  if (out.documents.length === 0 && mail.attachments.length === 0) {
    out.warnings.push(`${name}: email has no DMARC attachment`);
  }
  return out;
}

function parseHeaderBlock(text: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const unfolded = text.replace(/\r\n/g, "\n").replace(/\n[ \t]+/g, " ");
  for (const line of unfolded.split("\n")) {
    const m = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const list = map.get(key) ?? [];
    list.push(m[2]!.trim());
    map.set(key, list);
  }
  return map;
}

const stripAngles = (s: string | undefined | null) => (s ? s.replace(/^<|>$/g, "").trim() || null : null);

export function parseFeedbackReport(feedback: string, original: string | null): ForensicReport {
  const fb = parseHeaderBlock(feedback);
  const first = (k: string) => fb.get(k)?.[0] ?? null;
  const headerSection = original ? original.replace(/\r\n/g, "\n").split("\n\n")[0] ?? "" : "";
  const oh = parseHeaderBlock(headerSection);
  const oFirst = (k: string) => oh.get(k)?.[0] ?? null;

  const arrival = first("arrival-date") ?? oFirst("date");
  const arrivalMs = arrival ? Date.parse(arrival) : NaN;
  const fromHeader = oFirst("from");
  const fromDomain = fromHeader ? /@([A-Za-z0-9.-]+)/.exec(fromHeader)?.[1]?.toLowerCase() ?? null : null;

  return {
    reporter: null,
    feedbackType: first("feedback-type")?.toLowerCase() ?? null,
    authFailure: first("auth-failure")?.toLowerCase() ?? null,
    deliveryResult: first("delivery-result")?.toLowerCase() ?? null,
    reportedDomain: first("reported-domain")?.toLowerCase().replace(/\.$/, "") ?? fromDomain,
    sourceIp: first("source-ip"),
    arrivalTs: Number.isFinite(arrivalMs) ? Math.floor(arrivalMs / 1000) : null,
    originalMailFrom: stripAngles(first("original-mail-from")),
    originalRcptTo: stripAngles(first("original-rcpt-to")),
    dkimDomain: first("dkim-domain"),
    dkimSelector: first("dkim-selector"),
    spfDns: first("spf-dns"),
    subject: oFirst("subject"),
    messageId: stripAngles(oFirst("message-id")),
    headerFrom: fromDomain,
    headers: headerSection ? headerSection.slice(0, 64 * 1024) : null,
  };
}
