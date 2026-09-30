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

  it("cannot be bypassed with percent-encoded paths", async () => {
    for (const url of ["/%61pi/domains", "/api/%64omains", "/API/domains"]) {
      const r = await app.inject({ url });
      // Either rejected, or (for non-/api paths) the SPA shell — never API data.
      expect(r.statusCode === 401 || r.statusCode === 404 || r.body.startsWith("<!doctype html>")).toBe(true);
    }
    const post = await app.inject({ method: "POST", url: "/%61pi/domains", payload: { name: "bypass.example" } });
    expect([401, 404]).toContain(post.statusCode);
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

    const list = await app.inject({ url: "/api/reports?from=2020-01-01&to=2029-12-31", headers: { cookie } });
    const items = list.json().items;
    expect(items).toHaveLength(1);

    const detail = await app.inject({ url: `/api/reports/${items[0].id}`, headers: { cookie } });
    expect(detail.json().records.length).toBeGreaterThan(0);

    const xml = await app.inject({ url: `/api/reports/${items[0].id}/xml`, headers: { cookie } });
    expect(xml.headers["content-type"]).toContain("xml");
    expect(xml.body).toContain("<feedback");

    const ov = await app.inject({ url: "/api/stats/overview?from=2020-01-01&to=2029-12-31", headers: { cookie } });
    expect(ov.json().messages).toBeGreaterThan(0);

    const csv = await app.inject({ url: "/api/export/records.csv?from=2020-01-01&to=2029-12-31", headers: { cookie } });
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

  it("translates API errors per request locale", async () => {
    const bad = { email: "admin@example.test", password: "wrong" };
    const en = await app.inject({ method: "POST", url: "/api/auth/login", payload: bad, headers: { "x-locale": "en" } });
    const es = await app.inject({ method: "POST", url: "/api/auth/login", payload: bad, headers: { "x-locale": "es" } });
    expect(en.statusCode).toBe(401);
    expect(en.json().error).toBe("Invalid credentials");
    expect(es.json().error).toBe("Credenciales inválidas");
    expect(es.json().code).toBe("error.invalidCredentials");

    const range = await app.inject({ url: "/api/stats/overview?from=2025-02-01&to=2025-01-01", headers: { cookie, "x-locale": "es" } });
    expect(range.json().error).toBe("El rango de fechas está invertido");
    const date = await app.inject({ url: "/api/stats/overview?from=2025-02-31&to=2025-03-01", headers: { cookie, "x-locale": "en" } });
    expect(date.json().error).toBe("Invalid date: 2025-02-31");
    const missing = await app.inject({ method: "POST", url: "/api/domains/99999/dns-check", headers: { cookie, "x-locale": "es" } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe("Dominio no encontrado");
  });

  it("localizes DNS check titles and leaves legacy stored checks untouched", async () => {
    const report = {
      domain: "i18n.example",
      checkedAt: 1,
      dmarc: {
        record: null,
        source: null,
        tags: {},
        rua: [],
        ruf: [],
        checks: [
          { status: "error", code: "dmarc.missing", params: { domain: "i18n.example" } },
          { status: "warning", title: "Texto heredado", detail: "Sin codigo" },
        ],
      },
      spf: { record: null, tree: null, lookups: 0, voidLookups: 0, all: null, checks: [{ status: "ok", code: "spf.lookups", params: { count: 3 } }] },
      dkim: { selectors: [{ selector: "s1", domain: "i18n.example", found: true, checks: [{ status: "error", code: "dkim.weakKey", params: { selector: "s1", bits: "512" } }] }], checks: [] },
      mx: { hosts: [], checks: [{ status: "info", code: "mx.none" }] },
      mtaSts: { record: null, policy: null, checks: [] },
      tlsRpt: { record: null, rua: [], checks: [] },
      bimi: { record: null, logo: null, vmc: null, checks: [] },
      score: 0,
      hash: "x",
      inconclusive: false,
    };
    const r = db.run("INSERT INTO domains (name, dns_result, created_at) VALUES (?, ?, 1)", ["i18n.example", JSON.stringify(report)]);
    const get = async (locale: string) => (await app.inject({ url: `/api/domains/${r.lastInsertRowid}`, headers: { cookie, "x-locale": locale } })).json().dnsResult;
    const en = await get("en");
    const es = await get("es");
    expect(en.dmarc.checks[0].title).toBe("No DMARC record");
    expect(en.dmarc.checks[0].detail).toContain("_dmarc.i18n.example");
    expect(es.dmarc.checks[0].title).toBe("No hay registro DMARC");
    expect(es.dmarc.checks[0].code).toBe("dmarc.missing");
    expect(es.spf.checks[0].title).toBe("Consultas DNS: 3/10");
    expect(es.dkim.selectors[0].checks[0].title).toBe("Clave RSA débil (512 bits)");
    expect(en.mx.checks[0].title).toBe("No MX records");
    // Checks stored before codes existed keep their text.
    expect(en.dmarc.checks[1]).toEqual({ status: "warning", title: "Texto heredado", detail: "Sin codigo" });

    const recEn = await app.inject({ url: `/api/domains/${r.lastInsertRowid}/recommendations`, headers: { cookie, "x-locale": "en" } });
    const recEs = await app.inject({ url: `/api/domains/${r.lastInsertRowid}/recommendations`, headers: { cookie, "x-locale": "es" } });
    const dmarcEn = recEn.json().find((x: { code: string }) => x.code === "dmarcMissing");
    expect(dmarcEn.title).toBe("Publish a DMARC record");
    expect(dmarcEn.action).toContain("_dmarc.i18n.example");
    expect(recEs.json().find((x: { code: string }) => x.code === "dmarcMissing").title).toBe("Publique un registro DMARC");
  });

  it("re-renders alerts in the request locale and keeps legacy text", async () => {
    const add = (type: string, title: string, data: object) =>
      db.run("INSERT INTO alerts (domain_id, type, severity, title, message, data, created_at) VALUES (NULL, ?, 'warning', ?, 'stored', ?, 1)", [type, title, JSON.stringify(data)]).lastInsertRowid;
    add("compliance_drop", "t", { domain: "a.example", day: "2025-01-01", pass: 1, total: 12345, rate: 0.1, threshold: 90 });
    add("compliance_drop", "Texto viejo", { day: "2025-01-01", pass: 1, total: 1000 });
    const list = async (locale: string) => (await app.inject({ url: "/api/alerts", headers: { cookie, "x-locale": locale } })).json().items as { title: string; message: string }[];
    const en = await list("en");
    const es = await list("es");
    expect(en.find((a) => a.title.startsWith("Low DMARC"))?.message).toBe("On 2025-01-01 only 1 of 12,345 messages passed DMARC (threshold 90%).");
    expect(es.find((a) => a.title.startsWith("Cumplimiento"))?.message).toContain("de 12.345 mensajes");
    expect(en.some((a) => a.title === "Texto viejo" && a.message === "stored")).toBe(true);
  });
});
