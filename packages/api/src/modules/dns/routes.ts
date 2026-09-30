import { FastifyInstance } from "fastify";
import dns from "node:dns/promises";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { dnsQueue } from "../../lib/queue.js";
import {
  COMMON_DKIM_SELECTORS,
  SPF_MAX_LOOKUPS,
  DKIM_WEAK_KEY_SIZE,
} from "@dmark-hole/shared";

async function getDomainForOrg(domainId: string, organizationId: string) {
  return prisma.domain.findUnique({
    where: { id: domainId },
    select: { id: true, domain: true, organizationId: true },
  });
}

// ---------------------------------------------------------------------------
// DNS Helpers
// ---------------------------------------------------------------------------

async function resolveTxt(name: string): Promise<string[]> {
  try {
    const records = await dns.resolveTxt(name);
    return records.map((r) => r.join(""));
  } catch {
    return [];
  }
}

function parseSPFMechanisms(spfRecord: string) {
  const parts = spfRecord.split(/\s+/).filter(Boolean);
  const mechanisms: Array<{
    qualifier: string;
    mechanism: string;
    value: string;
    prefix?: string;
    cidr?: string;
  }> = [];
  const modifiers: Array<{ name: string; value: string }> = [];

  const mechPattern = /^([+\-~?])?(ip4|ip6|include|a|mx|ptr|exists|redirect|all)(?::([^\s]+))?(?:\/(\d+))?$/;
  const modPattern = /^([a-z]+)=(.+)$/;

  for (const part of parts) {
    if (part.startsWith("v=") || part === "v=spf1") continue;

    const modMatch = part.match(modPattern);
    if (modMatch) {
      modifiers.push({ name: modMatch[1]!, value: modMatch[2]! });
      continue;
    }

    const mechMatch = part.match(mechPattern);
    if (mechMatch) {
      mechanisms.push({
        qualifier: mechMatch[1] || "+",
        mechanism: mechMatch[2]!,
        value: mechMatch[3] || "",
        cidr: mechMatch[4],
      });
    }
  }

  return { mechanisms, modifiers };
}

function countSPFLookups(mechanisms: Array<{ mechanism: string }>): number {
  let count = 0;
  for (const m of mechanisms) {
    if (["include", "a", "mx", "ptr", "exists"].includes(m.mechanism)) {
      count++;
    }
  }
  return count;
}

async function resolveSPFIncludes(
  includeDomain: string,
  depth: number = 0,
  maxDepth: number = 3,
): Promise<{
  domain: string;
  resolved: boolean;
  record?: string;
  includes: Array<any>;
  errors: string[];
}> {
  const result: any = {
    domain: includeDomain,
    resolved: false,
    includes: [],
    errors: [] as string[],
  };

  if (depth >= maxDepth) {
    result.errors.push(`Max include depth (${maxDepth}) reached`);
    return result;
  }

  try {
    const records = await resolveTxt(includeDomain);
    const spf = records.find((r) => r.startsWith("v=spf1"));
    if (spf) {
      result.resolved = true;
      result.record = spf;
      const { mechanisms } = parseSPFMechanisms(spf);
      const nestedIncludes = mechanisms.filter((m) => m.mechanism === "include");
      const results = await Promise.all(
        nestedIncludes.map((m) => resolveSPFIncludes(m.value, depth + 1, maxDepth)),
      );
      result.includes = results;
    }
  } catch (err: any) {
    result.errors.push(err.message || "DNS resolution failed");
  }

  return result;
}

// ---------------------------------------------------------------------------
// Analyzers
// ---------------------------------------------------------------------------

