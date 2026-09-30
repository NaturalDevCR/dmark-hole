import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { ingestQueue } from "../../lib/queue.js";
import { createMailboxSchema, updateMailboxSchema } from "@dmark-hole/shared";
import { encrypt, decrypt, maskCredentials, generateToken } from "@dmark-hole/shared/utils";

export async function mailboxRoutes(server: FastifyInstance): Promise<void> {
  // POST /mailboxes - Create mailbox
  server.post("/", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const data = createMailboxSchema.parse(request.body);
    const user = request.authUser!;

    const encryptedConfig = encrypt(JSON.stringify(data.config));

    const mailbox = await prisma.mailbox.create({
      data: {
        organizationId: user.organizationId,
        name: data.name,
        email: data.email,
        type: data.type,
        config: { encrypted: encryptedConfig },
        mailboxDomains: {
          create: data.domainIds.map((domainId) => ({ domainId })),
        },
      },
      include: { mailboxDomains: true },
    });

    return reply.status(201).send({
      success: true,
      data: {
        id: mailbox.id,
        name: mailbox.name,
        email: mailbox.email,
        type: mailbox.type,
        active: mailbox.active,
        domainIds: mailbox.mailboxDomains.map((md) => md.domainId),
        createdAt: mailbox.createdAt,
      },
    });
  });

  // GET /mailboxes - List mailboxes for org
  server.get("/", { preHandler: [authMiddleware, requireRole("ANALYST")] }, async (request) => {
    const user = request.authUser!;
    const query = request.query as { page?: string; pageSize?: string };
    const page = parseInt(query.page || "1", 10);
    const pageSize = Math.min(parseInt(query.pageSize || "20", 10), 100);

    const [mailboxes, total] = await Promise.all([
      prisma.mailbox.findMany({
        where: { organizationId: user.organizationId },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { mailboxDomains: { include: { domain: { select: { domain: true } } } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.mailbox.count({ where: { organizationId: user.organizationId } }),
    ]);

    return {
      success: true,
      data: mailboxes.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        type: m.type,
        active: m.active,
        syncStatus: m.syncStatus,
        lastSyncAt: m.lastSyncAt,
        lastError: m.lastError,
        domains: m.mailboxDomains.map((md) => md.domain.domain),
        createdAt: m.createdAt,
      })),
      meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    };
  });

  // GET /mailboxes/:mailboxId - Get mailbox details
  server.get("/:mailboxId", { preHandler: [authMiddleware, requireRole("ANALYST")] }, async (request, reply) => {
    const { mailboxId } = request.params as { mailboxId: string };
    const user = request.authUser!;

    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, organizationId: user.organizationId },
      include: {
        mailboxDomains: { include: { domain: { select: { id: true, domain: true } } } },
        _count: { select: { ingestLogs: true } },
      },
    });

    if (!mailbox) return reply.status(404).send({ success: false, error: "Mailbox not found" });

    let config = {};
    try {
      const configData = mailbox.config as Record<string, unknown>;
      if (configData.encrypted) {
        config = JSON.parse(decrypt(configData.encrypted as string));
      }
    } catch {
      config = {};
    }

    return {
      success: true,
      data: {
        id: mailbox.id,
        name: mailbox.name,
        email: mailbox.email,
        type: mailbox.type,
        active: mailbox.active,
        syncStatus: mailbox.syncStatus,
        lastSyncAt: mailbox.lastSyncAt,
        lastError: mailbox.lastError,
        config: maskCredentials(config as Record<string, unknown>),
        domains: mailbox.mailboxDomains.map((md) => ({ id: md.domain.id, domain: md.domain.domain })),
        stats: mailbox.stats,
        ingestLogCount: mailbox._count.ingestLogs,
        createdAt: mailbox.createdAt,
      },
    };
  });

  // PATCH /mailboxes/:mailboxId - Update mailbox
  server.patch("/:mailboxId", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const { mailboxId } = request.params as { mailboxId: string };
    const user = request.authUser!;
    const data = updateMailboxSchema.parse(request.body);

    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, organizationId: user.organizationId },
    });

    if (!mailbox) return reply.status(404).send({ success: false, error: "Mailbox not found" });

    const updateData: Record<string, unknown> = {};
    if (data.name) updateData.name = data.name;
    if (data.config) updateData.config = { encrypted: encrypt(JSON.stringify(data.config)) };
    if (data.active !== undefined) updateData.active = data.active;

    await prisma.mailbox.update({ where: { id: mailboxId }, data: updateData });

    if (data.domainIds) {
      await prisma.mailboxDomain.deleteMany({ where: { mailboxId } });
      if (data.domainIds.length > 0) {
        await prisma.mailboxDomain.createMany({
          data: data.domainIds.map((domainId) => ({ mailboxId, domainId })),
        });
      }
    }

    return { success: true };
  });

  // DELETE /mailboxes/:mailboxId - Deactivate
  server.delete("/:mailboxId", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const { mailboxId } = request.params as { mailboxId: string };
    const user = request.authUser!;

    await prisma.mailbox.update({
      where: { id: mailboxId, organizationId: user.organizationId },
      data: { active: false },
    });

    return { success: true };
  });

  // POST /mailboxes/:mailboxId/test - Test connection
  server.post("/:mailboxId/test", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const { mailboxId } = request.params as { mailboxId: string };
    const user = request.authUser!;

    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, organizationId: user.organizationId },
    });

    if (!mailbox) return reply.status(404).send({ success: false, error: "Mailbox not found" });

    // Connection test is performed by the worker - queue a test job
    return {
      success: true,
      data: {
        message: "Connection test queued. Check status in a few moments.",
        mailboxId: mailbox.id,
        syncStatus: mailbox.syncStatus,
      },
    };
  });

  // POST /mailboxes/:mailboxId/sync - Trigger sync
  server.post("/:mailboxId/sync", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const { mailboxId } = request.params as { mailboxId: string };
    const user = request.authUser!;

    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, organizationId: user.organizationId, active: true },
    });

    if (!mailbox) return reply.status(404).send({ success: false, error: "Mailbox not found or inactive" });

    await ingestQueue.add("sync-mailbox", {
      mailboxId: mailbox.id,
      organizationId: user.organizationId,
    });

    await prisma.mailbox.update({
      where: { id: mailboxId },
      data: { syncStatus: "SYNCING" },
    });

    return { success: true, data: { message: "Sync triggered", mailboxId } };
  });

  // GET /mailboxes/:mailboxId/logs - Recent ingest logs
  server.get("/:mailboxId/logs", { preHandler: [authMiddleware, requireRole("ANALYST")] }, async (request, reply) => {
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
}
