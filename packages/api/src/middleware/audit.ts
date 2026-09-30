import { FastifyRequest, FastifyReply } from "fastify";

export async function auditMiddleware(
  action: string,
  resource: string,
  resourceIdFn?: (req: FastifyRequest) => string | undefined,
) {
  return async function (request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const { prisma } = await import("../lib/prisma.js");
    const user = request.authUser;

    if (!user) return;

    const resourceId = resourceIdFn ? resourceIdFn(request) : undefined;

    await prisma.auditLog.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        action,
        resource,
        resourceId,
        ip: request.ip,
        userAgent: request.headers["user-agent"] || null,
        details: {
          method: request.method,
          url: request.url,
        },
      },
    }).catch(() => {
      // Non-blocking audit
    });
  };
}
