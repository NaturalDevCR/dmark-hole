import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import compress from "@fastify/compress";
import multipart from "@fastify/multipart";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import websocket from "@fastify/websocket";

import { prisma } from "./lib/prisma.js";
import { connectRedis } from "./lib/redis.js";

import { authRoutes } from "./modules/auth/routes.js";
import { organizationRoutes } from "./modules/organizations/routes.js";
import { domainRoutes } from "./modules/domains/routes.js";
import { mailboxRoutes } from "./modules/mailboxes/routes.js";
import { ingestionRoutes } from "./modules/ingestion/routes.js";
import { parserRoutes } from "./modules/parser/routes.js";
import { dnsRoutes } from "./modules/dns/routes.js";
import { alertRoutes } from "./modules/alerts/routes.js";
import { integrationRoutes } from "./modules/integrations/routes.js";
import { dashboardRoutes } from "./modules/dashboard/routes.js";
import { reportRoutes } from "./modules/reports/routes.js";
import { webhookRoutes } from "./modules/webhooks/routes.js";
import { apiKeyRoutes } from "./modules/api-keys/routes.js";

const PORT = parseInt(process.env.API_PORT || "3001", 10);
const HOST = process.env.API_HOST || "0.0.0.0";

async function buildServer() {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
      ...(process.env.NODE_ENV === "development" && {
        transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss Z", ignore: "pid,hostname" } },
      }),
    },
    trustProxy: process.env.API_TRUST_PROXY === "true",
    bodyLimit: 50 * 1024 * 1024, // 50MB for XML uploads
  });

  // --- Plugins ---
  await server.register(cors, {
    origin: process.env.API_CORS_ORIGIN?.split(",") || ["http://localhost:5173"],
    credentials: true,
  });

  await server.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  await server.register(rateLimit, {
    max: 600,
    timeWindow: "1 minute",
    keyGenerator: (req) => {
      return req.authUser?.organizationId || req.ip;
    },
  });

  await server.register(compress, { global: true });
  await server.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
  await server.register(cookie);

  await server.register(jwt, {
    secret: process.env.JWT_SECRET || "dmark-hole-jwt-secret-dev-only",
    sign: { expiresIn: process.env.JWT_EXPIRES_IN || "15m" },
  });

  // --- Swagger ---
  await server.register(swagger, {
    openapi: {
      info: {
        title: "DMARK-Hole API",
        description: "Enterprise DMARC Email Authentication Monitoring Platform",
        version: "1.0.0",
      },
      servers: [{ url: `http://localhost:${PORT}` }],
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
  });

  await server.register(swaggerUi, { routePrefix: "/docs" });
  await server.register(websocket);

  // --- Health Check ---
  server.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  }));

  // --- Metrics ---
  server.get("/metrics", async (_req, reply) => {
    const dbCheck = await prisma.$queryRaw`SELECT 1` .then(() => "ok").catch(() => "error");
    return {
      status: "ok",
      database: dbCheck,
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    };
  });

  // --- Routes ---
  await server.register(authRoutes, { prefix: "/api/v1/auth" });
  await server.register(organizationRoutes, { prefix: "/api/v1/organizations" });
  await server.register(domainRoutes, { prefix: "/api/v1/domains" });
  await server.register(mailboxRoutes, { prefix: "/api/v1/mailboxes" });
  await server.register(ingestionRoutes, { prefix: "/api/v1/ingestion" });
  await server.register(parserRoutes, { prefix: "/api/v1/parser" });
  await server.register(dnsRoutes, { prefix: "/api/v1/dns" });
  await server.register(alertRoutes, { prefix: "/api/v1/alerts" });
  await server.register(integrationRoutes, { prefix: "/api/v1/integrations" });
  await server.register(dashboardRoutes, { prefix: "/api/v1/dashboard" });
  await server.register(reportRoutes, { prefix: "/api/v1/reports" });
  await server.register(webhookRoutes, { prefix: "/api/v1/webhooks" });
  await server.register(apiKeyRoutes, { prefix: "/api/v1/api-keys" });

  // --- Error Handler ---
  server.setErrorHandler((error, _request, reply) => {
    server.log.error(error);

    if (error.validation) {
      return reply.status(400).send({
        success: false,
        error: "Validation error",
        details: error.validation,
      });
    }

    if (error.statusCode === 429) {
      return reply.status(429).send({
        success: false,
        error: "Too many requests. Please try again later.",
      });
    }

    const statusCode = error.statusCode || 500;
    return reply.status(statusCode).send({
      success: false,
      error: statusCode === 500 ? "Internal server error" : error.message,
    });
  });

  // --- Graceful Shutdown ---
  const shutdown = async () => {
    server.log.info("Shutting down...");
    await server.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return server;
}

async function start() {
  try {
    await connectRedis();
    const server = await buildServer();
    await server.listen({ port: PORT, host: HOST });
    console.log(`DMARK-Hole API running on http://${HOST}:${PORT}`);
    console.log(`Docs available at http://${HOST}:${PORT}/docs`);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

start();
