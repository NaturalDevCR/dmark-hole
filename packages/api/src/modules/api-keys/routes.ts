import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { createApiKeySchema } from "@dmark-hole/shared";
import { generateApiKey, sha256 } from "@dmark-hole/shared/utils";

export async function apiKeyRoutes(server: FastifyInstance): Promise<void> {
  // GET /api-keys - List API keys for org
  server.get("/", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request) => {
    const user = request.authUser!;

    const keys = await prisma.apiKey.findMany({
      where: { organizationId: user.organizationId },
      select: {
        id: true,
        name: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        active: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return { success: true, data: keys };
  });

  // POST /api-keys - Create new API key
  server.post("/", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const user = request.authUser!;
    const data = createApiKeySchema.parse(request.body);

    const { key, hash } = generateApiKey();

    const apiKey = await prisma.apiKey.create({
      data: {
        organizationId: user.organizationId,
        name: data.name,
        key,
        hash,
        scopes: data.scopes,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      },
    });

    return reply.status(201).send({
      success: true,
      data: {
        id: apiKey.id,
        name: apiKey.name,
        key, // Only time the full key is returned
        scopes: apiKey.scopes,
        expiresAt: apiKey.expiresAt,
      },
    });
  });

  // PATCH /api-keys/:keyId - Toggle active or update
  server.patch("/:keyId", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const { keyId } = request.params as { keyId: string };
    const user = request.authUser!;
    const data = request.body as { name?: string; active?: boolean; scopes?: string[] };

    const key = await prisma.apiKey.findFirst({
      where: { id: keyId, organizationId: user.organizationId },
    });

    if (!key) return reply.status(404).send({ success: false, error: "API key not found" });

    await prisma.apiKey.update({ where: { id: keyId }, data });

    return { success: true };
  });

  // DELETE /api-keys/:keyId - Revoke API key
  server.delete("/:keyId", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const { keyId } = request.params as { keyId: string };
    const user = request.authUser!;

    await prisma.apiKey.update({
      where: { id: keyId, organizationId: user.organizationId },
      data: { active: false },
    });

    return { success: true };
  });

  // Middleware for authenticating API requests via X-API-Key header
  server.decorate("authenticateApiKey", async (request: FastifyInstance["request"], reply: FastifyInstance["reply"]) => {
    const apiKey = request.headers["x-api-key"] as string;
    if (!apiKey) return reply.status(401).send({ success: false, error: "API key required" });

    const hash = sha256(apiKey);
    const key = await prisma.apiKey.findFirst({
      where: { hash, active: true },
      include: { organization: { select: { plan: true } } },
    });

    if (!key) return reply.status(401).send({ success: false, error: "Invalid API key" });
    if (key.expiresAt && key.expiresAt < new Date()) {
      return reply.status(401).send({ success: false, error: "API key expired" });
    }

    // Update last used
    await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

    // Set auth user for API access
    request.authUser = {
      id: key.id,
      organizationId: key.organizationId,
      email: `api-${key.name}@dmark-hole.local`,
      name: key.name,
      role: "API",
      plan: key.organization.plan,
    };
  });
}
