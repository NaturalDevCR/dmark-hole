import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { db, nowSec } from "../db/index.js";
import { t, type Params } from "../i18n/index.js";
import { hashPassword, randomToken, sha256, verifyPassword } from "../lib/crypto.js";

export const SESSION_COOKIE = "dh_session";
const SESSION_DAYS = 30;

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: "admin" | "viewer";
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/**
 * API error carrying an i18n key (see src/i18n). The error handler translates it
 * to the request's locale; `message` holds the English text for logs.
 */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public key: string,
    public params: Params = {},
  ) {
    super(t("en", key, params));
  }
}

export const usersExist = () => !!db.get("SELECT 1 FROM users LIMIT 1");

function createSession(req: FastifyRequest, reply: FastifyReply, userId: number) {
  const token = randomToken();
  const now = nowSec();
  db.run("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)", [
    sha256(token),
    userId,
    now,
    now + SESSION_DAYS * 86400,
    req.ip,
    req.headers["user-agent"]?.slice(0, 255) ?? null,
  ]);
  db.run("UPDATE users SET last_login_at = ? WHERE id = ?", [now, userId]);
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookies,
    maxAge: SESSION_DAYS * 86400,
  });
}

function userFromRequest(req: FastifyRequest): AuthUser | undefined {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return undefined;
  return db.get<AuthUser>(
    `SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    [sha256(token), nowSec()],
  );
}

/** Routes under /api that do not require a session (matched route patterns). */
const PUBLIC = new Set(["/api/health", "/api/auth/status", "/api/auth/login", "/api/auth/setup", "/api/ingest/raw"]);
/** Non-GET routes a viewer may call: their own session plus acknowledging alerts. */
const VIEWER_WRITABLE = new Set(["/api/auth/logout", "/api/auth/password", "/api/alerts/:id/read", "/api/alerts/read-all"]);

export function registerAuthHook(app: FastifyInstance) {
  app.addHook("onRequest", async (req) => {
    req.user = userFromRequest(req);
    // Gate on the route pattern the router actually matched, never on the raw URL:
    // the router percent-decodes paths, so "/%61pi/..." would otherwise slip past a
    // string prefix check. Unmatched URLs fall through to the 404 handler.
    const route = req.routeOptions.url;
    if (!route || !route.startsWith("/api/")) return;
    if (PUBLIC.has(route)) return;
    if (!req.user) throw new HttpError(401, "error.notAuthenticated");
    if (req.method !== "GET" && req.method !== "HEAD" && req.user.role !== "admin" && !VIEWER_WRITABLE.has(route)) {
      throw new HttpError(403, "error.adminRequired");
    }
  });
}

export function requireAdmin(req: FastifyRequest) {
  if (req.user?.role !== "admin") throw new HttpError(403, "error.adminRequired");
}

const credentials = z.object({ email: z.string().email(), password: z.string().min(1) });
const setupBody = z.object({ email: z.string().email(), name: z.string().min(1).max(100), password: z.string().min(8).max(200) });

export async function bootstrapAdmin() {
  const { email, password } = config.bootstrapAdmin;
  if (!email || !password || usersExist()) return;
  db.run("INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, ?, ?, 'admin', ?)", [
    email,
    "Administrator",
    await hashPassword(password),
    nowSec(),
  ]);
}

export async function authRoutes(app: FastifyInstance) {
  app.get("/api/auth/status", async (req) => ({ setupRequired: !usersExist(), user: req.user ?? null, version: config.version }));

  app.post("/api/auth/setup", async (req, reply) => {
    if (usersExist()) throw new HttpError(409, "error.setupDone");
    const body = setupBody.parse(req.body);
    const r = db.run("INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, ?, ?, 'admin', ?)", [
      body.email,
      body.name,
      await hashPassword(body.password),
      nowSec(),
    ]);
    createSession(req, reply, r.lastInsertRowid);
    return { ok: true };
  });

  app.post("/api/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = credentials.parse(req.body);
    const u = db.get<{ id: number; password_hash: string }>("SELECT id, password_hash FROM users WHERE email = ?", [body.email]);
    // Hash anyway on unknown users so timing does not reveal which emails exist.
    const ok = u ? await verifyPassword(body.password, u.password_hash) : (await hashPassword(body.password), false);
    if (!u || !ok) throw new HttpError(401, "error.invalidCredentials");
    createSession(req, reply, u.id);
    return { ok: true };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) db.run("DELETE FROM sessions WHERE token_hash = ?", [sha256(token)]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", async (req) => req.user);

  app.post("/api/auth/password", async (req) => {
    const body = z.object({ current: z.string(), next: z.string().min(8).max(200) }).parse(req.body);
    const u = db.get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", [req.user!.id])!;
    if (!(await verifyPassword(body.current, u.password_hash))) throw new HttpError(400, "error.wrongCurrentPassword");
    db.run("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(body.next), req.user!.id]);
    const token = req.cookies[SESSION_COOKIE];
    db.run("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", [req.user!.id, sha256(token ?? "")]);
    return { ok: true };
  });

  // --- User management (admin) ---
  app.get("/api/users", async (req) => {
    requireAdmin(req);
    return db.all("SELECT id, email, name, role, created_at createdAt, last_login_at lastLoginAt FROM users ORDER BY id");
  });

  app.post("/api/users", async (req) => {
    requireAdmin(req);
    const body = setupBody.extend({ role: z.enum(["admin", "viewer"]) }).parse(req.body);
    if (db.get("SELECT 1 FROM users WHERE email = ?", [body.email])) throw new HttpError(409, "error.userExists");
    const r = db.run("INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)", [
      body.email,
      body.name,
      await hashPassword(body.password),
      body.role,
      nowSec(),
    ]);
    return { id: r.lastInsertRowid };
  });

  app.patch<{ Params: { id: string } }>("/api/users/:id", async (req) => {
    requireAdmin(req);
    const id = Number(req.params.id);
    const body = z
      .object({ name: z.string().min(1).max(100).optional(), role: z.enum(["admin", "viewer"]).optional(), password: z.string().min(8).max(200).optional() })
      .parse(req.body);
    if (body.role === "viewer" && id === req.user!.id) throw new HttpError(400, "error.cannotDemoteSelf");
    if (body.name) db.run("UPDATE users SET name = ? WHERE id = ?", [body.name, id]);
    if (body.role) db.run("UPDATE users SET role = ? WHERE id = ?", [body.role, id]);
    if (body.password) {
      db.run("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(body.password), id]);
      db.run("DELETE FROM sessions WHERE user_id = ?", [id]);
    }
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/users/:id", async (req) => {
    requireAdmin(req);
    const id = Number(req.params.id);
    if (id === req.user!.id) throw new HttpError(400, "error.cannotDeleteSelf");
    db.run("DELETE FROM users WHERE id = ?", [id]);
    return { ok: true };
  });
}
