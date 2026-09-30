import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { exportRequestSchema } from "@dmark-hole/shared";
import { exportQueue } from "../../lib/queue.js";

export async function reportRoutes(server: FastifyInstance): Promise<void> {
  // GET /reports/summary - Summary statistics for reports
  server.get("/summary", { preHandler: [authMiddleware, requireRole("ANALYST")] }, async (request) => {
    const user = request.authUser!;
    const query = request.query as { domainId?: string; from?: string; to?: string };

    const since = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const until = query.to ? new Date(query.to) : new Date();

    const whereBase = {
      organizationId: user.organizationId,
      createdAt: { gte: since, lte: until },
      ...(query.domainId ? { domainId: query.domainId } : {}),
    };

    const [totalReports, aggregateReports, forensicReports, totalRecords, dispositions] = await Promise.all([
      prisma.dmarcReport.count({ where: whereBase }),
      prisma.dmarcReport.count({ where: { ...whereBase, reportType: "AGGREGATE" } }),
      prisma.dmarcReport.count({ where: { ...whereBase, reportType: "FORENSIC" } }),
      prisma.dmarcRecord.count({
        where: { report: { ...whereBase } },
      }),
      prisma.dmarcRecord.groupBy({
        by: ["disposition"],
        where: { report: { ...whereBase } },
        _count: true,
      }),
    ]);

    return {
      success: true,
      data: {
        totalReports,
        aggregateReports,
        forensicReports,
        totalRecords,
        dispositions: dispositions.map((d) => ({ disposition: d.disposition, count: d._count })),
        dateRange: { from: since, to: until },
      },
    };
  });

  // POST /reports/export - Create export job
  server.post("/export", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const user = request.authUser!;
    const data = exportRequestSchema.parse(request.body);

    const exportJob = await prisma.exportJob.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        type: data.type,
        format: data.format,
        filters: {
          domainId: data.domainId,
          from: data.from,
          to: data.to,
          ...data.filters,
        },
      },
    });

    await exportQueue.add("export", {
      exportJobId: exportJob.id,
      organizationId: user.organizationId,
      userId: user.id,
    });

    return reply.status(201).send({
      success: true,
      data: { exportJobId: exportJob.id, status: "PENDING" },
    });
  });

  // GET /reports/exports - List export jobs
  server.get("/exports", { preHandler: [authMiddleware, requireRole("ANALYST")] }, async (request) => {
    const user = request.authUser!;

    const jobs = await prisma.exportJob.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return {
      success: true,
      data: jobs.map((j) => ({
        id: j.id,
        type: j.type,
        format: j.format,
        status: j.status,
        fileUrl: j.fileUrl,
        error: j.error,
        completedAt: j.completedAt,
        createdAt: j.createdAt,
      })),
    };
  });

  // GET /reports/exports/:exportJobId - Export job status
  server.get("/exports/:exportJobId", { preHandler: [authMiddleware, requireRole("ANALYST")] }, async (request, reply) => {
    const { exportJobId } = request.params as { exportJobId: string };
    const user = request.authUser!;

    const job = await prisma.exportJob.findFirst({
      where: { id: exportJobId, organizationId: user.organizationId },
    });

    if (!job) return reply.status(404).send({ success: false, error: "Export job not found" });

    return { success: true, data: job };
  });

  // GET /reports/export/download/:exportJobId - Download export file
  server.get("/export/download/:exportJobId", { preHandler: [authMiddleware, requireRole("ANALYST")] }, async (request, reply) => {
    const { exportJobId } = request.params as { exportJobId: string };
    const user = request.authUser!;

    const job = await prisma.exportJob.findFirst({
      where: { id: exportJobId, organizationId: user.organizationId },
    });

    if (!job || job.status !== "COMPLETED" || !job.fileUrl) {
      return reply.status(404).send({ success: false, error: "Export not available" });
    }

    return reply.redirect(job.fileUrl);
  });
}
