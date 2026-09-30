import { existsSync } from "node:fs";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { LogController, type FastifyBaseLogger } from "fastify";
import { ZodError } from "zod";
import { adminRoutes } from "./api/admin.js";
import { authRoutes, HttpError, registerAuthHook } from "./api/auth.js";
import { dataRoutes } from "./api/data.js";
import { localeOf, t } from "./i18n/index.js";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { logger } from "./lib/logger.js";

const MAX_UPLOAD = 50 * 1024 * 1024;

export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: config.trustProxy,
    bodyLimit: MAX_UPLOAD,
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD, files: 200 } });

  // Raw bodies for /api/ingest/raw (xml, gzip, zip, eml...).
  app.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: MAX_UPLOAD }, (_req, body, done) => done(null, body));
  for (const ct of ["application/xml", "text/xml", "application/gzip", "application/zip", "message/rfc822"]) {
    app.addContentTypeParser(ct, { parseAs: "buffer", bodyLimit: MAX_UPLOAD }, (_req, body, done) => done(null, body));
  }

  registerAuthHook(app);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: t(localeOf(req), "error.validation"), issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: t(localeOf(req), err.key, err.params), code: err.key });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err, url: req.url }, "request failed");
    return reply.status(status).send({ error: status >= 500 ? t(localeOf(req), "error.internal") : (err as Error).message });
  });

  app.get("/api/health", async () => {
    db.get("SELECT 1");
    return { status: "ok", version: config.version };
  });

  await app.register(authRoutes);
  await app.register(dataRoutes);
  await app.register(adminRoutes);

  if (existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false, maxAge: "1h" });
    // SPA fallback: every non-API GET renders index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/")) {
        return reply.header("cache-control", "no-cache").sendFile("index.html");
      }
      return reply.status(404).send({ error: "Not found" });
    });
  } else {
    logger.warn({ webDist: config.webDist }, "web UI build not found; serving API only");
  }
  return app;
}
