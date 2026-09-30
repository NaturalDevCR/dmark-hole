import { prisma } from "@dmark-hole/db";
import { FORENSIC_RETENTION_DAYS, EXPORT_RETENTION_DAYS } from "@dmark-hole/shared";

export async function processCleanup(): Promise<void> {
  const now = new Date();

  // Cleanup old forensic reports (privacy-sensitive data)
  const forensicRetention = new Date(now.getTime() - FORENSIC_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.forensicReport.updateMany({
    where: {
      createdAt: { lt: forensicRetention },
      retained: true,
    },
    data: {
      originalXml: "",
      sanitizedXml: "",
      bodyTruncated: null,
      retained: false,
    },
  });

  // Cleanup old export files
  const exportRetention = new Date(now.getTime() - EXPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.exportJob.updateMany({
    where: {
      createdAt: { lt: exportRetention },
      status: "COMPLETED",
    },
    data: {
      fileUrl: null,
    },
  });

  // Cleanup old sessions
  await prisma.session.deleteMany({
    where: { expiresAt: { lt: now } },
  });

  // Cleanup old ingest logs (keep 90 days)
  const ingestRetention = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  await prisma.ingestLog.deleteMany({
    where: { createdAt: { lt: ingestRetention } },
  });

  // Cleanup old audit logs (keep 180 days)
  const auditRetention = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
  await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: auditRetention } },
  });

  console.log("Cleanup completed");
}
