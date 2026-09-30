import { Worker, Job } from "bullmq";
import { prisma } from "@dmark-hole/db";
import { redis } from "./lib/redis.js";
import { Queues } from "./lib/queue.js";
import { processIngestion } from "./processors/ingestion.js";
import { processParseReport } from "./processors/parser.js";
import { processRecord } from "./processors/record.js";
import { processDnsCheck } from "./processors/dns.js";
import { processAlerts } from "./processors/alerts.js";
import { processNotification } from "./processors/notifications.js";
import { processThreatIntel } from "./processors/threat-intel.js";
import { processSummary } from "./processors/summary.js";
import { processExport } from "./processors/export.js";
import { processCleanup } from "./processors/cleanup.js";

const connection = { connection: redis };

// =============================================================================
// Worker Definitions
// =============================================================================

const ingestWorker = new Worker(
  Queues.INGEST_MAILBOX,
  async (job: Job) => {
    await processIngestion(job.data);
  },
  { connection, concurrency: 5, limiter: { max: 30, duration: 60_000 } },
);

const parseWorker = new Worker(
  Queues.PARSE_DMARC_REPORT,
  async (job: Job) => {
    await processParseReport(job.data);
  },
  { connection, concurrency: 3 },
);

const recordWorker = new Worker(
  Queues.PROCESS_DMARC_RECORD,
  async (job: Job) => {
    await processRecord(job.data);
  },
  { connection, concurrency: 10 },
);

const dnsWorker = new Worker(
  Queues.CHECK_DNS,
  async (job: Job) => {
    await processDnsCheck(job.data);
  },
  { connection, concurrency: 5 },
);

const alertWorker = new Worker(
  Queues.GENERATE_ALERTS,
  async (job: Job) => {
    await processAlerts(job.data);
  },
  { connection, concurrency: 3 },
);

const notifyWorker = new Worker(
  Queues.SEND_NOTIFICATION,
  async (job: Job) => {
    await processNotification(job.data);
  },
  { connection, concurrency: 5 },
);

const threatIntelWorker = new Worker(
  Queues.THREAT_INTEL,
  async (job: Job) => {
    await processThreatIntel(job.data);
  },
  { connection, concurrency: 3 },
);

const summaryWorker = new Worker(
  Queues.COMPUTE_SUMMARY,
  async (job: Job) => {
    await processSummary(job.data);
  },
  { connection, concurrency: 3 },
);

const exportWorker = new Worker(
  Queues.EXPORT_REPORT,
  async (job: Job) => {
    await processExport(job.data);
  },
  { connection, concurrency: 2 },
);

const cleanupWorker = new Worker(
  Queues.CLEANUP,
  async (job: Job) => {
    await processCleanup(job.data);
  },
  { connection },
);

// =============================================================================
// Global Event Handlers
// =============================================================================

const workers = [
  ingestWorker, parseWorker, recordWorker, dnsWorker,
  alertWorker, notifyWorker, threatIntelWorker,
  summaryWorker, exportWorker, cleanupWorker,
];

for (const worker of workers) {
  worker.on("completed", (job) => {
    if (job) {
      console.log(`[${job.queueName}] Job ${job.id} completed`);
    }
  });

  worker.on("failed", (job, err) => {
    if (job) {
      console.error(`[${job.queueName}] Job ${job.id} failed:`, err.message);
    }
  });
}

// =============================================================================
// Periodic cleanup job
// =============================================================================

async function scheduleCleanup() {
  await prisma.$connect();
  console.log("Queue worker started, DB connected");
}

scheduleCleanup().catch(console.error);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down workers...");
  for (const worker of workers) {
    await worker.close();
  }
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Shutting down workers...");
  for (const worker of workers) {
    await worker.close();
  }
  await prisma.$disconnect();
  process.exit(0);
});
