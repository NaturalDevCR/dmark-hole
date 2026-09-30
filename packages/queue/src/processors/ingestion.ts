import { prisma } from "@dmark-hole/db";
import { decrypt } from "@dmark-hole/shared/utils";

interface IngestJobData {
  mailboxId: string;
  organizationId: string;
}

export async function processIngestion(data: IngestJobData): Promise<void> {
  const { mailboxId, organizationId } = data;

  const mailbox = await prisma.mailbox.findFirst({
    where: { id: mailboxId, organizationId, active: true },
    include: { mailboxDomains: true },
  });

  if (!mailbox) {
    console.warn(`Mailbox ${mailboxId} not found or inactive`);
    return;
  }

  await prisma.mailbox.update({
    where: { id: mailboxId },
    data: { syncStatus: "SYNCING" },
  });

  const startTime = Date.now();

  try {
    // Decrypt credentials
    let config: Record<string, unknown> = {};
    try {
      const raw = mailbox.config as Record<string, unknown>;
      if (raw.encrypted) {
        config = JSON.parse(decrypt(raw.encrypted as string));
      }
    } catch {
      throw new Error("Failed to decrypt mailbox credentials");
    }

    // Log ingestion start
    await prisma.ingestLog.create({
      data: {
        mailboxId,
        messageId: `batch-${Date.now()}`,
        subject: "Ingestion batch",
        success: false,
        stage: "FETCH",
        createdAt: new Date(),
      },
    });

    // Attempt email fetch based on mailbox type
    const fetchedCount = 0;
    let processedCount = 0;

    switch (mailbox.type) {
      case "IMAP":
        // IMAP connection would be established here using imapflow
        console.log(`IMAP ingestion for ${mailbox.email} - connecting to ${(config as Record<string, string>).host}`);
        // TODO: Implement IMAP fetch with imapflow
        break;

      case "POP3":
        console.log(`POP3 ingestion for ${mailbox.email} - connecting to ${(config as Record<string, string>).host}`);
        // TODO: Implement POP3 fetch
        break;

      case "MICROSOFT365":
        console.log(`Microsoft 365 ingestion for ${mailbox.email}`);
        // TODO: Implement Microsoft Graph API fetch
        break;

      case "GMAIL_API":
        console.log(`Gmail API ingestion for ${mailbox.email}`);
        // TODO: Implement Gmail API fetch
        break;

      case "WEBHOOK":
        // No fetch needed - webhook handles it
        break;

      case "SMTP_RECEIVER":
        // No fetch needed - SMTP receiver handles it
        break;
    }

    // Update stats
    const stats = (mailbox.stats as Record<string, number>) || {};
    stats.lastFetchedCount = fetchedCount;
    stats.lastProcessedCount = processedCount;
    stats.totalFetched = (stats.totalFetched || 0) + fetchedCount;

    await prisma.mailbox.update({
      where: { id: mailboxId },
      data: {
        syncStatus: "OK",
        lastSyncAt: new Date(),
        lastError: null,
        stats,
      },
    });

    // Update ingest log
    await prisma.ingestLog.create({
      data: {
        mailboxId,
        messageId: `batch-${Date.now()}-complete`,
        subject: "Ingestion batch complete",
        success: true,
        stage: "DONE",
        durationMs: Date.now() - startTime,
        createdAt: new Date(),
      },
    });

    console.log(`Ingestion complete for mailbox ${mailbox.email}: ${processedCount} reports processed`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    await prisma.mailbox.update({
      where: { id: mailboxId },
      data: {
        syncStatus: "ERROR",
        lastError: errorMessage,
      },
    });

    await prisma.ingestLog.create({
      data: {
        mailboxId,
        messageId: `batch-${Date.now()}-error`,
        subject: "Ingestion error",
        success: false,
        stage: "FAILED",
        error: errorMessage,
        durationMs: Date.now() - startTime,
        createdAt: new Date(),
      },
    });

    console.error(`Ingestion failed for mailbox ${mailbox.email}:`, errorMessage);
  }
}
