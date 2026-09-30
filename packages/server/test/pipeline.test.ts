import { gzipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { overview, providers, sources, timeseries } from "../src/analysis/stats.js";
import { db } from "../src/db/index.js";
import { ingestBlob } from "../src/ingest/store.js";
import { updateSettings } from "../src/settings.js";
import { fixture } from "./helpers.js";

const range = { from: "2000-01-01", to: "2100-01-01" };

beforeAll(() => {
  db.migrate();
  updateSettings({ enrichment: false, alerts: { enabled: false } });
});

describe("ingestion pipeline", () => {
  it("stores a report, auto-creates the domain and dedupes re-deliveries", async () => {
    const xml = fixture("google.xml");
    const first = await ingestBlob(new TextEncoder().encode(xml), "test", "google.xml");
    expect(first.counts.ok).toBe(1);
    const domain = db.get<{ id: number; auto_created: number }>("SELECT id, auto_created FROM domains WHERE name = 'example.com'");
    expect(domain?.auto_created).toBe(1);

    // Same report again, this time gzipped: must be detected as duplicate.
    const again = await ingestBlob(gzipSync(new TextEncoder().encode(xml)), "test", "google.xml.gz");
    expect(again.counts.duplicate).toBe(1);
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM reports")?.n).toBe(1);
  });

  it("computes stats consistent with the stored records", () => {
    const ov = overview(range);
    const recs = db.get<{ total: number; pass: number }>("SELECT SUM(count) total, SUM(CASE WHEN dmarc_pass = 1 THEN count ELSE 0 END) pass FROM records")!;
    expect(ov.messages).toBe(recs.total);
    expect(ov.dmarcPass).toBe(recs.pass);
    const cats = ov.categories;
    expect(cats.pass + cats.forwarded + cats.misaligned + cats.fail).toBe(ov.messages);

    const ts = timeseries({ from: "2025-09-30", to: "2025-10-03" });
    expect(ts.days).toHaveLength(4);
    const sum = ts.series.pass.concat(ts.series.forwarded, ts.series.misaligned, ts.series.fail).reduce((a, b) => a + b, 0);
    expect(sum).toBe(ov.messages);

    const src = sources(range);
    expect(src.reduce((a, s) => a + s.messages, 0)).toBe(ov.messages);
    expect(providers(range).reduce((a, p) => a + p.messages, 0)).toBe(ov.messages);
  });

  it("ignores reports for unknown domains when auto-create is off", async () => {
    updateSettings({ autoCreateDomains: false });
    const r = await ingestBlob(new TextEncoder().encode(fixture("yahoo.xml").replace(/example\.com/g, "unknown-domain.test")), "test", "y.xml");
    expect(r.counts.ignored).toBe(1);
    updateSettings({ autoCreateDomains: true });
  });

  it("stores forensic reports", async () => {
    const r = await ingestBlob(new TextEncoder().encode(fixture("forensic.eml")), "test", "f.eml");
    expect(r.items[0]?.kind).toBe("forensic");
    expect(r.counts.ok).toBe(1);
  });

  it("logs garbage input as ignored instead of throwing", async () => {
    const r = await ingestBlob(new TextEncoder().encode("hello world"), "test", "x.txt");
    expect(r.counts.ignored).toBe(1);
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM ingest_log WHERE status = 'ignored'")?.n).toBeGreaterThan(0);
  });
});
