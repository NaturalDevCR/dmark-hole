import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { createNotificationRuleSchema } from "@dmark-hole/shared";

export async function alertRoutes(server: FastifyInstance): Promise<void> {
  // GET /alerts - List alerts for org
  server.get("/", { preHandler: [authMiddleware, requireRole("ANALYST")] }, async (request) => {
    const user = request.authUser!;
    const query = request.query as {
      domainId?: string;
      type?: string;
      severity?: string;
      acknowledged?: string;
      resolved?: string;
      page?: string;
      pageSize?: string;
    };
    const page = parseInt(query.page || "1", 10);
    const pageSize = Math.min(parseInt(query.pageSize || "20", 10), 100);

    const where: Record<string, unknown> = { organizationId: user.organizationId };
    if (query.domainId) where.domainId = query.domainId;
    if (query.type) where.type = query.type;
    if (query.severity) where.severity = query.severity;
    if (query.acknowledged) where.acknowledged = query.acknowledged === "true";
    if (query.resolved) where.resolved = query.resolved === "true";

    const [alerts, total] = await Promise.all([
      prisma.alert.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          domain: { select: { domain: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.alert.count({ where }),
    ]);

    return {
      success: true,
      data: alerts.map((a) => ({
        id: a.id,
        domainId: a.domainId,
        domain: a.domain?.domain,
        type: a.type,
        severity: a.severity,
        title: a.title,
        description: a.description,
        metadata: a.metadata,
        acknowledged: a.acknowledged,
        resolved: a.resolved,
        createdAt: a.createdAt,
      })),
      meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    };
  });

  // GET /alerts/summary - Alert counts by severity and type
  server.get("/summary", { preHandler: [authMiddleware, requireRole("ANALYST")] }, async (request) => {
    const user = request.authUser!;

    const [bySeverity, byType, totalOpen, totalCritical] = await Promise.all([
      prisma.alert.groupBy({
        by: ["severity"],
        where: { organizationId: user.organizationId, resolved: false },
        _count: true,
      }),
      prisma.alert.groupBy({
        by: ["type"],
        where: { organizationId: user.organizationId, resolved: false },
        _count: true,
        orderBy: { _count: { type: "desc" } },
      }),
      prisma.alert.count({
        where: { organizationId: user.organizationId, resolved: false },
      }),
      prisma.alert.count({
        where: { organizationId: user.organizationId, resolved: false, severity: "CRITICAL" },
      }),
    ]);

    return {
      success: true,
      data: {
        totalOpen,
        totalCritical,
        bySeverity: bySeverity.map((s) => ({ severity: s.severity, count: s._count })),
        byType: byType.slice(0, 10).map((t) => ({ type: t.type, count: t._count })),
      },
    };
  });

  // PATCH /alerts/:alertId/acknowledge
  server.patch("/:alertId/acknowledge", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const { alertId } = request.params as { alertId: string };
    const user = request.authUser!;

    const alert = await prisma.alert.findFirst({
      where: { id: alertId, organizationId: user.organizationId },
    });

    if (!alert) return reply.status(404).send({ success: false, error: "Alert not found" });

    await prisma.alert.update({
      where: { id: alertId },
      data: { acknowledged: true, acknowledgedBy: user.id },
    });

    return { success: true };
  });

  // PATCH /alerts/:alertId/resolve
  server.patch("/:alertId/resolve", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const { alertId } = request.params as { alertId: string };
    const user = request.authUser!;

    await prisma.alert.update({
      where: { id: alertId, organizationId: user.organizationId },
      data: { resolved: true, resolvedAt: new Date() },
    });

    return { success: true };
  });

  // POST /alerts/acknowledge-all - Bulk acknowledge
  server.post("/acknowledge-all", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request) => {
    const user = request.authUser!;
    const body = request.body as { alertIds?: string[]; severity?: string };

    const where: Record<string, unknown> = { organizationId: user.organizationId, resolved: false };
    if (body.alertIds) where.id = { in: body.alertIds };
    if (body.severity) where.severity = body.severity;

    await prisma.alert.updateMany({
      where,
      data: { acknowledged: true, acknowledgedBy: user.id },
    });

    return { success: true };
  });

  // ===========================================================================
  // Notification Rules
  // ===========================================================================

  // GET /alerts/notification-rules
  server.get("/notification-rules", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request) => {
    const user = request.authUser!;

    const rules = await prisma.notificationRule.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: "desc" },
    });

    return { success: true, data: rules };
  });

  // POST /alerts/notification-rules
  server.post("/notification-rules", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const user = request.authUser!;
    const data = createNotificationRuleSchema.parse(request.body);

    const rule = await prisma.notificationRule.create({
      data: {
        organizationId: user.organizationId,
        name: data.name,
        enabled: data.enabled,
        alertTypes: data.alertTypes,
        minSeverity: data.minSeverity,
        channels: data.channels,
        config: data.config,
      },
    });

    return reply.status(201).send({ success: true, data: rule });
  });

  // PATCH /alerts/notification-rules/:ruleId
  server.patch("/notification-rules/:ruleId", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const { ruleId } = request.params as { ruleId: string };
    const user = request.authUser!;
    const data = request.body as Record<string, unknown>;

    await prisma.notificationRule.update({
      where: { id: ruleId, organizationId: user.organizationId },
      data,
    });

    return { success: true };
  });

  // DELETE /alerts/notification-rules/:ruleId
  server.delete("/notification-rules/:ruleId", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const { ruleId } = request.params as { ruleId: string };
    const user = request.authUser!;

    await prisma.notificationRule.delete({
      where: { id: ruleId, organizationId: user.organizationId },
    });

    return { success: true };
  });
}
