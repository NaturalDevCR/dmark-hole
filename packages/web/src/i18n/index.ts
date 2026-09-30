import { createI18n } from "vue-i18n";

export const LOCALES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
] as const;
export type Locale = (typeof LOCALES)[number]["code"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Dict = Record<string, any>;

/**
 * Messages are split per namespace (locales/<lang>/<namespace>.ts) so pages can be
 * translated independently; each file's default export lands under its file name,
 * e.g. locales/en/dashboard.ts → t("dashboard.title").
 */
const modules = import.meta.glob<{ default: Dict }>("./locales/*/*.ts", { eager: true });
const messages: Record<string, Record<string, Dict>> = {};
for (const [path, mod] of Object.entries(modules)) {
  const m = /\.\/locales\/(\w+)\/(\w+)\.ts$/.exec(path);
  if (!m) continue;
  const [, lang, ns] = m as unknown as [string, string, string];
  messages[lang] ??= {};
  messages[lang]![ns] = mod.default;
}

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem("locale");
    if (saved === "en" || saved === "es") return saved;
  } catch {
    /* storage blocked */
  }
  return navigator.language?.toLowerCase().startsWith("es") ? "es" : "en";
}

export const i18n = createI18n<false>({
  legacy: false,
  locale: initialLocale(),
  fallbackLocale: "en",
  messages,
  missingWarn: import.meta.env.DEV,
  fallbackWarn: false,
});

document.documentElement.lang = i18n.global.locale.value;

export function currentLocale(): Locale {
  return i18n.global.locale.value as Locale;
}

export function setLocale(locale: Locale) {
  i18n.global.locale.value = locale;
  document.documentElement.lang = locale;
  try {
    localStorage.setItem("locale", locale);
  } catch {
    /* ignore */
  }
}

/** Shorthand for non-component code (formatters, stores). Reactive inside render/computed. */
export const t = (key: string, params?: Record<string, unknown>) => i18n.global.t(key, params ?? {});
