/**
 * Demo data generator: builds realistic RFC 7489 aggregate report XML and feeds it through the
 * real parse + store pipeline so the web UI can be developed against believable data.
 *
 *   pnpm --filter @dmark-hole/server demo -- --days 60 --domains a.com,b.com --seed 42
 *
 * Only documentation IP space (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32) is used.
 * Safe to re-run: the store skips duplicates by hash / report_id.
 */
import { db } from "../db/index.js";
import { parseAggregate } from "../dmarc/aggregate.js";
import { storeAggregate } from "../ingest/store.js";

// ---------- args ----------

interface Args {
  days: number;
  domains: string[];
  seed: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { days: 60, domains: ["acme-corp.com", "acme-shop.net", "newsletter.acme-corp.com"], seed: 1337 };
  const list = argv.filter((a) => a !== "--");
  for (let i = 0; i < list.length; i++) {
    const [flag, inline] = (list[i] ?? "").split("=", 2) as [string, string | undefined];
    const value = () => inline ?? list[++i] ?? "";
    switch (flag) {
      case "--days": {
        const n = Number.parseInt(value(), 10);
        if (!Number.isFinite(n) || n < 1) throw new Error("--days must be a positive integer");
        out.days = n;
        break;
      }
      case "--domains": {
        const d = value().split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
        if (!d.length) throw new Error("--domains needs at least one domain");
        out.domains = d;
        break;
      }
      case "--seed": {
        const n = Number.parseInt(value(), 10);
        if (!Number.isFinite(n)) throw new Error("--seed must be an integer");
        out.seed = n;
        break;
      }
      case "--help":
      case "-h":
        console.log("Usage: demo [--days N] [--domains a.com,b.com] [--seed N]");
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }
  return out;
}

// ---------- PRNG ----------

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const rint = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
const noise = (r: Rng, spread = 0.5) => 1 - spread / 2 + r() * spread;

function sample<T>(r: Rng, xs: readonly T[], n: number): T[] {
  const pool = [...xs];
  const out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0] as T);
  return out;
}

// ---------- reporters ----------

interface Reporter {
  key: string;
  org: string;
  email: string;
  extra: string | null;
  weight: number;
  rcptDomain: string;
  reportId(domain: string, begin: number, end: number): string;
}

/** Deterministic digits/hex derived only from a key so ids stay stable across runs and seeds. */
function digits(key: string, n: number): string {
  const r = mulberry32(hash(key));
  let s = "";
  while (s.length < n) s += Math.floor(r() * 10);
  return s.replace(/^0/, "1");
}
function hex(key: string, n: number): string {
  const r = mulberry32(hash(key));
  let s = "";
  while (s.length < n) s += Math.floor(r() * 16).toString(16);
  return s;
}

const REPORTERS: Reporter[] = [
  {
    key: "google", org: "google.com", email: "noreply-dmarc-support@google.com", extra: "https://support.google.com/a/answer/2466580",
    weight: 0.38, rcptDomain: "gmail.com", reportId: (d, b) => digits(`google|${d}|${b}`, 20),
  },
  {
    key: "outlook", org: "Outlook.com", email: "dmarcreport@microsoft.com", extra: "https://support.microsoft.com/office/enterprise.protection.outlook.com",
    weight: 0.25, rcptDomain: "outlook.com",
    reportId: (d, b) => {
      const h = hex(`outlook|${d}|${b}`, 32);
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
    },
  },
  {
    key: "yahoo", org: "Yahoo", email: "dmarchelp@yahooinc.com", extra: null,
    weight: 0.15, rcptDomain: "yahoo.com", reportId: (d, b, e) => `${b}.${e}.${digits(`yahoo|${d}|${b}`, 6)}`,
  },
  {
    key: "mailru", org: "Mail.Ru", email: "dmarc_support@corp.mail.ru", extra: null,
    weight: 0.07, rcptDomain: "mail.ru", reportId: (d, b) => hex(`mailru|${d}|${b}`, 32),
  },
  {
    key: "comcast", org: "comcast.net", email: "dmarc_agg_reports@comcast.net", extra: null,
    weight: 0.08, rcptDomain: "comcast.net", reportId: (d, b, e) => `comcast.net!${d}!${b}!${e}`,
  },
  {
    key: "gmx", org: "GMX", email: "dmarc-reports@gmx.net", extra: null,
    weight: 0.07, rcptDomain: "gmx.de", reportId: (d, b) => `gmx-${d}-${b}-${digits(`gmx|${d}|${b}`, 4)}`,
  },
];

// ---------- domains and sending profiles ----------

interface Policy {
  p: string;
  sp: string | null;
  adkim: string;
  aspf: string;
  pct: number;
}

