import type { FastifyRequest } from "fastify";
import { en } from "./en.js";
import { es } from "./es.js";

export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export type Params = Record<string, string | number | null | undefined>;

const dictionaries: Record<Locale, Record<string, string>> = { en, es };

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/**
 * Translates `key`, interpolating `{name}` placeholders. Falls back to English,
 * then to the key itself so a missing entry is visible instead of blank.
 */
export function t(locale: Locale, key: string, params: Params = {}): string {
  const template = dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params[name];
    if (v === null || v === undefined) return "";
    return typeof v === "number" ? v.toLocaleString(locale) : String(v);
  });
}

/** True when the dictionary has the key (used for optional detail lines). */
export function has(key: string): boolean {
  return key in dictionaries.en;
}

/** Locale for an API request: explicit x-locale header (set by the UI), then Accept-Language. */
export function localeOf(req: FastifyRequest): Locale {
  const explicit = req.headers["x-locale"];
  if (isLocale(explicit)) return explicit;
  const accept = String(req.headers["accept-language"] ?? "").toLowerCase();
  return accept.startsWith("es") ? "es" : "en";
}
