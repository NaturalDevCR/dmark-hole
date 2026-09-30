import { prisma } from "@dmark-hole/db";
import { sanitizeXml, sha256, parseDateSafe } from "@dmark-hole/shared/utils";
import { processRecordQueue } from "../lib/queue.js";
import { Queue } from "bullmq";
import { redis } from "../lib/redis.js";

interface ParseJobData {
  organizationId: string;
  domainId?: string;
  rawXml: string;
  xmlHash: string;
  reportType?: string;
  ingestedFrom?: string;
}

export async function processParseReport(data: ParseJobData): Promise<void> {
  const { organizationId, domainId, rawXml, xmlHash, reportType = "AGGREGATE", ingestedFrom = "ingestion" } = data;

  const sanitized = sanitizeXml(rawXml);

  // Extract report metadata from XML using regex (safe without full XML parser)
  const reportId = extractTag(sanitized, "report_id") || `auto-${xmlHash.slice(0, 16)}`;
  const policyDomain = extractTag(sanitized, "policy_domain") || "unknown";
  const policyAdkim = extractTag(sanitized, "adkim") || "r";
  const policyAspf = extractTag(sanitized, "aspf") || "r";
  const policyP = extractTag(sanitized, "p") || "NONE";
  const policyPct = parseInt(extractTag(sanitized, "pct") || "100", 10);
  const policySp = extractTag(sanitized, "sp") || "NONE";
  const reportOrg = extractTag(sanitized, "org_name") || "unknown";
  const reportEmail = extractTag(sanitized, "email") || "";
  const extraContact = extractTag(sanitized, "extra_contact_info") || null;

  const beginDateRaw = extractTag(sanitized, "begin");
  const endDateRaw = extractTag(sanitized, "end");
  const beginDate = parseDateSafe(beginDateRaw ? parseInt(beginDateRaw, 10) : null) || new Date();
  const endDate = parseDateSafe(endDateRaw ? parseInt(endDateRaw, 10) : null) || new Date();

  // Find or match domain
  let resolvedDomainId = domainId;
  if (!resolvedDomainId && policyDomain) {
    const domain = await prisma.domain.findFirst({
      where: { domain: { contains: policyDomain }, organizationId },
    });
    if (domain) resolvedDomainId = domain.id;
  }

  if (!resolvedDomainId) {
    console.warn(`Could not resolve domain for report ${reportId}, org ${organizationId}`);
    return;
  }

  // Create report
  const report = await prisma.dmarcReport.upsert({
    where: { reportId_domainId: { reportId, domainId: resolvedDomainId } },
    create: {
      domainId: resolvedDomainId,
      organizationId,
      reportId,
      reportType: reportType === "FORENSIC" ? "FORENSIC" : "AGGREGATE",
      beginDate,
      endDate,
      policyDomain,
      policyAdkim,
      policyAspf,
      policyP: policyP as "NONE" | "QUARANTINE" | "REJECT",
      policyPct,
      policySp: policySp as "NONE" | "QUARANTINE" | "REJECT",
      rawXml: sanitized,
      rawXmlHash: xmlHash,
      parsed: false,
      ingestedFrom,
      reportOrg,
      reportEmail,
      extraContactInfo: extraContact,
    },
    update: {},
  });

  // Extract individual records and queue for processing
  const recordBlocks = extractRecordBlocks(sanitized);

  if (recordBlocks.length > 0) {
    console.log(`Parsed ${recordBlocks.length} records from report ${reportId}`);

    // Save records and queue enrichment
    for (const record of recordBlocks) {
      const sourceIp = extractTag(record, "source_ip") || "0.0.0.0";
      const count = parseInt(extractTag(record, "count") || "1", 10);
      const disposition = extractTag(record, "disposition") || "NONE";
      const dkimResult = extractTag(record, "dkim") || "NEUTRAL";
      const spfResult = extractTag(record, "spf") || "NEUTRAL";
      const headerFrom = extractTag(record, "header_from") || "unknown";
      const envelopeFrom = extractTag(record, "envelope_from") || null;
      const envelopeTo = extractTag(record, "envelope_to") || null;

      await prisma.dmarcRecord.create({
        data: {
          reportId: report.id,
          sourceIp,
          sourceHost: null,
          sourceOrg: null,
          count,
          disposition: disposition as "NONE" | "QUARANTINE" | "REJECT",
          dkimResult: dkimResult as "PASS" | "FAIL" | "NEUTRAL",
          spfResult: spfResult as "PASS" | "FAIL" | "NEUTRAL",
          headerFrom,
          envelopeFrom,
          envelopeTo,
        },
      }).catch((err: Error) => {
        if (err.message?.includes("Unique constraint")) {
          // Duplicate record, skip
        } else {
          console.error(`Error saving record for ${sourceIp}:`, err.message);
        }
      });
    }
  }

  // Mark report as parsed
  await prisma.dmarcReport.update({
    where: { id: report.id },
    data: { parsed: true },
  });

  console.log(`Report ${reportId} parsed successfully with ${recordBlocks.length} records`);
}

function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1]?.trim() || null : null;
}

function extractRecordBlocks(xml: string): string[] {
  const blocks: string[] = [];
  const regex = /<record>([\s\S]*?)<\/record>/gi;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    if (match[1]) blocks.push(match[1]);
  }
  return blocks;
}