interface Profile {
  policy: Policy;
  /** Expected messages/day across all reporters on a busy weekday. */
  base: number;
  shares: { google: number; sendgrid: number; forwarder: number; list: number; crm: number; spoof: number };
  /** SendGrid signs with its own domain (misaligned) instead of the sender's. */
  sendgridMisaligned: boolean;
}

const PROFILES: Record<string, Profile> = {
  "acme-corp.com": {
    policy: { p: "quarantine", sp: "reject", adkim: "r", aspf: "r", pct: 100 },
    base: 2800,
    shares: { google: 0.62, sendgrid: 0.16, forwarder: 0.09, list: 0.015, crm: 0.06, spoof: 0.05 },
    sendgridMisaligned: false,
  },
  "acme-shop.net": {
    policy: { p: "none", sp: null, adkim: "r", aspf: "r", pct: 100 },
    base: 700,
    shares: { google: 0.28, sendgrid: 0.45, forwarder: 0.06, list: 0.005, crm: 0.05, spoof: 0.08 },
    sendgridMisaligned: true,
  },
  "newsletter.acme-corp.com": {
    policy: { p: "reject", sp: null, adkim: "r", aspf: "r", pct: 100 },
    base: 1000,
    shares: { google: 0.04, sendgrid: 0.82, forwarder: 0.05, list: 0.02, crm: 0, spoof: 0.07 },
    sendgridMisaligned: false,
  },
};

const DEFAULT_PROFILE: Profile = {
  policy: { p: "quarantine", sp: null, adkim: "r", aspf: "r", pct: 100 },
  base: 600,
  shares: { google: 0.55, sendgrid: 0.2, forwarder: 0.08, list: 0.01, crm: 0.05, spoof: 0.06 },
  sendgridMisaligned: false,
};

// ---------- source IP pools (documentation ranges only) ----------

const GOOGLE_IPS = [...Array.from({ length: 8 }, (_, i) => `192.0.2.${10 + i}`), "2001:db8:a::1", "2001:db8:a::2", "2001:db8:a::3", "2001:db8:a::4"];
const SENDGRID_IPS = Array.from({ length: 8 }, (_, i) => `198.51.100.${20 + i}`);
const FORWARDER_IPS = [...Array.from({ length: 6 }, (_, i) => `198.51.100.${100 + i}`), "2001:db8:f::5"];
const LIST_IPS = ["198.51.100.120", "198.51.100.121"];
const CRM_IPS = ["192.0.2.200", "192.0.2.201", "192.0.2.202"];

// ---------- record model and XML ----------

