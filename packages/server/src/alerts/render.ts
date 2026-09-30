import { t, type Locale, type Params } from "../i18n/index.js";

export type AlertData = Record<string, unknown>;

/** Alert types whose text is rendered from `alert.<type>.title` / `.message`. */
const TYPES = ["new_failing_source", "compliance_drop", "forensic_report", "dns_change"] as const;

/**
 * Keys that only alerts created after localization carry. Older rows (stored with
 * Spanish text and fewer data fields) lack them and keep their stored title/message.
 */
const REQUIRED: Record<(typeof TYPES)[number], string[]> = {
  new_failing_source: ["domain", "origin"],
  compliance_drop: ["domain", "threshold"],
  forensic_report: [],
  dns_change: ["domain", "changed"],
};

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function paramsFor(type: (typeof TYPES)[number], locale: Locale, data: AlertData): Params {
  switch (type) {
    case "new_failing_source": {
      const origin = str(data.origin) ?? t(locale, "alert.unknownOrigin");
      const country = str(data.country);
      return {
        domain: str(data.domain),
        ip: str(data.ip),
        where: country ? `${origin}, ${country}` : origin,
        fail: Number(data.fail),
        total: Number(data.total),
      };
    }
    case "compliance_drop":
      return {
        domain: str(data.domain),
        rate: Number(data.rate),
        day: str(data.day),
        pass: Number(data.pass),
        total: Number(data.total),
        threshold: Number(data.threshold),
      };
    case "dns_change": {
      const changed = Array.isArray(data.changed) ? data.changed.map(String) : [];
      return { domain: str(data.domain), changed: changed.join(", ") || t(locale, "alert.unknown") };
    }
    default:
      return {};
  }
}

/**
 * Renders an alert's title and message from its type and stored `data` in `locale`.
 * Returns null when the type is unknown or the data predates localization.
 */
export function renderAlert(locale: Locale, type: string, data: AlertData): { title: string; message: string } | null {
  if (!(TYPES as readonly string[]).includes(type)) return null;
  const kind = type as (typeof TYPES)[number];
  if (!REQUIRED[kind].every((k) => data[k] !== undefined)) return null;
  const params = paramsFor(kind, locale, data);
  let message = t(locale, `alert.${kind}.message`, params);
  if (kind === "dns_change" && Array.isArray(data.changed) && data.changed.includes("dmarc")) {
    const dash = "—";
    const before = (data.before as AlertData | undefined)?.dmarc;
    const after = (data.after as AlertData | undefined)?.dmarc;
    message += `\n${t(locale, "alert.dns_change.dmarc", { before: str(before) ?? dash, after: str(after) ?? dash })}`;
  }
  return { title: t(locale, `alert.${kind}.title`, params), message };
}
