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
