import { FastifyRequest, FastifyReply } from "fastify";

type Role = "SUPER_ADMIN" | "ORG_ADMIN" | "ANALYST" | "READER" | "API";

const ROLE_HIERARCHY: Record<Role, number> = {
  SUPER_ADMIN: 100,
  ORG_ADMIN: 80,
  ANALYST: 60,
  READER: 40,
  API: 30,
};

export function requireRole(...allowedRoles: Role[]) {
  return async function rbacMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = request.authUser;
    if (!user) {
      return reply.status(401).send({ success: false, error: "Authentication required" });
    }

    const userLevel = ROLE_HIERARCHY[user.role as Role] || 0;
    const requiredLevel = Math.min(...allowedRoles.map((r) => ROLE_HIERARCHY[r] || 0));

    if (userLevel < requiredLevel) {
      return reply.status(403).send({ success: false, error: "Insufficient permissions" });
    }

    // SUPER_ADMIN bypasses org checks
    if (user.role === "SUPER_ADMIN") return;

    // For org-scoped routes, validate org ID matches
    const orgId = (request.params as Record<string, string>)?.orgId;
    if (orgId && orgId !== user.organizationId) {
      return reply.status(403).send({ success: false, error: "Access denied to this organization" });
    }
  };
}

export function requireOrgAccess(orgIdParam = "orgId") {
  return async function orgMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = request.authUser;
    if (!user) {
      return reply.status(401).send({ success: false, error: "Authentication required" });
    }

    if (user.role === "SUPER_ADMIN") return;

    const orgId = (request.params as Record<string, string>)[orgIdParam];
    if (orgId && orgId !== user.organizationId) {
      return reply.status(403).send({ success: false, error: "Access denied to this organization" });
    }
  };
}
