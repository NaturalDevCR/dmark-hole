import { prisma } from "@dmark-hole/db";

interface ExportJobData {
  exportJobId: string;
  organizationId: string;
  userId: string;
}

export async function processExport(data: ExportJobData): Promise<void> {
  const { exportJobId, organizationId } = data;

  const job = await prisma.exportJob.findFirst({
    where: { id: exportJobId, organizationId },
  });

  if (!job) return;

  await prisma.exportJob.update({
    where: { id: exportJobId },
    data: { status: "PROCESSING" },
  });

  try {
    const filters = job.filters as Record<string, unknown>;
    const domainId = filters.domainId as string | undefined;
    const from = filters.from ? new Date(filters.from as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = filters.to ? new Date(filters.to as string) : new Date();

    let result: unknown;

    switch (job.type) {
      case "DMARC_REPORT": {
        const reports = await prisma.dmarcReport.findMany({
          where: {
            organizationId,
            ...(domainId ? { domainId } : {}),
            createdAt: { gte: from, lte: to },
          },
          include: {
            domain: { select: { domain: true } },
            records: { take: 1000 },
          },
          take: 10000,
        });
        result = reports;
        break;
      }
      case "SUMMARY": {
        const summaries = await prisma.dmarcDailySummary.findMany({
          where: {
            organizationId,
            ...(domainId ? { domainId } : {}),
            date: { gte: from, lte: to },
          },
          orderBy: { date: "asc" },
        });
        result = summaries;
        break;
      }
      case "ALERTS": {
        const alerts = await prisma.alert.findMany({
          where: {
            organizationId,
            ...(domainId ? { domainId } : {}),
            createdAt: { gte: from, lte: to },
          },
          include: { domain: { select: { domain: true } } },
          take: 10000,
        });
        result = alerts;
        break;
      }
      case "DNS_SNAPSHOT": {
        const snapshots = await prisma.dnsSnapshot.findMany({
          where: {
            ...(domainId ? { domainId } : { domain: { organizationId } }),
            createdAt: { gte: from, lte: to },
          },
          include: { domain: { select: { domain: true } } },
          take: 5000,
        });
        result = snapshots;
        break;
      }
      default:
        result = [];
    }

    // Store result as JSON (in production: S3, local file, etc.)
    const fileUrl = `/exports/${exportJobId}.json`;

    await prisma.exportJob.update({
      where: { id: exportJobId },
      data: {
        status: "COMPLETED",
        fileUrl,
        completedAt: new Date(),
      },
    });

    console.log(`Export ${exportJobId} completed: ${fileUrl}`);
  } catch (error) {
    await prisma.exportJob.update({
      where: { id: exportJobId },
      data: {
        status: "FAILED",
        error: (error as Error).message,
        completedAt: new Date(),
      },
    });

    console.error(`Export ${exportJobId} failed:`, error);
  }
}
