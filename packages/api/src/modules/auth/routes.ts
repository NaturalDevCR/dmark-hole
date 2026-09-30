import { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { loginSchema, registerSchema } from "@dmark-hole/shared";
import { generateToken } from "@dmark-hole/shared/utils";

export async function authRoutes(server: FastifyInstance): Promise<void> {
  // POST /auth/register
  server.post("/register", async (request, reply) => {
    const data = registerSchema.parse(request.body);

    const existingUser = await prisma.user.findUnique({ where: { email: data.email } });
    if (existingUser) {
      return reply.status(409).send({ success: false, error: "Email already registered" });
    }

    const existingOrg = await prisma.organization.findUnique({ where: { slug: data.organizationSlug } });
    if (existingOrg) {
      return reply.status(409).send({ success: false, error: "Organization slug already taken" });
    }

    const passwordHash = await bcrypt.hash(data.password, 12);

    const organization = await prisma.organization.create({
      data: {
        name: data.organizationName,
        slug: data.organizationSlug,
        users: {
          create: {
            email: data.email,
            passwordHash,
            name: data.name,
            role: "ORG_ADMIN",
          },
        },
      },
      include: { users: true },
    });

    const user = organization.users[0]!;
    const token = server.jwt.sign({
      sub: user.id,
      org: organization.id,
      role: "ORG_ADMIN",
      plan: organization.plan,
    });

    const refreshToken = generateToken(64);

    await prisma.session.create({
      data: {
        userId: user.id,
        token,
        refreshToken,
        userAgent: request.headers["user-agent"] || null,
        ip: request.ip,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return reply.status(201).send({
      success: true,
      data: {
        token,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: "ORG_ADMIN",
          organizationId: organization.id,
        },
      },
    });
  });

  // POST /auth/login
  server.post("/login", async (request, reply) => {
    const data = loginSchema.parse(request.body);

    const user = await prisma.user.findUnique({
      where: { email: data.email, active: true },
      include: { organization: { select: { plan: true } } },
    });

    if (!user || !(await bcrypt.compare(data.password, user.passwordHash))) {
      return reply.status(401).send({ success: false, error: "Invalid email or password" });
    }

    const token = server.jwt.sign({
      sub: user.id,
      org: user.organizationId,
      role: user.role,
      plan: user.organization.plan,
    });

    const refreshToken = generateToken(64);

    await prisma.session.create({
      data: {
        userId: user.id,
        token,
        refreshToken,
        userAgent: request.headers["user-agent"] || null,
        ip: request.ip,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return reply.send({
      success: true,
      data: {
        token,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          organizationId: user.organizationId,
        },
      },
    });
  });

  // POST /auth/refresh
  server.post("/refresh", async (request, reply) => {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(request.body);

    const session = await prisma.session.findUnique({
      where: { refreshToken },
      include: { user: { include: { organization: { select: { plan: true } } } } },
    });

    if (!session || session.expiresAt < new Date()) {
      return reply.status(401).send({ success: false, error: "Invalid or expired refresh token" });
    }

    if (!session.user.active) {
      return reply.status(401).send({ success: false, error: "User is inactive" });
    }

    const newToken = server.jwt.sign({
      sub: session.user.id,
      org: session.user.organizationId,
      role: session.user.role,
      plan: session.user.organization.plan,
    });

    const newRefreshToken = generateToken(64);

    await prisma.session.update({
      where: { id: session.id },
      data: { token: newToken, refreshToken: newRefreshToken, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });

    return reply.send({
      success: true,
      data: { token: newToken, refreshToken: newRefreshToken },
    });
  });

  // GET /auth/me
  server.get("/me", { preHandler: [authMiddleware] }, async (request) => {
    return {
      success: true,
      data: request.authUser,
    };
  });

  // POST /auth/logout
  server.post("/logout", { preHandler: [authMiddleware] }, async (request, reply) => {
    await prisma.session.deleteMany({
      where: { userId: request.authUser!.id },
    });

    return reply.send({ success: true });
  });

  // GET /auth/sessions
  server.get("/sessions", { preHandler: [authMiddleware] }, async (request) => {
    const sessions = await prisma.session.findMany({
      where: { userId: request.authUser!.id },
      select: { id: true, userAgent: true, ip: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: "desc" },
    });

    return { success: true, data: sessions };
  });
}
