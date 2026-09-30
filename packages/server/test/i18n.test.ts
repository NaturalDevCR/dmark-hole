import { describe, expect, it } from "vitest";
import { en } from "../src/i18n/en.js";
import { es } from "../src/i18n/es.js";
import { has, t } from "../src/i18n/index.js";

describe("i18n dictionaries", () => {
  it("have identical key sets", () => {
    const missingInEs = Object.keys(en).filter((k) => !(k in es));
    const missingInEn = Object.keys(es).filter((k) => !(k in en));
    expect({ missingInEs, missingInEn }).toEqual({ missingInEs: [], missingInEn: [] });
  });

  it("use the same placeholders in both languages", () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(en)) expect([k, placeholders(es[k]!)]).toEqual([k, placeholders(en[k]!)]);
  });

  it("interpolates, falls back to the key and formats numbers per locale", () => {
    expect(t("es", "error.invalidDate", { date: "2025-13-01" })).toBe("Fecha inválida: 2025-13-01");
    expect(t("en", "no.such.key")).toBe("no.such.key");
    expect(t("en", "rec.align.detail", { name: "X", count: 1234 })).toContain("1,234");
    expect(has("dns.dmarc.missing.detail")).toBe(true);
    expect(has("dns.dmarc.ruaExternalOk.detail")).toBe(false);
  });
});
