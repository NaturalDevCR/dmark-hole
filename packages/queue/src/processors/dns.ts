import { prisma } from "@dmark-hole/db";
import dns from "node:dns/promises";
import { COMMON_DKIM_SELECTORS } from "@dmark-hole/shared";

interface DnsCheckJobData {
  domainId: string;
  organizationId: string;
  recordTypes?: string[];
}

export async function processDnsCheck(data: DnsCheckJobData): Promise<void> {
  const { domainId, organizationId, recordTypes } = data;

  const domain = await prisma.domain.findFirst({
    where: { id: domainId, organizationId, active: true },
  });

  if (!domain) return;

  const types = recordTypes || ["SPF", "DKIM", "DMARC", "BIMI", "MTA_STS", "TLS_RPT", "MX"];
  const domainName = domain.domain;

  const records: Array<{ type: string; host: string; value: string; valid: boolean; errors: unknown }> = [];
  let allValid = true;
  const allErrors: string[] = [];

  for (const type of types) {
    try {
      switch (type) {
        case "SPF": {
          const txtRecords = await resolveTxtSafe(domainName);
          const spfRecord = txtRecords.find((r) => r.startsWith("v=spf1"));
          if (spfRecord) {
            records.push({
              type: "SPF",
              host: domainName,
              value: spfRecord,
              valid: true,
              errors: [],
            });
          } else {
            allValid = false;
            allErrors.push("No SPF record found");
            records.push({
              type: "SPF",
              host: domainName,
              value: "",
              valid: false,
              errors: ["No SPF record found"],
            });
          }
          break;
        }
        case "DMARC": {
          const dmarcRecords = await resolveTxtSafe(`_dmarc.${domainName}`);
          const dmarc = dmarcRecords.find((r) => r.startsWith("v=DMARC1"));
          if (dmarc) {
            records.push({
              type: "DMARC",
              host: `_dmarc.${domainName}`,
              value: dmarc,
              valid: true,
              errors: [],
            });
          } else {
            allValid = false;
            allErrors.push("No DMARC record found");
            records.push({
              type: "DMARC",
              host: `_dmarc.${domainName}`,
              value: "",
              valid: false,
              errors: ["No DMARC record found"],
            });
          }
          break;
        }
        case "DKIM": {
          // Probe common selectors
          for (const selector of COMMON_DKIM_SELECTORS.slice(0, 20)) {
            try {
              const dkimRecords = await resolveTxtSafe(`${selector}._domainkey.${domainName}`);
              const dkim = dkimRecords.find((r) => r.includes("v=DKIM1") || r.includes("k=") || r.includes("p="));
              if (dkim) {
                records.push({
                  type: "DKIM",
                  host: `${selector}._domainkey.${domainName}`,
                  value: dkim,
                  valid: true,
                  errors: [],
                });
              }
            } catch {
              // Selector not found, continue
            }
          }
          break;
        }
        case "BIMI": {
          const bimiRecords = await resolveTxtSafe(`default._bimi.${domainName}`);
          const bimi = bimiRecords.find((r) => r.startsWith("v=BIMI1"));
          records.push({
            type: "BIMI",
            host: `default._bimi.${domainName}`,
            value: bimi || "",
            valid: !!bimi,
            errors: bimi ? [] : ["No BIMI record found"],
          });
          break;
        }
        case "MTA_STS": {
          const stsRecords = await resolveTxtSafe(`_mta-sts.${domainName}`);
          const sts = stsRecords.find((r) => r.startsWith("v=STSv1"));
          records.push({
            type: "MTA_STS",
            host: `_mta-sts.${domainName}`,
            value: sts || "",
            valid: !!sts,
            errors: sts ? [] : ["No MTA-STS record found"],
          });
          break;
        }
        case "TLS_RPT": {
          const tlsRecords = await resolveTxtSafe(`_smtp._tls.${domainName}`);
          const tls = tlsRecords.find((r) => r.startsWith("v=TLSRPTv1"));
          records.push({
            type: "TLS_RPT",
            host: `_smtp._tls.${domainName}`,
            value: tls || "",
            valid: !!tls,
            errors: tls ? [] : ["No TLS-RPT record found"],
          });
          break;
        }
        case "MX": {
          const mxRecords = await dns.resolveMx(domainName).catch(() => []);
          records.push({
            type: "MX",
            host: domainName,
            value: JSON.stringify(mxRecords),
            valid: mxRecords.length > 0,
            errors: mxRecords.length === 0 ? ["No MX records found"] : [],
          });
          break;
        }
      }
    } catch (error) {
      allValid = false;
      allErrors.push(`${type}: ${(error as Error).message}`);
    }
  }

  // Save DNS snapshot
  const snapshotHash = Buffer.from(JSON.stringify(records)).toString("base64").slice(0, 64);

  await prisma.dnsSnapshot.create({
    data: {
      domainId,
      records,
      hash: snapshotHash,
    },
  });

  // Upsert individual DNS records
  for (const record of records) {
    await prisma.dnsRecord.upsert({
      where: {
        domainId_type_host: {
          domainId,
          type: record.type as "SPF" | "DKIM" | "DMARC" | "MX" | "A" | "AAAA" | "PTR" | "BIMI" | "MTA_STS" | "TLS_RPT" | "TXT" | "CNAME",
          host: record.host,
        },
      },
      create: {
        domainId,
        type: record.type as "SPF" | "DKIM" | "DMARC" | "MX" | "A" | "AAAA" | "PTR" | "BIMI" | "MTA_STS" | "TLS_RPT" | "TXT" | "CNAME",
        host: record.host,
        value: record.value,
        valid: record.valid,
        errors: record.errors,
        checkedAt: new Date(),
      },
      update: {
        value: record.value,
        valid: record.valid,
        errors: record.errors,
        checkedAt: new Date(),
      },
    });
  }

  console.log(`DNS check complete for ${domainName}: ${records.length} records, valid=${allValid}`);
}

async function resolveTxtSafe(hostname: string): Promise<string[]> {
  try {
    const records = await dns.resolveTxt(hostname);
    return records.map((r) => (Array.isArray(r) ? r.join("") : r));
  } catch {
    return [];
  }
}
