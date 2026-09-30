import { prisma } from "@dmark-hole/db";

interface SummaryJobData {
  domainId: string;
  organizationId: string;
  date: string;
}

export async function processSummary(data: SummaryJobData): Promise<void> {
  const { domainId, organizationId, date } = data;

  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  // Get all records for this day
  const records = await prisma.dmarcRecord.findMany({
    where: {
      report: { domainId, organizationId, createdAt: { gte: dayStart, lte: dayEnd } },
    },
    select: {
      count: true,
      disposition: true,
      dkimResult: true,
      spfResult: true,
      sourceIp: true,
      country: true,
      asn: true,
      isForwarder: true,
    },
  });

  const totalEmails = records.reduce((sum, r) => sum + r.count, 0);
  const spfPass = records.filter((r) => r.spfResult === "PASS").reduce((sum, r) => sum + r.count, 0);
  const spfFail = records.filter((r) => r.spfResult === "FAIL").reduce((sum, r) => sum + r.count, 0);
  const dkimPass = records.filter((r) => r.dkimResult === "PASS").reduce((sum, r) => sum + r.count, 0);
  const dkimFail = records.filter((r) => r.dkimResult === "FAIL").reduce((sum, r) => sum + r.count, 0);
  const dmarcPass = records.filter((r) => r.disposition === "NONE" || (r.disposition === "QUARANTINE" && r.spfResult === "PASS" && r.dkimResult === "PASS")).reduce((sum, r) => sum + r.count, 0);
  const dmarcFail = totalEmails - dmarcPass;

  const uniqueIps = new Set(records.map((r) => r.sourceIp)).size;
  const forwarders = records.filter((r) => r.isForwarder).length;

  const spfAligned = totalEmails > 0 ? (spfPass / totalEmails) * 100 : 0;
  const dkimAligned = totalEmails > 0 ? (dkimPass / totalEmails) * 100 : 0;

  // Calculate health score
  const healthScore = totalEmails > 0
    ? (spfAligned * 0.3 + dkimAligned * 0.3 + (dmarcPass / Math.max(totalEmails, 1)) * 100 * 0.4)
    : 0;

  // Top senders
  const senderMap = new Map<string, number>();
  const countryMap = new Map<string, number>();
  const asnMap = new Map<number, number>();

  for (const r of records) {
    senderMap.set(r.sourceIp, (senderMap.get(r.sourceIp) || 0) + r.count);
    if (r.country) countryMap.set(r.country, (countryMap.get(r.country) || 0) + r.count);
    if (r.asn) asnMap.set(r.asn, (asnMap.get(r.asn) || 0) + r.count);
  }

  const topSenders = [...senderMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ip, count]) => ({ ip, count }));

  const topCountries = [...countryMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([country, count]) => ({ country, count }));

  const topAsn = [...asnMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([asn, count]) => ({ asn, count }));

  // Upsert daily summary
  await prisma.dmarcDailySummary.upsert({
    where: {
      domainId_date: { domainId, date: dayStart },
    },
    create: {
      domainId,
      organizationId,
      date: dayStart,
      totalEmails,
      spfPass,
      spfFail,
      dkimPass,
      dkimFail,
      dmarcPass,
      dmarcFail,
      uniqueIps,
      forwarders,
      spfAligned,
      dkimAligned,
      healthScore,
      topSenders,
      topCountries,
      topAsn,
    },
    update: {
      totalEmails,
      spfPass,
      spfFail,
      dkimPass,
      dkimFail,
      dmarcPass,
      dmarcFail,
      uniqueIps,
      forwarders,
      spfAligned,
      dkimAligned,
      healthScore,
      topSenders,
      topCountries,
      topAsn,
    },
  });

  console.log(`Summary computed for domain ${domainId} on ${date}: ${totalEmails} emails`);
}
