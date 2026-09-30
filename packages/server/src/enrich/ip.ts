import { Resolver } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";
import { db, nowSec } from "../db/index.js";
import { events } from "../lib/events.js";
import { logger } from "../lib/logger.js";
import { getSettings } from "../settings.js";
import { detectProvider } from "./providers.js";

const REFRESH_AFTER = 30 * 86400;
const CONCURRENCY = 8;

const resolver = new Resolver({ timeout: 4000, tries: 2 });
const queue = new Set<string>();
let active = 0;

export interface IpInfo {
  ip: string;
  ptr: string | null;
  asn: number | null;
  as_name: string | null;
  country: string | null;
  provider: string | null;
}

function reverseIPv6Nibbles(ip: string): string {
  const parts = ip.split("::");
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts[1] ? parts[1].split(":") : [];
  const fill = Array(8 - head.length - tail.length).fill("0");
  const full = [...head, ...(parts.length > 1 ? fill : []), ...tail].map((g) => g.padStart(4, "0"));
  return full.join("").split("").reverse().join(".");
}

async function cymru(ip: string): Promise<{ asn: number | null; country: string | null; asName: string | null }> {
  const name = isIPv4(ip)
    ? `${ip.split(".").reverse().join(".")}.origin.asn.cymru.com`
    : `${reverseIPv6Nibbles(ip)}.origin6.asn.cymru.com`;
  // Answer: "15169 | 8.8.8.0/24 | US | arin | 2023-12-28"
  const txt = (await resolver.resolveTxt(name)).map((t) => t.join(""))[0];
  if (!txt) return { asn: null, country: null, asName: null };
  const [asnRaw, , cc] = txt.split("|").map((s) => s.trim());
  const asn = Number.parseInt(asnRaw?.split(" ")[0] ?? "", 10);
  let asName: string | null = null;
  if (Number.isFinite(asn)) {
    // Answer: "15169 | US | arin | 2000-03-30 | GOOGLE - Google LLC, US"
    const asTxt = (await resolver.resolveTxt(`AS${asn}.asn.cymru.com`).catch(() => [] as string[][])).map((t) => t.join(""))[0];
    asName = asTxt?.split("|")[4]?.trim() ?? null;
  }
  return { asn: Number.isFinite(asn) ? asn : null, country: cc || null, asName };
}

export async function lookupIp(ip: string): Promise<IpInfo> {
  const [ptrRes, cymruRes] = await Promise.allSettled([resolver.reverse(ip), cymru(ip)]);
  const ptr = ptrRes.status === "fulfilled" ? (ptrRes.value[0] ?? null) : null;
  const c = cymruRes.status === "fulfilled" ? cymruRes.value : { asn: null, country: null, asName: null };
  // Auth domains used by this IP help identify services whose PTR is generic.
  const authDomains = db
    .all<{ dkim: string; spf: string }>("SELECT dkim, spf FROM records WHERE source_ip = ? LIMIT 20", [ip])
    .flatMap((r) => [
      ...(JSON.parse(r.dkim) as { domain: string; result: string }[]).filter((d) => d.result === "pass").map((d) => d.domain),
      ...(JSON.parse(r.spf) as { domain: string; result: string }[]).filter((s) => s.result === "pass").map((s) => s.domain),
    ]);
  return {
    ip,
    ptr,
    asn: c.asn,
    as_name: c.asName,
    country: c.country,
    provider: detectProvider({ ptr, asName: c.asName, authDomains }),
  };
}

function save(info: IpInfo) {
  db.run(
    `INSERT INTO ip_info (ip, ptr, asn, as_name, country, provider, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(ip) DO UPDATE SET ptr = excluded.ptr, asn = excluded.asn, as_name = excluded.as_name,
       country = excluded.country, provider = excluded.provider, updated_at = excluded.updated_at`,
    [info.ip, info.ptr, info.asn, info.as_name, info.country, info.provider, nowSec()],
  );
}

function pump() {
  while (active < CONCURRENCY && queue.size) {
    const ip = queue.values().next().value as string;
    queue.delete(ip);
    active++;
    lookupIp(ip)
      .then(save)
      .catch((err) => logger.debug({ ip, err: (err as Error).message }, "ip enrichment failed"))
      .finally(() => {
        active--;
        pump();
      });
  }
}

export function enqueueIps(ips: string[]) {
  if (!getSettings().enrichment) return;
  const cutoff = nowSec() - REFRESH_AFTER;
  for (const ip of ips) {
    if (!isIPv4(ip) && !isIPv6(ip)) continue;
    const row = db.get<{ updated_at: number }>("SELECT updated_at FROM ip_info WHERE ip = ?", [ip]);
    if (!row || row.updated_at < cutoff) queue.add(ip);
  }
  pump();
}

/** Picks up IPs never enriched (e.g. after enabling enrichment or a restart). */
export function enrichBacklog() {
  const rows = db.all<{ source_ip: string }>(
    `SELECT DISTINCT r.source_ip FROM records r LEFT JOIN ip_info i ON i.ip = r.source_ip
     WHERE i.ip IS NULL OR i.updated_at < ? LIMIT 2000`,
    [nowSec() - REFRESH_AFTER],
  );
  enqueueIps(rows.map((r) => r.source_ip));
}

export function enrichmentStatus() {
  return { pending: queue.size, active };
}

export function initEnrichment() {
  events.on("report:stored", (e) => enqueueIps(e.ips));
}