async function analyzeSPF(domain: string) {
  const warnings: string[] = [];
  const errors: string[] = [];

  const records = await resolveTxt(domain);
  const spfRecord = records.find((r) => r.startsWith("v=spf1"));

  if (!spfRecord) {
    return {
      record: null,
      version: null,
      mechanisms: [],
      modifiers: [],
      lookupCount: 0,
      isFlattened: false,
      warnings: ["No SPF record found"],
      errors,
      includeChain: [],
    };
  }

  const { mechanisms, modifiers } = parseSPFMechanisms(spfRecord);
  const lookupCount = countSPFLookups(mechanisms);

  if (lookupCount > SPF_MAX_LOOKUPS) {
    errors.push(`SPF lookup count (${lookupCount}) exceeds maximum of ${SPF_MAX_LOOKUPS}`);
  }

  const hasSoftFail = mechanisms.some((m) => m.qualifier === "~" && m.mechanism === "all");
  if (hasSoftFail) {
    warnings.push("Softfail policy (~all) allows spoofing — consider -all for stronger protection");
  }

  const hasWildcardIncludes = mechanisms.some(
    (m) => m.mechanism === "include" && m.value.includes("*"),
  );
  if (hasWildcardIncludes) {
    warnings.push("Wildcard includes are invalid in SPF");
  }

  const hasRedirect = mechanisms.some((m) => m.mechanism === "redirect");
  if (hasRedirect) {
    warnings.push("Redirect modifier is deprecated — use include instead");
  }

  const includes = mechanisms.filter((m) => m.mechanism === "include");
  const includeChain = await Promise.all(
    includes.map((m) => resolveSPFIncludes(m.value)),
  );

  let totalLookups = lookupCount;
  const countNested = (nodes: any[]): number => {
    let c = 0;
    for (const n of nodes) {
      if (n.resolved && n.record) {
        const { mechanisms: mechs } = parseSPFMechanisms(n.record!);
        c += countSPFLookups(mechs);
      }
      c += countNested(n.includes || []);
    }
    return c;
  };
  totalLookups += countNested(includeChain);

  return {
    record: spfRecord,
    version: "spf1",
    mechanisms,
    modifiers,
    lookupCount: totalLookups,
    isFlattened: includeChain.length === 0 && lookupCount <= SPF_MAX_LOOKUPS,
    warnings,
    errors,
    includeChain,
  };
}

async function analyzeDKIM(domain: string, selector?: string) {
  const selectors = selector
    ? [selector]
    : COMMON_DKIM_SELECTORS.slice(0, 20);

  const results = await Promise.all(
    selectors.map(async (sel) => {
      const name = `${sel}._domainkey.${domain}`;
      const warnings: string[] = [];
      const errors: string[] = [];

      try {
        const records = await resolveTxt(name);
        const dkimRecord = records.find((r) => r.includes("v=DKIM1"));

        if (!dkimRecord) return null;

        const tags: Record<string, string> = {};
        const rawTags = dkimRecord.split(/\s*;\s*/).filter(Boolean);
        for (const tag of rawTags) {
          if (tag.includes("=")) {
            const [key, ...rest] = tag.split("=");
            tags[key!.trim()] = rest.join("=").trim();
          }
        }

        const keyType = tags["k"] || "rsa";
        const pubKey = tags["p"] || "";
        const isRevoked = pubKey === "";

        const flags = tags["h"] ? tags["h"].split(":") : [];
        const services = tags["s"] ? tags["s"].split(":") : ["*"];
        const notes = tags["n"] || "";

        let keySize = 0;
        if (!isRevoked && pubKey) {
          try {
            const decoded = Buffer.from(pubKey, "base64");
            keySize = decoded.length * 8;
          } catch {
            errors.push("Failed to decode public key");
          }
        }

        const isWeak = keySize > 0 && keySize < DKIM_WEAK_KEY_SIZE * 8;
        if (isWeak) {
          warnings.push(`Weak DKIM key (${Math.round(keySize)} bits) — minimum recommended is ${DKIM_WEAK_KEY_SIZE} bits`);
        }

        if (isRevoked) {
          warnings.push("DKIM key is revoked (empty p= value)");
        }

        return {
          selector: sel,
          domain,
          publicKey: isRevoked ? "(revoked)" : (pubKey.length > 80 ? pubKey.substring(0, 80) + "..." : pubKey),
          flags,
          keyType,
          keySize: Math.round(keySize),
          isWeak,
          isRevoked,
          notes,
          services,
          fingerprint: tags["h"] || "",
          warnings,
          errors,
        };
      } catch {
        return null;
      }
    }),
  );

  return results.filter(Boolean);
}

