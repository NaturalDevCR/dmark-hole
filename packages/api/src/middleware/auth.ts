import { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../lib/prisma.js";

export interface AuthUser {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  role: string;
  plan: string;
}

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const token = extractToken(request);
    if (!token) {
      return reply.status(401).send({ success: false, error: "Authentication required" });
    }

    const decoded = request.server.jwt.verify<{
      sub: string;
      org: string;
      role: string;
      plan: string;
    }>(token);

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub, active: true },
      include: { organization: { select: { plan: true } } },
    });

    if (!user) {
      return reply.status(401).send({ success: false, error: "User not found or inactive" });
    }

    request.authUser = {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      name: user.name,
      role: user.role,
      plan: user.organization.plan,
    };
  } catch (error) {
    return reply.status(401).send({ success: false, error: "Invalid or expired token" });
  }
}

export async function softAuthMiddleware(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  try {
    const token = extractToken(request);
    if (!token) return;

    const decoded = request.server.jwt.verify<{
      sub: string;
      org: string;
      role: string;
      plan: string;
    }>(token);

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub, active: true },
      include: { organization: { select: { plan: true } } },
    });

    if (user) {
      request.authUser = {
        id: user.id,
        organizationId: user.organizationId,
        email: user.email,
        name: user.name,
        role: user.role,
        plan: user.organization.plan,
      };
    }
  } catch {
    // Soft auth - continue without user
  }
}

function extractToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return (request.cookies as Record<string, string>)?.token || null;
}
