import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { auditMiddleware } from "../../middleware/audit.js";
import { createUserSchema, updateUserSchema } from "@dmark-hole/shared";
import bcrypt from "bcryptjs";

export async function organizationRoutes(server: FastifyInstance): Promise<void> {
  // GET /organizations/:orgId
  server.get("/:orgId", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request) => {
    const { orgId } = request.params as { orgId: string };

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        _count: { select: { domains: true, users: true, mailboxes: true } },
      },
    });

    if (!org) return { success: false, error: "Organization not found" };

    return {
      success: true,
      data: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        plan: org.plan,
        active: org.active,
        settings: org.settings,
        domainCount: org._count.domains,
        userCount: org._count.users,
        mailboxCount: org._count.mailboxes,
        createdAt: org.createdAt,
      },
    };
  });

  // PATCH /organizations/:orgId
  server.patch("/:orgId", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request) => {
    const { orgId } = request.params as { orgId: string };
    const data = request.body as Record<string, unknown>;

    const org = await prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(data.name && { name: data.name as string }),
        ...(data.settings && { settings: data.settings }),
      },
    });

    return { success: true, data: org };
  });

  // GET /organizations/:orgId/users
  server.get("/:orgId/users", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request) => {
    const { orgId } = request.params as { orgId: string };

    const users = await prisma.user.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return { success: true, data: users };
  });

  // POST /organizations/:orgId/users
  server.post("/:orgId/users", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const data = createUserSchema.parse(request.body);

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      return reply.status(409).send({ success: false, error: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(data.password, 12);

    const user = await prisma.user.create({
      data: {
        organizationId: orgId,
        email: data.email,
        passwordHash,
        name: data.name,
        role: data.role,
      },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    return reply.status(201).send({ success: true, data: user });
  });

  // PATCH /organizations/:orgId/users/:userId
  server.patch("/:orgId/users/:userId", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request) => {
    const { orgId, userId } = request.params as { orgId: string; userId: string };
    const data = updateUserSchema.parse(request.body);

    const user = await prisma.user.update({
      where: { id: userId, organizationId: orgId },
      data,
      select: { id: true, email: true, name: true, role: true, active: true },
    });

    return { success: true, data: user };
  });

  // DELETE /organizations/:orgId/users/:userId
  server.delete("/:orgId/users/:userId", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request) => {
    const { orgId, userId } = request.params as { orgId: string; userId: string };

    await prisma.user.update({
      where: { id: userId, organizationId: orgId },
      data: { active: false },
    });

    return { success: true };
  });

  // GET /organizations/:orgId/settings
  server.get("/:orgId/settings", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request) => {
    const { orgId } = request.params as { orgId: string };

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { settings: true, plan: true },
    });

    return { success: true, data: org };
  });

  // Super Admin: list all organizations
  server.get("/", { preHandler: [authMiddleware, requireRole("SUPER_ADMIN")] }, async (request) => {
    const query = request.query as { page?: string; pageSize?: string };
    const page = parseInt(query.page || "1", 10);
    const pageSize = Math.min(parseInt(query.pageSize || "20", 10), 100);

    const [orgs, total] = await Promise.all([
      prisma.organization.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { domains: true, users: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.organization.count(),
    ]);

    return {
      success: true,
      data: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        plan: o.plan,
        active: o.active,
        domainCount: o._count.domains,
        userCount: o._count.users,
        createdAt: o.createdAt,
      })),
      meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    };
  });
}
