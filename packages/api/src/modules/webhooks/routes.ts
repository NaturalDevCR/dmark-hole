import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { webhookIngestSchema } from "@dmark-hole/shared";
import { sanitizeXml, sha256 } from "@dmark-hole/shared/utils";
import { parseQueue } from "../../lib/queue.js";

export async function webhookRoutes(server: FastifyInstance): Promise<void> {
  // POST /webhooks/ingest - Public DMARC report ingestion webhook
  server.post("/ingest", async (request, reply) => {
    try {
      const data = webhookIngestSchema.parse(request.body);

      // Find domain
      const domain = await prisma.domain.findUnique({
        where: { domain: data.domain, active: true },
      });

      if (!domain) {
        return reply.status(404).send({
          success: false,
          error: `Domain '${data.domain}' not registered in the platform`,
        });
      }

      const sanitized = sanitizeXml(data.rawReport);
      const xmlHash = sha256(sanitized);

      // Check duplicate
      const existing = await prisma.dmarcReport.findFirst({
        where: { rawXmlHash: xmlHash, domainId: domain.id },
      });

      if (existing) {
        return reply.status(409).send({
          success: false,
          error: "Duplicate report - already processed",
          existingReportId: existing.id,
        });
      }

      // Validate size
      if (sanitized.length > 50 * 1024 * 1024) {
        return reply.status(413).send({
          success: false,
          error: "Report too large (max 50MB)",
        });
      }

      // Queue for parsing
      const job = await parseQueue.add("webhook-parse", {
        organizationId: domain.organizationId,
        domainId: domain.id,
        rawXml: sanitized,
        xmlHash,
        reportType: data.reportType,
        ingestedFrom: "webhook",
      });

      return reply.status(202).send({
        success: true,
        data: {
          message: "Report queued for processing",
          jobId: job.id,
          domain: data.domain,
          reportType: data.reportType,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        return reply.status(400).send({
          success: false,
          error: "Invalid request payload",
          details: (error as { issues?: unknown }).issues,
        });
      }
      throw error;
    }
  });

  // GET /webhooks/ingest/status - Check webhook status
  server.get("/ingest/status", async () => {
    return {
      success: true,
      data: {
        status: "operational",
        version: "1.0.0",
        supportedFormats: ["application/xml", "text/xml", "application/zip", "application/gzip"],
        maxSize: "50MB",
      },
    };
  });

  // POST /webhooks/ingest/bulk - Bulk report ingestion
  server.post("/ingest/bulk", async (request, reply) => {
    try {
      const body = request.body as { reports?: Array<{ domain: string; rawReport: string; reportType?: string }> };

      if (!body.reports || !Array.isArray(body.reports)) {
        return reply.status(400).send({ success: false, error: "Missing 'reports' array" });
      }

      if (body.reports.length > 50) {
        return reply.status(400).send({ success: false, error: "Maximum 50 reports per bulk request" });
      }

      const jobs = [];

      for (const report of body.reports) {
        const domain = await prisma.domain.findUnique({
          where: { domain: report.domain, active: true },
        });

        if (!domain) {
          jobs.push({
            domain: report.domain,
            status: "rejected",
            error: "Domain not registered",
          });
          continue;
        }

        const sanitized = sanitizeXml(report.rawReport);
        const xmlHash = sha256(sanitized);

        const existing = await prisma.dmarcReport.findFirst({
          where: { rawXmlHash: xmlHash, domainId: domain.id },
        });

        if (existing) {
          jobs.push({
            domain: report.domain,
            status: "duplicate",
            existingReportId: existing.id,
          });
          continue;
        }

        await parseQueue.add("bulk-parse", {
          organizationId: domain.organizationId,
          domainId: domain.id,
          rawXml: sanitized,
          xmlHash,
          reportType: report.reportType || "AGGREGATE",
          ingestedFrom: "webhook-bulk",
        });

        jobs.push({
          domain: report.domain,
          status: "queued",
        });
      }

      return reply.status(202).send({
        success: true,
        data: {
          processed: jobs.length,
          results: jobs,
        },
      });
    } catch (error) {
      server.log.error(error);
      return reply.status(500).send({ success: false, error: "Internal server error" });
    }
  });
}