async function analyzeDMARC(domain: string) {
  const name = `_dmarc.${domain}`;
  const warnings: string[] = [];
  const errors: string[] = [];

  const records = await resolveTxt(name);
  const dmarcRecord = records.find((r) => r.startsWith("v=DMARC1"));

  if (!dmarcRecord) {
    return {
      record: null,
      version: "DMARC1",
      policy: null,
      subdomainPolicy: null,
      percentage: 100,
      rua: [],
      ruf: [],
      adkim: "r",
      aspf: "r",
      fo: [],
      rf: "afrf",
      ri: 86400,
      pct: 100,
      sp: null,
      errors: ["No DMARC record found"],
      warnings: [],
    };
  }

  const tags: Record<string, string> = {};
  const rawTags = dmarcRecord.split(/\s*;\s*/).filter(Boolean);
  for (const tag of rawTags) {
    if (tag.includes("=")) {
      const [key, ...rest] = tag.split("=");
      tags[key!.trim()] = rest.join("=").trim();
    }
  }

  const raw = dmarcRecord;
  const version = tags["v"] || "DMARC1";
  const policy = (tags["p"] || "none").toLowerCase() as "none" | "quarantine" | "reject";
  const subdomainPolicy = tags["sp"] ? (tags["sp"].toLowerCase() as "none" | "quarantine" | "reject") : null;
  const pct = parseInt(tags["pct"] || "100", 10) || 100;
  const rua = tags["rua"] ? tags["rua"].split(",").map((s) => s.trim()) : [];
  const ruf = tags["ruf"] ? tags["ruf"].split(",").map((s) => s.trim()) : [];
  const adkim = (tags["adkim"] || "r").toLowerCase() as "r" | "s";
  const aspf = (tags["aspf"] || "r").toLowerCase() as "r" | "s";
  const fo = tags["fo"] ? tags["fo"].split(":") : [];
  const rf = tags["rf"] || "afrf";
  const ri = parseInt(tags["ri"] || "86400", 10) || 86400;
  const sp = tags["sp"] || null;

  if (policy === "none") {
    warnings.push("p=none provides no protection — consider quarantine or reject");
  }
  if (pct < 100) {
    warnings.push(`pct=${pct} means only ${pct}% of emails get policy applied`);
  }
  if (rua.length === 0) {
    warnings.push("No rua (aggregate report URI) configured — no visibility into email authentication");
  }

  if (!["none", "quarantine", "reject"].includes(policy)) {
    errors.push(`Invalid policy value: ${policy}`);
  }

  return {
    raw,
    version,
    policy,
    subdomainPolicy,
    percentage: 100,
    rua,
    ruf,
    adkim,
    aspf,
    fo,
    rf,
    ri,
    pct,
    sp,
    errors,
    warnings,
  };
}

async function analyzeBIMI(domain: string) {
  const name = `default._bimi.${domain}`;
  const warnings: string[] = [];
  const errors: string[] = [];

  const records = await resolveTxt(name);
  const bimiRecord = records.find((r) => r.startsWith("v=BIMI1"));

  if (!bimiRecord) {
    return {
      raw: null,
      version: null,
      logoUrl: null,
      vmcUrl: undefined,
      validSvg: false,
      hasVmc: false,
      warnings: ["No BIMI record found"],
      errors: [],
    };
  }

  const tags: Record<string, string> = {};
  const rawTags = bimiRecord.split(/\s*;\s*/).filter(Boolean);
  for (const tag of rawTags) {
    if (tag.includes("=")) {
      const [key, ...rest] = tag.split("=");
      tags[key!.trim()] = rest.join("=").trim();
    }
  }

  const logoUrl = tags["l"] || null;
  const vmcUrl = tags["a"];

  if (!logoUrl) {
    errors.push("Missing required logo URL (l=) in BIMI record");
  }

  if (!vmcUrl) {
    warnings.push("No VMC (Verified Mark Certificate) specified — some providers require this for display");
  }

  return {
    raw: bimiRecord,
    version: "BIMI1",
    logoUrl,
    vmcUrl,
    validSvg: logoUrl ? logoUrl.endsWith(".svg") === true : false,
    hasVmc: !!vmcUrl,
    warnings,
    errors,
  };
}

