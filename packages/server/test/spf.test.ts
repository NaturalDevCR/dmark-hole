import { describe, expect, it, vi } from "vitest";

// Fake DNS: a small SPF graph with a repeated include and CIDR-only mechanisms.
const TXT: Record<string, string[]> = {
  "example.test": ["v=spf1 a/24 mx/24 include:shared.test include:branch.test -all"],
  "branch.test": ["v=spf1 include:shared.test ~all"],
  "shared.test": ["v=spf1 ip4:192.0.2.0/24 ~all"],
  "loop.test": ["v=spf1 include:loop.test -all"],
};

vi.mock("node:dns/promises", () => {
  class Resolver {
    async resolveTxt(name: string) {
      if (TXT[name]) return TXT[name]!.map((t) => [t]);
      throw Object.assign(new Error("nodata"), { code: "ENODATA" });
    }
    async resolveMx() {
      return [{ exchange: "mx.example.test", priority: 10 }];
    }
    async resolve4() {
      return ["192.0.2.1"];
    }
    async resolve6() {
      return [];
    }
  }
  return { Resolver };
});

const { runDnsChecks, localizeDnsReport } = await import("../src/dns/checks.js");

describe("SPF analysis", () => {
  it("counts CIDR-only mechanisms and every include occurrence (RFC 7208)", async () => {
    const r = await runDnsChecks("example.test");
    // a/24 + mx/24 + include:shared + include:branch + (branch → include:shared) = 5
    expect(r.spf.lookups).toBe(5);
    expect(r.spf.checks.some((c) => c.code.includes("loop"))).toBe(false);
    expect(r.inconclusive).toBe(false);
  });

  it("detects include loops", async () => {
    const r = await runDnsChecks("loop.test");
    expect(JSON.stringify(r.spf.tree)).toContain('"errorCode":"loop"');
    expect(r.spf.checks.some((c) => c.code === "spf.include.loop")).toBe(true);
    // Producers emit codes only; text is rendered per locale.
    expect(r.spf.checks.every((c) => c.title === undefined)).toBe(true);
  });

  it("localizes checks and SPF tree errors without mutating the stored report", async () => {
    const r = await runDnsChecks("loop.test");
    const en = localizeDnsReport(r, "en");
    const es = localizeDnsReport(r, "es");
    expect(en.spf.checks.find((c) => c.code === "spf.lookups")?.title).toBe(`DNS lookups: ${r.spf.lookups}/10`);
    expect(es.spf.checks.find((c) => c.code === "spf.lookups")?.title).toBe(`Consultas DNS: ${r.spf.lookups}/10`);
    expect(en.spf.checks.find((c) => c.code === "spf.include.loop")?.title).toBe("include:loop.test — Include loop");
    expect(es.spf.tree?.children[0]?.error).toBe("Bucle de includes");
    expect(r.spf.checks[0]?.title).toBeUndefined();
  });
});
