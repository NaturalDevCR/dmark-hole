import { prisma } from "@dmark-hole/db";
import { ALERT_THRESHOLDS } from "@dmark-hole/shared";

interface AlertJobData {
  domainId: string;
  organizationId: string;
  reportId?: string;
}

export async function processAlerts(data: AlertJobData): Promise<void> {
  const { domainId, organizationId, reportId } = data;

  const domain = await prisma.domain.findFirst({
    where: { id: domainId, organizationId },
    include: {
      dmarcSummary: {
        where: { date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        orderBy: { date: "desc" },
        take: 7,
      },
    },
  });

  if (!domain) return;

  const alerts: Array<{
    type: string;
    severity: "INFO" | "WARNING" | "CRITICAL";
    title: string;
    description: string;
    metadata: Record<string, unknown>;
  }> = [];

  // Check DMARC record validity
  const dmarcRecord = await prisma.dnsRecord.findFirst({
    where: { domainId, type: "DMARC", valid: true },
  });

  if (!dmarcRecord) {
    alerts.push({
      type: "NO_DMARC_RECORD",
      severity: "CRITICAL",
      title: `No DMARC record found for ${domain.domain}`,
      description: "DMARC record is missing. This domain is vulnerable to email spoofing.",
      metadata: { domain: domain.domain },
    });
  } else if (dmarcRecord.value.includes("p=none")) {
    const existingAlert = await prisma.alert.findFirst({
      where: { domainId, type: "DMARC_RECORD_INVALID", resolved: false },
    });
    if (!existingAlert) {
      alerts.push({
        type: "DMARC_RECORD_INVALID",
        severity: "WARNING",
        title: `DMARC policy set to 'none' for ${domain.domain}`,
        description: "DMARC policy is set to monitoring only (p=none). Consider moving to quarantine or reject.",
        metadata: { domain: domain.domain, record: dmarcRecord.value },
      });
    }
  }

  // Check for SPF record
  const spfRecord = await prisma.dnsRecord.findFirst({
    where: { domainId, type: "SPF", valid: true },
  });

  if (!spfRecord) {
    alerts.push({
      type: "NO_SPF_RECORD",
      severity: "CRITICAL",
      title: `No SPF record found for ${domain.domain}`,
      description: "SPF record is missing. Email spoofing protection is absent.",
      metadata: { domain: domain.domain },
    });
  }

  // Check SPF lookup limit
  if (spfRecord) {
    const includeMatches = spfRecord.value.match(/include:/g);
    const lookupCount = includeMatches ? includeMatches.length : 0;
    if (lookupCount > 10) {
      alerts.push({
        type: "SPF_LOOKUP_LIMIT_EXCEEDED",
        severity: "WARNING",
        title: `SPF lookup limit exceeded for ${domain.domain}`,
        description: `SPF record has ${lookupCount} includes. RFC limits are 10 lookups.`,
        metadata: { domain: domain.domain, lookupCount },
      });
    }
  }

  // Check DKIM
  const dkimRecords = await prisma.dnsRecord.findMany({
    where: { domainId, type: "DKIM", valid: true },
  });

  if (dkimRecords.length === 0) {
    alerts.push({
      type: "NO_DKIM_RECORD",
      severity: "CRITICAL",
      title: `No DKIM records found for ${domain.domain}`,
      description: "No DKIM selectors found. Enable DKIM signing for better deliverability.",
      metadata: { domain: domain.domain },
    });
  }

  // Check for weak DKIM keys
  for (const dkim of dkimRecords) {
    if (dkim.value.includes("p=") && !dkim.value.includes("k=rsa")) {
      const keyData = dkim.value.split("p=")[1]?.split(";")[0] || "";
      const decoded = Buffer.from(keyData, "base64").length;
      if (decoded < 128) {
        alerts.push({
          type: "DKIM_KEY_WEAK",
          severity: "WARNING",
          title: `Weak DKIM key detected for ${dkim.host}`,
          description: `DKIM key size is approximately ${decoded * 8} bits. Consider using 2048-bit keys.`,
          metadata: { selector: dkim.host, keySize: decoded * 8 },
        });
      }
    }
  }

  // Check for traffic spikes
  if (domain.dmarcSummary.length >= 2) {
    const latest = domain.dmarcSummary[0]!;
    const previous = domain.dmarcSummary[1]!;

    if (previous.totalEmails > 0 && latest.totalEmails > previous.totalEmails * 3) {
      alerts.push({
        type: "TRAFFIC_SPIKE",
        severity: "INFO",
        title: `Traffic spike detected for ${domain.domain}`,
        description: `Email volume increased from ${previous.totalEmails} to ${latest.totalEmails} in one day.`,
        metadata: {
          domain: domain.domain,
          previous: previous.totalEmails,
          latest: latest.totalEmails,
        },
      });
    }

    // Check SPF/DKIM fail spikes
    if (latest.spfFail > latest.spfPass * 0.5) {
      alerts.push({
        type: "SPF_FAIL_SPIKE",
        severity: "WARNING",
        title: `High SPF failure rate for ${domain.domain}`,
        description: `SPF failure rate is ${Math.round((latest.spfFail / Math.max(latest.spfPass + latest.spfFail, 1)) * 100)}%.`,
        metadata: { domain: domain.domain, spfPass: latest.spfPass, spfFail: latest.spfFail },
      });
    }

    if (latest.dkimFail > latest.dkimPass * 0.5) {
      alerts.push({
        type: "DKIM_FAIL_SPIKE",
        severity: "WARNING",
        title: `High DKIM failure rate for ${domain.domain}`,
        description: `DKIM failure rate is ${Math.round((latest.dkimFail / Math.max(latest.dkimPass + latest.dkimFail, 1)) * 100)}%.`,
        metadata: { domain: domain.domain, dkimPass: latest.dkimPass, dkimFail: latest.dkimFail },
      });
    }
  }

  // Save alerts (with deduplication)
  for (const alert of alerts) {
    const existing = await prisma.alert.findFirst({
      where: {
        domainId,
        type: alert.type as never,
        resolved: false,
      },
    });

    if (!existing) {
      await prisma.alert.create({
        data: {
          organizationId,
          domainId,
          type: alert.type as never,
          severity: alert.severity,
          title: alert.title,
          description: alert.description,
          metadata: alert.metadata,
        },
      });
    }
  }

  console.log(`Alert check complete for ${domain.domain}: ${alerts.length} new alerts`);
}
