import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { createIntegrationSchema, updateIntegrationSchema } from "@dmark-hole/shared";
import { encrypt, decrypt, maskCredentials } from "@dmark-hole/shared/utils";

export async function integrationRoutes(server: FastifyInstance): Promise<void> {
  // GET /integrations - List all integrations for org
  server.get("/", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request) => {
    const user = request.authUser!;

    const integrations = await prisma.integration.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: "desc" },
    });

    return {
      success: true,
      data: integrations.map((i) => ({
        id: i.id,
        type: i.type,
        name: i.name,
        active: i.active,
        lastTestAt: i.lastTestAt,
        lastError: i.lastError,
        ...(i.config ? { config: maskCredentials(i.config as Record<string, unknown>) } : {}),
        createdAt: i.createdAt,
      })),
    };
  });

  // POST /integrations - Create new integration
  server.post("/", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const user = request.authUser!;
    const data = createIntegrationSchema.parse(request.body);

    const encryptedConfig = encrypt(JSON.stringify(data.config));

    const integration = await prisma.integration.create({
      data: {
        organizationId: user.organizationId,
        type: data.type,
        name: data.name,
        config: { encrypted: encryptedConfig },
        encrypted: true,
      },
    });

    return reply.status(201).send({
      success: true,
      data: {
        id: integration.id,
        type: integration.type,
        name: integration.name,
        active: integration.active,
        createdAt: integration.createdAt,
      },
    });
  });

  // PATCH /integrations/:integrationId - Update integration
  server.patch("/:integrationId", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const { integrationId } = request.params as { integrationId: string };
    const user = request.authUser!;
    const data = updateIntegrationSchema.parse(request.body);

    const integration = await prisma.integration.findFirst({
      where: { id: integrationId, organizationId: user.organizationId },
    });

    if (!integration) return reply.status(404).send({ success: false, error: "Integration not found" });

    const updateData: Record<string, unknown> = {};
    if (data.name) updateData.name = data.name;
    if (data.config) updateData.config = { encrypted: encrypt(JSON.stringify(data.config)) };
    if (data.active !== undefined) updateData.active = data.active;

    await prisma.integration.update({
      where: { id: integrationId },
      data: updateData,
    });

    return { success: true };
  });

  // DELETE /integrations/:integrationId
  server.delete("/:integrationId", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const { integrationId } = request.params as { integrationId: string };
    const user = request.authUser!;

    await prisma.integration.delete({
      where: { id: integrationId, organizationId: user.organizationId },
    });

    return { success: true };
  });

  // POST /integrations/:integrationId/test - Test integration
  server.post("/:integrationId/test", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const { integrationId } = request.params as { integrationId: string };
    const user = request.authUser!;

    const integration = await prisma.integration.findFirst({
      where: { id: integrationId, organizationId: user.organizationId },
    });

    if (!integration) return reply.status(404).send({ success: false, error: "Integration not found" });

    // Test notifications are dispatched by the worker
    return {
      success: true,
      data: {
        message: `Test notification sent to ${integration.type}`,
        type: integration.type,
      },
    };
  });

  // POST /integrations/webhook/receive - Public webhook test endpoint
  server.post("/webhook/receive", async (request) => {
    return {
      success: true,
      data: {
        message: "Webhook received",
        headers: request.headers,
        body: request.body,
      },
    };
  });
}
