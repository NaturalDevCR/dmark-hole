import { Queue, QueueEvents, Worker, Job } from "bullmq";
import { redis } from "./redis.js";

// Queue names
export const Queues = {
  INGEST_MAILBOX: "ingest:mailbox",
  PARSE_DMARC_REPORT: "parse:dmarc-report",
  PROCESS_DMARC_RECORD: "process:dmarc-record",
  CHECK_DNS: "check:dns",
  GENERATE_ALERTS: "generate:alerts",
  SEND_NOTIFICATION: "send:notification",
  THREAT_INTEL: "threat:intel",
  COMPUTE_SUMMARY: "compute:summary",
  EXPORT_REPORT: "export:report",
  CLEANUP: "cleanup",
} as const;

const connection = { connection: redis };

export const ingestQueue = new Queue(Queues.INGEST_MAILBOX, connection);
export const parseQueue = new Queue(Queues.PARSE_DMARC_REPORT, connection);
export const processRecordQueue = new Queue(Queues.PROCESS_DMARC_RECORD, connection);
export const dnsQueue = new Queue(Queues.CHECK_DNS, connection);
export const alertQueue = new Queue(Queues.GENERATE_ALERTS, connection);
export const notifyQueue = new Queue(Queues.SEND_NOTIFICATION, connection);
export const threatIntelQueue = new Queue(Queues.THREAT_INTEL, connection);
export const summaryQueue = new Queue(Queues.COMPUTE_SUMMARY, connection);
export const exportQueue = new Queue(Queues.EXPORT_REPORT, connection);
export const cleanupQueue = new Queue(Queues.CLEANUP, connection);

// Queue events for monitoring
export const queueEvents = new QueueEvents(Queues.INGEST_MAILBOX, connection);

export interface IngestMailboxJob {
  mailboxId: string;
  organizationId: string;
}

export interface ParseReportJob {
  reportId: string;
  domainId: string;
  organizationId: string;
  rawXml: string;
}

export interface ProcessRecordJob {
  recordId: string;
  reportId: string;
  sourceIp: string;
}

export interface CheckDnsJob {
  domainId: string;
  organizationId: string;
  recordTypes?: string[];
}

export interface GenerateAlertsJob {
  domainId: string;
  organizationId: string;
  reportId?: string;
}

export interface SendNotificationJob {
  organizationId: string;
  alertId: string;
  channels: string[];
}

export interface ThreatIntelJob {
  domainId: string;
  ips: string[];
}

export interface ComputeSummaryJob {
  domainId: string;
  organizationId: string;
  date: string;
}

export interface ExportJobData {
  exportJobId: string;
  organizationId: string;
  userId: string;
}
