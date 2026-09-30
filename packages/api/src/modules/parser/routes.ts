import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { sanitizeXml } from "@dmark-hole/shared/utils";

export async function parserRoutes(server: FastifyInstance): Promise<void> {
  // POST /parser/validate-xml - Validate DMARC XML structure
  server.post("/validate-xml", { preHandler: [authMiddleware, requireRole("ANALYST")] }, async (request, reply) => {
    const body = request.body as { xml?: string };
    if (!body.xml) return reply.status(400).send({ success: false, error: "XML content required" });

    const sanitized = sanitizeXml(body.xml);
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic XML validation
    try {
      // Check for DMARC namespace
      if (!sanitized.includes("urn:ietf:params:xml:ns:dmarc-2.0") &&
          !sanitized.includes("dmarc.org/dmarc-xml")) {
        warnings.push("XML does not contain standard DMARC namespace");
      }

      // Check for feedback element
      if (!sanitized.includes("<feedback>")) {
        errors.push("Missing <feedback> root element");
      }

      // Check for report metadata
      if (!sanitized.includes("<report_metadata>")) {
        errors.push("Missing <report_metadata>");
      }

      // Check for record elements
      if (!sanitized.includes("<record>")) {
        warnings.push("No <record> elements found - report may be empty");
      }

      // Check for malicious content patterns
      const maliciousPatterns = [
        /<!ENTITY\s/,
        /<!DOCTYPE\s/,
        /<xi:include/,
        /<\?xml-stylesheet/,
      ];

      for (const pattern of maliciousPatterns) {
        if (pattern.test(sanitized)) {
          errors.push(`Potentially malicious XML pattern detected: ${pattern.source}`);
        }
      }

      // Size validation
      if (sanitized.length > 50 * 1024 * 1024) {
        errors.push("XML exceeds maximum size of 50MB");
      }

      const isValid = errors.length === 0;

      return {
        success: true,
        data: {
          valid: isValid,
          errors,
          warnings,
          size: sanitized.length,
        },
      };
    } catch (error) {
      return {
        success: true,
        data: {
          valid: false,
          errors: [`XML parse error: ${(error as Error).message}`],
          warnings: [],
          size: sanitized.length,
        },
      };
    }
  });

  // GET /parser/reports - List parsed reports
  server.get("/reports", { preHandler: [authMiddleware, requireRole("ANALYST")] }, async (request) => {
    const user = request.authUser!;
    const query = request.query as { domainId?: string; page?: string; pageSize?: string; status?: string };
    const page = parseInt(query.page || "1", 10);
    const pageSize = Math.min(parseInt(query.pageSize || "20", 10), 100);

    const where: Record<string, unknown> = { organizationId: user.organizationId };
    if (query.domainId) where.domainId = query.domainId;
    if (query.status === "error") where.errorMessage = { not: null };
    if (query.status === "ok") where.errorMessage = null;

    const [reports, total] = await Promise.all([
      prisma.dmarcReport.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          domain: { select: { domain: true } },
          _count: { select: { records: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.dmarcReport.count({ where }),
    ]);

    return {
      success: true,
      data: reports.map((r) => ({
        id: r.id,
        reportId: r.reportId,
        domain: r.domain.domain,
        beginDate: r.beginDate,
        endDate: r.endDate,
        policyP: r.policyP,
        reportOrg: r.reportOrg,
        recordCount: r._count.records,
        errorMessage: r.errorMessage,
        parsed: r.parsed,
        createdAt: r.createdAt,
      })),
      meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    };
  });

  // GET /parser/reports/:reportId - Get parsed report details
  server.get("/reports/:reportId", { preHandler: [authMiddleware, requireRole("ANALYST")] }, async (request, reply) => {
    const { reportId } = request.params as { reportId: string };
    const user = request.authUser!;

    const report = await prisma.dmarcReport.findFirst({
      where: { id: reportId, organizationId: user.organizationId },
      include: {
        domain: { select: { domain: true } },
        records: {
          orderBy: { count: "desc" },
          take: 200,
        },
      },
    });

    if (!report) return reply.status(404).send({ success: false, error: "Report not found" });

    return {
      success: true,
      data: {
        id: report.id,
        reportId: report.reportId,
        domain: report.domain.domain,
        beginDate: report.beginDate,
        endDate: report.endDate,
        policyDomain: report.policyDomain,
        policyAdkim: report.policyAdkim,
        policyAspf: report.policyAspf,
        policyP: report.policyP,
        policyPct: report.policyPct,
        policySp: report.policySp,
        reportOrg: report.reportOrg,
        reportEmail: report.reportEmail,
        ingestedFrom: report.ingestedFrom,
        records: report.records.map((r) => ({
          id: r.id,
          sourceIp: r.sourceIp,
          sourceHost: r.sourceHost,
          sourceOrg: r.sourceOrg,
          count: r.count,
          disposition: r.disposition,
          dkimResult: r.dkimResult,
          spfResult: r.spfResult,
          dkimDomain: r.dkimDomain,
          dkimSelector: r.dkimSelector,
          spfDomain: r.spfDomain,
          headerFrom: r.headerFrom,
          asn: r.asn,
          asnOrg: r.asnOrg,
          country: r.country,
          city: r.city,
          reverseDns: r.reverseDns,
        })),
        recordCount: report.records.length,
        rawXml: report.rawXml,
        createdAt: report.createdAt,
      },
    };
  });

  // GET /parser/records - Search individual records
  server.get("/records", { preHandler: [authMiddleware, requireRole("ANALYST")] }, async (request) => {
    const user = request.authUser!;
    const query = request.query as {
      sourceIp?: string;
      headerFrom?: string;
      disposition?: string;
      spfResult?: string;
      dkimResult?: string;
      page?: string;
      pageSize?: string;
    };
    const page = parseInt(query.page || "1", 10);
    const pageSize = Math.min(parseInt(query.pageSize || "20", 10), 100);

    const where: Record<string, unknown> = {
      report: { organizationId: user.organizationId },
    };
    if (query.sourceIp) where.sourceIp = query.sourceIp;
    if (query.headerFrom) where.headerFrom = { contains: query.headerFrom };
    if (query.disposition) where.disposition = query.disposition;
    if (query.spfResult) where.spfResult = query.spfResult;
    if (query.dkimResult) where.dkimResult = query.dkimResult;

    const [records, total] = await Promise.all([
      prisma.dmarcRecord.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          report: {
            include: {
              domain: { select: { domain: true } },
            },
          },
        },
        orderBy: { count: "desc" },
      }),
      prisma.dmarcRecord.count({ where }),
    ]);

    return {
      success: true,
      data: records.map((r) => ({
        id: r.id,
        sourceIp: r.sourceIp,
        sourceHost: r.sourceHost,
        sourceOrg: r.sourceOrg,
        count: r.count,
        disposition: r.disposition,
        dkimResult: r.dkimResult,
        spfResult: r.spfResult,
        headerFrom: r.headerFrom,
        domain: r.report.domain.domain,
        reportBeginDate: r.report.beginDate,
      })),
      meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    };
  });
}
