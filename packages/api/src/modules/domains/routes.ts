import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { createDomainSchema } from "@dmark-hole/shared";

async function getDomainForOrg(domainId: string, organizationId: string) {
  return prisma.domain.findUnique({
    where: { id: domainId, organizationId },
  });
}

export async function domainRoutes(server: FastifyInstance): Promise<void> {
  // POST / - Create a new domain
  server.post("/", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const data = createDomainSchema.parse(request.body);
    const user = request.authUser!;

    const existing = await prisma.domain.findUnique({ where: { domain: data.domain } });
    if (existing) {
      return reply.status(409).send({ success: false, error: "Domain already registered" });
    }

    const domain = await prisma.domain.create({
      data: {
        organizationId: user.organizationId,
        domain: data.domain,
        displayName: data.displayName || null,
        monitoringMode: data.monitoringMode,
        tags: data.tags,
      },
    });

    return reply.status(201).send({
      success: true,
      data: {
        id: domain.id,
        domain: domain.domain,
        displayName: domain.displayName,
        verified: domain.verified,
        monitoringMode: domain.monitoringMode,
        tags: domain.tags,
        createdAt: domain.createdAt,
      },
    });
  });

  // GET / - List all domains for the org (with pagination)
  server.get("/", { preHandler: [authMiddleware] }, async (request) => {
    const user = request.authUser!;
    const query = request.query as { page?: string; pageSize?: string; search?: string };
    const page = Math.max(parseInt(query.page || "1", 10), 1);
    const pageSize = Math.min(Math.max(parseInt(query.pageSize || "20", 10), 1), 100);

    const where: Record<string, unknown> = { organizationId: user.organizationId };

    if (user.role !== "SUPER_ADMIN") {
      where.organizationId = user.organizationId;
    } else {
      delete where.organizationId;
    }

    if (query.search) {
      where.domain = { contains: query.search, mode: "insensitive" };
    }

    const [domains, total] = await Promise.all([
      prisma.domain.findMany({
        where: where as any,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: { select: { dnsRecords: true, alerts: true } },
          dmarcSummary: {
            orderBy: { date: "desc" },
            take: 1,
            select: { healthScore: true, totalEmails: true },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.domain.count({ where: where as any }),
    ]);

    return {
      success: true,
      data: domains.map((d) => ({
        id: d.id,
        domain: d.domain,
        displayName: d.displayName,
        verified: d.verified,
        active: d.active,
        monitoringMode: d.monitoringMode,
        tags: d.tags,
        dnsRecordCount: d._count.dnsRecords,
        alertCount: d._count.alerts,
        healthScore: d.dmarcSummary[0]?.healthScore ?? null,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
      meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    };
  });

  // GET /:domainId - Get domain details with health stats
  server.get("/:domainId", { preHandler: [authMiddleware] }, async (request, reply) => {
    const { domainId } = request.params as { domainId: string };
    const user = request.authUser!;

    const domain = await prisma.domain.findUnique({
      where: { id: domainId },
      include: {
        _count: { select: { dnsRecords: true, alerts: true, reports: true } },
        dnsRecords: { orderBy: { type: "asc" } },
        dmarcSummary: {
          orderBy: { date: "desc" },
          take: 30,
          select: {
            date: true,
            totalEmails: true,
            spfPass: true,
            dkimPass: true,
            dmarcPass: true,
            healthScore: true,
          },
        },
      },
    });

    if (!domain) {
      return reply.status(404).send({ success: false, error: "Domain not found" });
    }

    if (user.role !== "SUPER_ADMIN" && domain.organizationId !== user.organizationId) {
      return reply.status(403).send({ success: false, error: "Access denied" });
    }

    const latestSummary = domain.dmarcSummary[0];

    return {
      success: true,
      data: {
        id: domain.id,
        domain: domain.domain,
        displayName: domain.displayName,
        verified: domain.verified,
        active: domain.active,
        monitoringMode: domain.monitoringMode,
        tags: domain.tags,
        notes: domain.notes,
        dnsRecords: domain.dnsRecords.map((r) => ({
          id: r.id,
          type: r.type,
          host: r.host,
          value: r.value,
          ttl: r.ttl,
          valid: r.valid,
          errors: r.errors,
          checkedAt: r.checkedAt,
        })),
        healthStats: latestSummary
          ? {
              healthScore: latestSummary.healthScore,
              totalEmails: latestSummary.totalEmails,
              spfPassRate: latestSummary.totalEmails > 0 ? (latestSummary.spfPass / latestSummary.totalEmails) * 100 : 0,
              dkimPassRate: latestSummary.totalEmails > 0 ? (latestSummary.dkimPass / latestSummary.totalEmails) * 100 : 0,
              dmarcPassRate: latestSummary.totalEmails > 0 ? (latestSummary.dmarcPass / latestSummary.totalEmails) * 100 : 0,
            }
          : null,
        recordCount: domain._count.dnsRecords,
        alertCount: domain._count.alerts,
        reportCount: domain._count.reports,
        healthHistory: domain.dmarcSummary.map((s) => ({
          date: s.date,
          healthScore: s.healthScore,
          totalEmails: s.totalEmails,
        })),
        createdAt: domain.createdAt,
        updatedAt: domain.updatedAt,
      },
    };
  });

  // PATCH /:domainId - Update domain
  server.patch("/:domainId", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const { domainId } = request.params as { domainId: string };
    const user = request.authUser!;
    const data = request.body as Record<string, unknown>;

    const domain = await getDomainForOrg(domainId, user.organizationId);
    if (!domain) {
      return reply.status(404).send({ success: false, error: "Domain not found or access denied" });
    }

    const updateData: Record<string, unknown> = {};
    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.monitoringMode !== undefined) updateData.monitoringMode = data.monitoringMode;
    if (data.tags !== undefined) updateData.tags = data.tags;
    if (data.notes !== undefined) updateData.notes = data.notes;

    const updated = await prisma.domain.update({
      where: { id: domainId },
      data: updateData,
    });

    return { success: true, data: updated };
  });

  // DELETE /:domainId - Soft-delete (set active=false)
  server.delete("/:domainId", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const { domainId } = request.params as { domainId: string };
    const user = request.authUser!;

    const domain = await getDomainForOrg(domainId, user.organizationId);
    if (!domain) {
      return reply.status(404).send({ success: false, error: "Domain not found or access denied" });
    }

    await prisma.domain.update({
      where: { id: domainId },
      data: { active: false },
    });

    return { success: true };
  });

  // POST /:domainId/verify - Generate verification code
  server.post("/:domainId/verify", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const { domainId } = request.params as { domainId: string };
    const user = request.authUser!;

    const domain = await getDomainForOrg(domainId, user.organizationId);
    if (!domain) {
      return reply.status(404).send({ success: false, error: "Domain not found or access denied" });
    }

    if (domain.verified) {
      return reply.status(409).send({ success: false, error: "Domain already verified" });
    }

    const code = `dmark-hole-verify=${domainId}`;
    const txtName = `${domain.domain}`;

    return {
      success: true,
      data: {
        domain: domain.domain,
        method: "DNS_TXT",
        host: txtName,
        value: code,
        instructions: `Add a TXT record for ${domain.domain} with value: ${code}`,
      },
    };
  });

  // GET /:domainId/verify - Check verification status
  server.get("/:domainId/verify", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const { domainId } = request.params as { domainId: string };
    const user = request.authUser!;

    const domain = await getDomainForOrg(domainId, user.organizationId);
    if (!domain) {
      return reply.status(404).send({ success: false, error: "Domain not found or access denied" });
    }

    const code = `dmark-hole-verify=${domainId}`;

    try {
      const dns = await import("node:dns/promises");
      const records = await dns.resolveTxt(domain.domain);
      const found = records.some((record) => record.join("").includes(code));

      if (found && !domain.verified) {
        await prisma.domain.update({
          where: { id: domainId },
          data: { verified: true },
        });
        return { success: true, data: { verified: true, domain: domain.domain } };
      }

      return {
        success: true,
        data: {
          verified: domain.verified,
          domain: domain.domain,
          checked: found,
        },
      };
    } catch {
      return {
        success: true,
        data: {
          verified: domain.verified,
          domain: domain.domain,
          checked: false,
          message: "Could not resolve DNS records. The domain may not have propagated yet.",
        },
      };
    }
  });
}