interface DkimResult { domain: string; selector: string; result: "pass" | "fail" }
interface SpfResult { domain: string; result: "pass" | "fail" | "softfail" | "neutral" }
interface Rec {
  ip: string;
  count: number;
  disposition: string;
  dkimEval: "pass" | "fail";
  spfEval: "pass" | "fail";
  reason?: { type: string; comment: string };
  envelopeFrom: string;
  dkim: DkimResult[];
  spf: SpfResult[];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function recordXml(r: Rec, domain: string, envelopeTo: string): string {
  const reason = r.reason ? `\n        <reason><type>${r.reason.type}</type><comment>${esc(r.reason.comment)}</comment></reason>` : "";
  const dkim = r.dkim
    .map((d) => `\n      <dkim>\n        <domain>${esc(d.domain)}</domain>\n        <result>${d.result}</result>\n        <selector>${esc(d.selector)}</selector>\n      </dkim>`)
    .join("");
  const spf = r.spf
    .map((s) => `\n      <spf>\n        <domain>${esc(s.domain)}</domain>\n        <scope>mfrom</scope>\n        <result>${s.result}</result>\n      </spf>`)
    .join("");
  return `  <record>
    <row>
      <source_ip>${r.ip}</source_ip>
      <count>${r.count}</count>
      <policy_evaluated>
        <disposition>${r.disposition}</disposition>
        <dkim>${r.dkimEval}</dkim>
        <spf>${r.spfEval}</spf>${reason}
      </policy_evaluated>
    </row>
    <identifiers>
      <envelope_to>${envelopeTo}</envelope_to>
      <envelope_from>${esc(r.envelopeFrom)}</envelope_from>
      <header_from>${esc(domain)}</header_from>
    </identifiers>
    <auth_results>${dkim}${spf}
    </auth_results>
  </record>`;
}

function reportXml(rep: Reporter, domain: string, policy: Policy, begin: number, end: number, records: Rec[]): string {
  const extra = rep.extra ? `\n    <extra_contact_info>${esc(rep.extra)}</extra_contact_info>` : "";
  const sp = policy.sp ? `\n    <sp>${policy.sp}</sp>` : "";
  return `<?xml version="1.0" encoding="UTF-8" ?>
<feedback>
  <version>1.0</version>
  <report_metadata>
    <org_name>${esc(rep.org)}</org_name>
    <email>${esc(rep.email)}</email>${extra}
    <report_id>${esc(rep.reportId(domain, begin, end))}</report_id>
    <date_range>
      <begin>${begin}</begin>
      <end>${end}</end>
    </date_range>
  </report_metadata>
  <policy_published>
    <domain>${esc(domain)}</domain>
    <adkim>${policy.adkim}</adkim>
    <aspf>${policy.aspf}</aspf>
    <p>${policy.p}</p>${sp}
    <pct>${policy.pct}</pct>
  </policy_published>
${records.map((r) => recordXml(r, domain, rep.rcptDomain)).join("\n")}
</feedback>
`;
}

// ---------- generation ----------

const DAY = 86400;

/** Weekday/weekend multipliers per source kind (dow: 0 = Sunday, UTC). */
const DOW = {
  google: [0.15, 1, 1.05, 1.0, 1.0, 0.95, 0.22],
  sendgrid: [0.1, 0.9, 1.6, 0.9, 1.6, 0.9, 0.15],
  forwarder: [0.5, 1, 1, 1, 1, 1, 0.5],
  list: [0.3, 1, 1, 1, 1, 1, 0.3],
  crm: [0.1, 1, 1, 1, 1, 1, 0.2],
  spoof: [1, 1, 1, 1, 1, 1, 1],
} as const;

function dispositionFor(policy: Policy): string {
  // pct is always 100 here, so every failing message gets the published policy.
  return policy.p;
}

function generateRecords(
  r: Rng, policy: Policy, profile: Profile, domain: string, rep: Reporter, dow: number, daysAgo: number, spikeMult: number,
): Rec[] {
  const out: Rec[] = [];
  const disp = dispositionFor(policy);
  const vol = (share: number, kind: keyof typeof DOW) => profile.base * share * DOW[kind][dow]! * rep.weight * noise(r);
  const split = (total: number, ips: string[]): [string, number][] => {
    const chosen = sample(r, ips, Math.min(ips.length, rint(r, 2, 4)));
    const weights = chosen.map(() => 0.3 + r());
    const sum = weights.reduce((a, b) => a + b, 0);
    return chosen.map((ip, i) => [ip, Math.round((total * weights[i]!) / sum)] as [string, number]);
  };

  // Google Workspace: everything aligned.
  for (const [ip, count] of split(vol(profile.shares.google, "google"), GOOGLE_IPS)) {
    if (count < 1) continue;
    out.push({
      ip, count, disposition: "none", dkimEval: "pass", spfEval: "pass", envelopeFrom: domain,
      dkim: [{ domain, selector: "google", result: "pass" }],
      spf: [{ domain, result: "pass" }],
    });
  }

  // SendGrid marketing: SPF passes for sendgrid.net (never aligned); DKIM aligned unless misconfigured.
  for (const [ip, count] of split(vol(profile.shares.sendgrid, "sendgrid"), SENDGRID_IPS)) {
    if (count < 1) continue;
    const spf: SpfResult[] = [{ domain: "sendgrid.net", result: "pass" }];
    if (profile.sendgridMisaligned) {
      out.push({
        ip, count, disposition: disp, dkimEval: "fail", spfEval: "fail", envelopeFrom: "bounces.sendgrid.net",
        dkim: [{ domain: "sendgrid.net", selector: "s1", result: "pass" }], spf,
      });
    } else {
      out.push({
        ip, count, disposition: "none", dkimEval: "pass", spfEval: "fail", envelopeFrom: "bounces.sendgrid.net",
        dkim: [{ domain, selector: "s1", result: "pass" }], spf,
      });
    }
  }

  // Forwarders: original SPF breaks, DKIM signature survives.
  for (const [ip, count] of split(vol(profile.shares.forwarder, "forwarder"), FORWARDER_IPS)) {
    if (count < 1) continue;
    out.push({
      ip, count, disposition: "none", dkimEval: "pass", spfEval: "fail", envelopeFrom: domain,
      dkim: [{ domain, selector: "google", result: "pass" }],
      spf: [{ domain, result: "fail" }],
    });
  }

  // Mailing list: body modified so DKIM breaks; receiver overrides the policy.
  if (profile.shares.list > 0 && r() < 0.6) {
    const count = Math.round(vol(profile.shares.list, "list"));
    if (count >= 1) {
      out.push({
        ip: pick(r, LIST_IPS), count, disposition: "none", dkimEval: "fail", spfEval: "fail",
        reason: { type: "mailing_list", comment: "Sender is a mailing list" }, envelopeFrom: "lists.example.org",
        dkim: [{ domain, selector: "google", result: "fail" }],
        spf: [{ domain: "lists.example.org", result: "fail" }],
      });
    }
  }

  // CRM: brand-new source that showed up in the last 10 days and authenticates with nothing.
  if (profile.shares.crm > 0 && daysAgo < 10) {
    const ramp = 1 - daysAgo / 12;
    const count = Math.round(vol(profile.shares.crm, "crm") * ramp);
    if (count >= 1) {
      out.push({
        ip: pick(r, CRM_IPS), count, disposition: disp, dkimEval: "fail", spfEval: "fail", envelopeFrom: "support.zendesk-mail.example",
        dkim: [{ domain, selector: "zendesk1", result: "fail" }],
        spf: [{ domain: "support.zendesk-mail.example", result: "softfail" }],
      });
    }
  }

  // Spoofers: random documentation IPs, nothing authenticates.
  if (profile.shares.spoof > 0) {
    const total = vol(profile.shares.spoof, "spoof") * spikeMult;
    const n = rint(r, 1, 4) + (spikeMult > 1 ? rint(r, 2, 5) : 0);
    for (let i = 0; i < n; i++) {
      const ip = r() < 0.12 ? `2001:db8:bad::${rint(r, 1, 0xfff).toString(16)}` : `203.0.113.${rint(r, 1, 254)}`;
      const count = Math.max(1, Math.round((total / n) * noise(r, 1)));
      out.push({
        ip, count, disposition: disp, dkimEval: "fail", spfEval: "fail",
        envelopeFrom: r() < 0.5 ? domain : `mail.${pick(r, ["bulkmailer", "promo-blast", "sendfast"])}.example`,
        dkim: [], spf: [{ domain: `mail.${pick(r, ["bulkmailer", "promo-blast", "sendfast"])}.example`, result: "fail" }],
      });
    }
  }
  return out.filter((x) => x.count > 0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  db.migrate();

  const todayStart = Math.floor(Date.now() / 1000 / DAY) * DAY;
  // Spike days for spoofing: a couple of deterministic days somewhere in the window.
  const spikeRng = mulberry32(args.seed ^ 0x5eed);
  const spikeDays = new Set<number>();
  while (spikeDays.size < Math.min(2, args.days)) spikeDays.add(rint(spikeRng, 1, args.days));

  const stats = { ok: 0, duplicate: 0, ignored: 0, error: 0, messages: 0 };
  console.log(`Generating demo data: ${args.days} days, domains ${args.domains.join(", ")}, seed ${args.seed}`);

  for (let daysAgo = args.days; daysAgo >= 1; daysAgo--) {
    const begin = todayStart - daysAgo * DAY;
    const end = begin + DAY - 1;
    const dow = new Date(begin * 1000).getUTCDay();
    const spike = spikeDays.has(daysAgo) ? 9 : 1;

    args.domains.forEach((domain, di) => {
      const profile = PROFILES[domain] ?? (di === 0 ? PROFILES["acme-corp.com"]! : DEFAULT_PROFILE);
      const policy = PROFILES[domain] ? profile.policy : DEFAULT_PROFILE.policy;
      const rng = mulberry32(args.seed ^ hash(`${domain}|${begin}`));

      // 4-6 reporters; the two biggest always report.
      const others = REPORTERS.slice(2);
      const chosen = [...REPORTERS.slice(0, 2), ...sample(rng, others, rint(rng, 2, 4))];
      for (const rep of chosen) {
        const repRng = mulberry32(args.seed ^ hash(`${domain}|${begin}|${rep.key}`));
        const records = generateRecords(repRng, policy, profile, domain, rep, dow, daysAgo, spike);
        if (!records.length) continue;
        const xml = reportXml(rep, domain, policy, begin, end, records);
        const item = storeAggregate(parseAggregate(xml), xml, "demo");
        stats[item.status]++;
        if (item.status === "ok") stats.messages += records.reduce((a, x) => a + x.count, 0);
      }
    });
    if (daysAgo % 10 === 0) console.log(`  ... ${args.days - daysAgo + 1}/${args.days} days`);
  }

  console.log("");
  console.log("Done.");
  console.log(`  Reports stored:     ${stats.ok}`);
  console.log(`  Duplicates skipped: ${stats.duplicate}`);
  if (stats.ignored) console.log(`  Ignored:            ${stats.ignored}`);
  if (stats.error) console.log(`  Errors:             ${stats.error}`);
  console.log(`  Messages (new):     ${stats.messages}`);
}

main();
