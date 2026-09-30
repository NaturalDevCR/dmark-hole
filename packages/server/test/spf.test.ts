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

const { runDnsChecks } = await import("../src/dns/checks.js");

describe("SPF analysis", () => {
  it("counts CIDR-only mechanisms and every include occurrence (RFC 7208)", async () => {
    const r = await runDnsChecks("example.test");
    // a/24 + mx/24 + include:shared + include:branch + (branch → include:shared) = 5
    expect(r.spf.lookups).toBe(5);
    expect(r.spf.checks.some((c) => /Bucle/.test(c.title))).toBe(false);
    expect(r.inconclusive).toBe(false);
  });

  it("detects include loops", async () => {
    const r = await runDnsChecks("loop.test");
    expect(JSON.stringify(r.spf.tree)).toContain("Bucle de includes");
  });
});
