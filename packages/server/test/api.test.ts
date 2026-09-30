import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { db } from "../src/db/index.js";
import { updateSettings } from "../src/settings.js";
import { fixture } from "./helpers.js";

let app: FastifyInstance;
let cookie = "";

function multipart(name: string, content: string) {
  const boundary = "----dmarkholetest";
  const body =
    `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\nContent-Type: application/xml\r\n\r\n` +
    `${content}\r\n--${boundary}--\r\n`;
  return { payload: body, headers: { "content-type": `multipart/form-data; boundary=${boundary}`, cookie } };
}

beforeAll(async () => {
  db.migrate();
  updateSettings({ enrichment: false, alerts: { enabled: false } });
  app = await buildApp();
});
afterAll(() => app.close());

describe("HTTP API", () => {
  it("requires setup, then authenticates with a session cookie", async () => {
    const status = await app.inject({ url: "/api/auth/status" });
    expect(status.json().setupRequired).toBe(true);
    expect((await app.inject({ url: "/api/domains" })).statusCode).toBe(401);

    const setup = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      payload: { name: "Admin", email: "admin@example.test", password: "correct-horse" },
    });
    expect(setup.statusCode).toBe(200);
    cookie = String(setup.headers["set-cookie"]).split(";")[0]!;
    expect((await app.inject({ url: "/api/domains", headers: { cookie } })).statusCode).toBe(200);

    // A second setup must be refused.
    const again = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { name: "X", email: "x@example.test", password: "correct-horse" } });
    expect(again.statusCode).toBe(409);
  });

  it("rejects bad credentials", async () => {
    const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@example.test", password: "nope" } });
    expect(r.statusCode).toBe(401);
  });

  it("validates domain names", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/domains", headers: { cookie }, payload: { name: "not a domain" } });
    expect(bad.statusCode).toBe(400);
  });

  it("uploads a report and exposes it through reports and stats", async () => {
    const up = await app.inject({ method: "POST", url: "/api/ingest/upload", ...multipart("google.xml", fixture("google.xml")) });
    expect(up.statusCode).toBe(200);
    expect(up.json()[0].counts.ok).toBe(1);

    const list = await app.inject({ url: "/api/reports?from=2000-01-01&to=2100-01-01", headers: { cookie } });
    const items = list.json().items;
    expect(items).toHaveLength(1);

    const detail = await app.inject({ url: `/api/reports/${items[0].id}`, headers: { cookie } });
    expect(detail.json().records.length).toBeGreaterThan(0);

    const xml = await app.inject({ url: `/api/reports/${items[0].id}/xml`, headers: { cookie } });
    expect(xml.headers["content-type"]).toContain("xml");
    expect(xml.body).toContain("<feedback");

    const ov = await app.inject({ url: "/api/stats/overview?from=2000-01-01&to=2100-01-01", headers: { cookie } });
    expect(ov.json().messages).toBeGreaterThan(0);

    const csv = await app.inject({ url: "/api/export/records.csv?from=2000-01-01&to=2100-01-01", headers: { cookie } });
    expect(csv.body.split("\n")[0]).toContain("source_ip");
  });

  it("accepts raw ingestion only with the ingest token", async () => {
    const denied = await app.inject({ method: "POST", url: "/api/ingest/raw", payload: fixture("yahoo.xml"), headers: { "content-type": "application/xml" } });
    expect(denied.statusCode).toBe(401);
    const token = (await app.inject({ url: "/api/ingest/status", headers: { cookie } })).json().ingestToken;
    const ok = await app.inject({
      method: "POST",
      url: "/api/ingest/raw",
      payload: fixture("yahoo.xml"),
      headers: { "content-type": "application/xml", authorization: `Bearer ${token}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().counts.ok).toBe(1);
  });

  it("keeps viewers read-only", async () => {
    await app.inject({ method: "POST", url: "/api/users", headers: { cookie }, payload: { name: "V", email: "viewer@example.test", password: "viewer-pass", role: "viewer" } });
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "viewer@example.test", password: "viewer-pass" } });
    const vcookie = String(login.headers["set-cookie"]).split(";")[0]!;
    expect((await app.inject({ url: "/api/domains", headers: { cookie: vcookie } })).statusCode).toBe(200);
    const write = await app.inject({ method: "POST", url: "/api/domains", headers: { cookie: vcookie }, payload: { name: "viewer.example" } });
    expect(write.statusCode).toBe(403);
    expect((await app.inject({ url: "/api/settings", headers: { cookie: vcookie } })).statusCode).toBe(403);
  });
});