async function analyzeMTASTS(domain: string) {
  const name = `_mta-sts.${domain}`;
  const errors: string[] = [];

  const records = await resolveTxt(name);
  const stsRecord = records.find((r) => r.startsWith("v=STSv1"));

  if (!stsRecord) {
    return {
      raw: null,
      version: null,
      mode: "none" as const,
      mxHosts: [] as string[],
      maxAge: 0,
      policyUrl: undefined,
      valid: false,
      errors: ["No MTA-STS record found"],
    };
  }

  const tags: Record<string, string> = {};
  const rawTags = stsRecord.split(/\s*;\s*/).filter(Boolean);
  for (const tag of rawTags) {
    if (tag.includes("=")) {
      const [key, ...rest] = tag.split("=");
      tags[key!.trim()] = rest.join("=").trim();
    }
  }

  const id = tags["id"] || "";

  const policyUrl = `https://mta-sts.${domain}/.well-known/mta-sts.txt`;
  let mode: "testing" | "enforce" | "none" = "none";
  let mxHosts: string[] = [];
  let maxAge = 0;
  let valid = false;

  try {
    const resp = await fetch(policyUrl, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const text = await resp.text();
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (line.includes(":")) {
          const [k, ...v] = line.split(":");
          const key = k!.trim();
          const val = v.join(":").trim();
          if (key === "mode") mode = val as "testing" | "enforce" | "none";
          if (key === "mx") mxHosts.push(val);
          if (key === "max_age") maxAge = parseInt(val, 10) || 0;
        }
      }
      valid = true;
    }
  } catch {
    errors.push("Could not fetch MTA-STS policy file");
  }

  return {
    raw: stsRecord,
    version: "STSv1",
    mode,
    mxHosts,
    maxAge,
    policyUrl,
    valid,
    errors,
  };
}

