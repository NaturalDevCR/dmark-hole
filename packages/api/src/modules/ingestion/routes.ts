import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { ingestQueue, parseQueue } from "../../lib/queue.js";
import { sanitizeXml, sha256 } from "@dmark-hole/shared/utils";
import { webhookIngestSchema } from "@dmark-hole/shared";

export async function ingestionRoutes(server: FastifyInstance): Promise<void> {
  // GET /ingestion/mailboxes/:mailboxId/status
  server.get("/mailboxes/:mailboxId/status", { preHandler: [authMiddleware, requireRole("ANALYST")] }, async (request, reply) => {
    const { mailboxId } = request.params as { mailboxId: string };
    const user = request.authUser!;

    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, organizationId: user.organizationId },
      select: { id: true, syncStatus: true, lastSyncAt: true, lastError: true, stats: true },
    });

    if (!mailbox) return reply.status(404).send({ success: false, error: "Mailbox not found" });

    const recentLogs = await prisma.ingestLog.findMany({
      where: { mailboxId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    const successRate = recentLogs.length > 0
      ? (recentLogs.filter((l) => l.success).length / recentLogs.length) * 100
      : 0;

    return {
      success: true,
      data: {
        ...mailbox,
        recentLogs,
        successRate: Math.round(successRate * 100) / 100,
      },
    };
  });

  // POST /ingestion/mailboxes/:mailboxId/trigger
  server.post("/mailboxes/:mailboxId/trigger", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const { mailboxId } = request.params as { mailboxId: string };
    const user = request.authUser!;

    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, organizationId: user.organizationId, active: true },
    });

    if (!mailbox) return reply.status(404).send({ success: false, error: "Mailbox not found or inactive" });

    const job = await ingestQueue.add("manual-trigger", {
      mailboxId: mailbox.id,
      organizationId: user.organizationId,
    });

    return {
      success: true,
      data: { message: "Ingestion triggered", jobId: job.id },
    };
  });

  // GET /ingestion/mailboxes/:mailboxId/emails
  server.get("/mailboxes/:mailboxId/emails", { preHandler: [authMiddleware, requireRole("ANALYST")] }, async (request, reply) => {
    const { mailboxId } = request.params as { mailboxId: string };
    const user = request.authUser!;
    const query = request.query as { page?: string; pageSize?: string };
    const page = parseInt(query.page || "1", 10);
    const pageSize = Math.min(parseInt(query.pageSize || "50", 10), 100);

    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, organizationId: user.organizationId },
    });

    if (!mailbox) return reply.status(404).send({ success: false, error: "Mailbox not found" });

    const [logs, total] = await Promise.all([
      prisma.ingestLog.findMany({
        where: { mailboxId },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      prisma.ingestLog.count({ where: { mailboxId } }),
    ]);

    return {
      success: true,
      data: logs,
      meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    };
  });

  // POST /ingestion/manual - Manual XML submission
  server.post("/manual", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const user = request.authUser!;
    let rawXml: string;

    const contentType = request.headers["content-type"] || "";

    if (contentType.includes("multipart/form-data")) {
      const file = await request.file();
      if (!file) return reply.status(400).send({ success: false, error: "No XML file provided" });
      const buffer = await file.toBuffer();
      rawXml = buffer.toString("utf-8");
    } else {
      const body = request.body as { rawXml?: string; domain?: string };
      rawXml = body.rawXml || "";
    }

    if (!rawXml) {
      return reply.status(400).send({ success: false, error: "No XML content provided" });
    }

    if (rawXml.length > 50 * 1024 * 1024) {
      return reply.status(413).send({ success: false, error: "XML too large (max 50MB)" });
    }

    const sanitized = sanitizeXml(rawXml);
    const xmlHash = sha256(sanitized);

    // Check for duplicate
    const existing = await prisma.dmarcReport.findFirst({
      where: { rawXmlHash: xmlHash, organizationId: user.organizationId },
    });

    if (existing) {
      return reply.status(409).send({
        success: false,
        error: "Duplicate report already ingested",
        existingReportId: existing.id,
      });
    }

    // Queue for parsing
    const job = await parseQueue.add("manual-parse", {
      organizationId: user.organizationId,
      rawXml: sanitized,
      xmlHash,
    });

    return reply.status(202).send({
      success: true,
      data: { message: "XML queued for processing", jobId: job.id },
    });
  });

  // GET /ingestion/stats
  server.get("/stats", { preHandler: [authMiddleware, requireRole("ANALYST")] }, async (request) => {
    const user = request.authUser!;
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [totalLogs, recentLogs, successLogs, reports] = await Promise.all([
      prisma.ingestLog.count({
        where: { mailbox: { organizationId: user.organizationId } },
      }),
      prisma.ingestLog.findMany({
        where: {
          mailbox: { organizationId: user.organizationId },
          createdAt: { gte: sevenDaysAgo },
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      prisma.ingestLog.count({
        where: {
          mailbox: { organizationId: user.organizationId },
          success: true,
          createdAt: { gte: sevenDaysAgo },
        },
      }),
      prisma.dmarcReport.count({
        where: {
          organizationId: user.organizationId,
          createdAt: { gte: sevenDaysAgo },
        },
      }),
    ]);

    const dailyActivity: Record<string, { total: number; success: number; failed: number }> = {};
    for (const log of recentLogs) {
      const dateKey = log.createdAt.toISOString().split("T")[0]!;
      if (!dailyActivity[dateKey]) dailyActivity[dateKey] = { total: 0, success: 0, failed: 0 };
      dailyActivity[dateKey]!.total++;
      if (log.success) dailyActivity[dateKey]!.success++;
      else dailyActivity[dateKey]!.failed++;
    }

    return {
      success: true,
      data: {
        totalIngestLogs: totalLogs,
        recentLogsTotal: recentLogs.filter((l) => l.createdAt >= sevenDaysAgo).length,
        successRate: recentLogs.length > 0
          ? Math.round((successLogs / recentLogs.filter((l) => l.createdAt >= sevenDaysAgo).length) * 10000) / 100
          : 0,
        reportsIngested: reports,
        last7DaysActivity: dailyActivity,
      },
    };
  });

  // POST /ingestion/webhook - Public webhook for external report submission
  server.post("/webhook", async (request, reply) => {
    try {
      const data = webhookIngestSchema.parse(request.body);

      // Find domain
      const domain = await prisma.domain.findUnique({ where: { domain: data.domain } });
      if (!domain) return reply.status(404).send({ success: false, error: "Domain not registered" });

      const sanitized = sanitizeXml(data.rawReport);
      const xmlHash = sha256(sanitized);

      const existing = await prisma.dmarcReport.findFirst({
        where: { rawXmlHash: xmlHash, domainId: domain.id },
      });

      if (existing) {
        return reply.status(409).send({ success: false, error: "Duplicate report" });
      }

      await parseQueue.add("webhook-parse", {
        organizationId: domain.organizationId,
        domainId: domain.id,
        rawXml: sanitized,
        xmlHash,
        reportType: data.reportType,
      });

      return reply.status(202).send({ success: true, data: { message: "Report queued" } });
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        return reply.status(400).send({ success: false, error: "Invalid payload" });
      }
      throw error;
    }
  });
}
