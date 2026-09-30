import { z } from "zod";

// =============================================================================
// Auth Schemas
// =============================================================================

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(2).max(100),
  organizationName: z.string().min(2).max(100),
  organizationSlug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
});

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(2).max(100),
  role: z.enum(["ORG_ADMIN", "ANALYST", "READER"]),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  role: z.enum(["ORG_ADMIN", "ANALYST", "READER"]).optional(),
  active: z.boolean().optional(),
});

// =============================================================================
// Domain Schemas
// =============================================================================

export const createDomainSchema = z.object({
  domain: z.string().min(4).max(253).regex(/^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/),
  displayName: z.string().max(100).optional(),
  monitoringMode: z.enum(["MANUAL", "DAILY", "HOURLY", "REALTIME"]).default("DAILY"),
  tags: z.array(z.string()).default([]),
});

export const verifyDomainSchema = z.object({
  verificationCode: z.string(),
});

// =============================================================================
// Mailbox Schemas
// =============================================================================

export const imapConfigSchema = z.object({
  host: z.string(),
  port: z.number().int().min(1).max(65535).default(993),
  tls: z.boolean().default(true),
  user: z.string(),
  password: z.string(),
});

export const pop3ConfigSchema = z.object({
  host: z.string(),
  port: z.number().int().min(1).max(65535).default(995),
  tls: z.boolean().default(true),
  user: z.string(),
  password: z.string(),
});

export const microsoft365ConfigSchema = z.object({
  tenantId: z.string(),
  clientId: z.string(),
  clientSecret: z.string(),
  userEmail: z.string().email(),
});

export const gmailApiConfigSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
  refreshToken: z.string(),
  userEmail: z.string().email(),
});

export const createMailboxSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  type: z.enum(["IMAP", "POP3", "MICROSOFT365", "GMAIL_API", "SMTP_RECEIVER", "WEBHOOK"]),
  config: z.union([
    imapConfigSchema,
    pop3ConfigSchema,
    microsoft365ConfigSchema,
    gmailApiConfigSchema,
    z.object({}),
  ]),
  domainIds: z.array(z.string()).default([]),
});

export const updateMailboxSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  config: z.union([
    imapConfigSchema,
    pop3ConfigSchema,
    microsoft365ConfigSchema,
    gmailApiConfigSchema,
    z.object({}),
  ]).optional(),
  active: z.boolean().optional(),
  domainIds: z.array(z.string()).optional(),
});

// =============================================================================
// Integration Schemas
// =============================================================================

export const createIntegrationSchema = z.object({
  type: z.enum(["SLACK", "DISCORD", "TEAMS", "TELEGRAM", "WEBHOOK", "PAGERDUTY", "OPSGENIE", "EMAIL"]),
  name: z.string().min(1).max(100),
  config: z.record(z.unknown()),
});

export const updateIntegrationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  config: z.record(z.unknown()).optional(),
  active: z.boolean().optional(),
});

// =============================================================================
// Alert & Notification Schemas
// =============================================================================

export const createNotificationRuleSchema = z.object({
  name: z.string().min(1).max(100),
  enabled: z.boolean().default(true),
  alertTypes: z.array(z.enum([
    "NEW_IP_DETECTED", "SPF_FAIL_SPIKE", "DKIM_FAIL_SPIKE",
    "DMARC_POLICY_CHANGED", "PROVIDER_STOPPED_SIGNING",
    "ALIGNMENT_LOST", "TRAFFIC_SPIKE", "POSSIBLE_SPOOFING",
    "SPF_LOOKUP_LIMIT_EXCEEDED", "DMARC_RECORD_INVALID",
    "DKIM_KEY_WEAK", "DKIM_KEY_EXPIRING", "NO_SPF_RECORD",
    "NO_DKIM_RECORD", "NO_DMARC_RECORD", "DNS_CHANGE_DETECTED",
    "TLS_RPT_FAILURE", "BIMI_INVALID", "MTA_STS_FAILURE", "CUSTOM",
  ])),
  minSeverity: z.enum(["INFO", "WARNING", "CRITICAL"]).default("WARNING"),
  channels: z.array(z.enum(["EMAIL", "SLACK", "DISCORD", "TEAMS", "TELEGRAM", "WEBHOOK", "IN_APP"])),
  config: z.record(z.unknown()).default({}),
});

// =============================================================================
// Report & Export Schemas
// =============================================================================

export const reportQuerySchema = z.object({
  domainId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  sourceIp: z.string().optional(),
  headerFrom: z.string().optional(),
  disposition: z.enum(["NONE", "QUARANTINE", "REJECT"]).optional(),
  spfResult: z.enum(["PASS", "FAIL", "NEUTRAL", "TEMPERROR", "PERMERROR", "NONE"]).optional(),
  dkimResult: z.enum(["PASS", "FAIL", "NEUTRAL", "TEMPERROR", "PERMERROR", "NONE"]).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const exportRequestSchema = z.object({
  type: z.enum(["DMARC_REPORT", "SUMMARY", "DNS_SNAPSHOT", "ALERTS", "FULL_EXPORT"]),
  format: z.enum(["CSV", "JSON", "PDF"]),
  domainId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  filters: z.record(z.unknown()).default({}),
});

// =============================================================================
// API Key Schemas
// =============================================================================

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).default(["read"]),
  expiresAt: z.string().datetime().optional(),
});

// =============================================================================
// Dashboard Schemas
// =============================================================================

export const dashboardQuerySchema = z.object({
  domainId: z.string().optional(),
  period: z.enum(["7d", "30d", "90d", "1y"]).default("30d"),
});

// =============================================================================
// Ingestion Schemas
// =============================================================================

export const dmarcReportQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  search: z.string().optional(),
});

// =============================================================================
// Webhook Ingest Schema
// =============================================================================

export const webhookIngestSchema = z.object({
  domain: z.string(),
  email: z.string().email().optional(),
  rawReport: z.string(),
  reportType: z.enum(["AGGREGATE", "FORENSIC"]).default("AGGREGATE"),
  metadata: z.record(z.unknown()).optional(),
});