async function analyzeTLSRPT(domain: string) {
  const name = `_smtp._tls.${domain}`;
  const errors: string[] = [];

  const records = await resolveTxt(name);
  const tlsRecord = records.find((r) => r.startsWith("v=TLSRPTv1"));

  if (!tlsRecord) {
    return {
      raw: null,
      version: null,
      rua: [] as string[],
      valid: false,
      errors: ["No TLS-RPT record found"],
    };
  }

  const tags: Record<string, string> = {};
  const rawTags = tlsRecord.split(/\s*;\s*/).filter(Boolean);
  for (const tag of rawTags) {
    if (tag.includes("=")) {
      const [key, ...rest] = tag.split("=");
      tags[key!.trim()] = rest.join("=").trim();
    }
  }

  const rua = tags["rua"] ? tags["rua"].split(",").map((s) => s.trim()) : [];

  if (rua.length === 0) {
    errors.push("No rua specified — no TLS reports will be received");
  }

  return {
    raw: tlsRecord,
    version: "TLSRPTv1",
    rua,
    valid: rua.length > 0,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function dnsRoutes(server: FastifyInstance): Promise<void> {
  // GET /:domainId/spf
  server.get("/:domainId/spf", { preHandler: [authMiddleware] }, async (request, reply) => {
    const { domainId } = request.params as { domainId: string };
    const user = request.authUser!;

    const domain = await getDomainForOrg(domainId, user.organizationId);
    if (!domain) {
      return reply.status(404).send({ success: false, error: "Domain not found or access denied" });
    }

    const result = await analyzeSPF(domain.domain);
    return { success: true, data: result };
  });

  // GET /:domainId/dkim
  server.get("/:domainId/dkim", { preHandler: [authMiddleware] }, async (request, reply) => {
    const { domainId } = request.params as { domainId: string };
    const user = request.authUser!;
    const query = request.query as { selector?: string };

    const domain = await getDomainForOrg(domainId, user.organizationId);
    if (!domain) {
      return reply.status(404).send({ success: false, error: "Domain not found or access denied" });
    }

    const result = await analyzeDKIM(domain.domain, query.selector);
    return { success: true, data: result };
  });

  // GET /:domainId/dmarc
  server.get("/:domainId/dmarc", { preHandler: [authMiddleware] }, async (request, reply) => {
    const { domainId } = request.params as { domainId: string };
    const user = request.authUser!;

    const domain = await getDomainForOrg(domainId, user.organizationId);
    if (!domain) {
      return reply.status(404).send({ success: false, error: "Domain not found or access denied" });
    }

    const result = await analyzeDMARC(domain.domain);
    return { success: true, data: result };
  });

  // GET /:domainId/bimi
  server.get("/:domainId/bimi", { preHandler: [authMiddleware] }, async (request, reply) => {
    const { domainId } = request.params as { domainId: string };
    const user = request.authUser!;

    const domain = await getDomainForOrg(domainId, user.organizationId);
    if (!domain) {
      return reply.status(404).send({ success: false, error: "Domain not found or access denied" });
    }

    const result = await analyzeBIMI(domain.domain);
    return { success: true, data: result };
  });

  // GET /:domainId/mta-sts
  server.get("/:domainId/mta-sts", { preHandler: [authMiddleware] }, async (request, reply) => {
    const { domainId } = request.params as { domainId: string };
    const user = request.authUser!;

    const domain = await getDomainForOrg(domainId, user.organizationId);
    if (!domain) {
      return reply.status(404).send({ success: false, error: "Domain not found or access denied" });
    }

    const result = await analyzeMTASTS(domain.domain);
    return { success: true, data: result };
  });

  // GET /:domainId/tls-rpt
  server.get("/:domainId/tls-rpt", { preHandler: [authMiddleware] }, async (request, reply) => {
    const { domainId } = request.params as { domainId: string };
    const user = request.authUser!;

    const domain = await getDomainForOrg(domainId, user.organizationId);
    if (!domain) {
      return reply.status(404).send({ success: false, error: "Domain not found or access denied" });
    }

    const result = await analyzeTLSRPT(domain.domain);
    return { success: true, data: result };
  });

  // GET /:domainId/all
  server.get("/:domainId/all", { preHandler: [authMiddleware] }, async (request, reply) => {
    const { domainId } = request.params as { domainId: string };
    const user = request.authUser!;

    const domain = await getDomainForOrg(domainId, user.organizationId);
    if (!domain) {
      return reply.status(404).send({ success: false, error: "Domain not found or access denied" });
    }

    const [spf, dkim, dmarc, bimi, mtaSts, tlsRpt] = await Promise.all([
      analyzeSPF(domain.domain),
      analyzeDKIM(domain.domain),
      analyzeDMARC(domain.domain),
      analyzeBIMI(domain.domain),
      analyzeMTASTS(domain.domain),
      analyzeTLSRPT(domain.domain),
    ]);

    return {
      success: true,
      data: {
        domain: domain.domain,
        spf,
        dkim,
        dmarc,
        bimi,
        mtaSts,
        tlsRpt,
      },
    };
  });

  // POST /:domainId/refresh
  server.post("/:domainId/refresh", { preHandler: [authMiddleware, requireRole("ORG_ADMIN")] }, async (request, reply) => {
    const { domainId } = request.params as { domainId: string };
    const user = request.authUser!;

    const domain = await getDomainForOrg(domainId, user.organizationId);
    if (!domain) {
      return reply.status(404).send({ success: false, error: "Domain not found or access denied" });
    }

    await dnsQueue.add("check-dns", {
      domainId: domain.id,
      organizationId: user.organizationId,
    });

    return { success: true, data: { message: "DNS refresh job queued" } };
  });
}
