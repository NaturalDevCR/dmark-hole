// =============================================================================
// Domain & DNS Types
// =============================================================================

export type MonitoringMode = "MANUAL" | "DAILY" | "HOURLY" | "REALTIME";

export type DnsRecordType =
  | "SPF"
  | "DKIM"
  | "DMARC"
  | "MX"
  | "A"
  | "AAAA"
  | "PTR"
  | "BIMI"
  | "MTA_STS"
  | "TLS_RPT"
  | "TXT"
  | "CNAME";

export interface SPFRecord {
  raw: string;
  version: string;
  mechanisms: SPFMechanism[];
  modifiers: SPFModifier[];
  includes: string[];
  redirectDomain?: string;
  lookupCount: number;
  isFlattened: boolean;
  warnings: string[];
  errors: string[];
  includeChain: SPFIncludeNode[];
}

export interface SPFMechanism {
  qualifier: "+" | "-" | "~" | "?";
  mechanism: string;
  value: string;
  prefix?: string;
  cidr?: string;
}

export interface SPFModifier {
  name: string;
  value: string;
}

export interface SPFIncludeNode {
  domain: string;
  resolved: boolean;
  record?: string;
  includes: SPFIncludeNode[];
  errors: string[];
}

export interface DKIMRecord {
  selector: string;
  domain: string;
  publicKey: string;
  flags: string[];
  keyType: string;
  keySize: number;
  isWeak: boolean;
  isRevoked: boolean;
  notes: string;
  services: string[];
  fingerprint: string;
  warnings: string[];
  errors: string[];
}

export interface DMARCRecord {
  raw: string;
  version: string;
  policy: "none" | "quarantine" | "reject";
  subdomainPolicy: "none" | "quarantine" | "reject" | null;
  percentage: number;
  rua: string[];
  ruf: string[];
  adkim: "r" | "s";
  aspf: "r" | "s";
  fo: string[];
  rf: string;
  ri: number;
  pct: number;
  sp: string | null;
  errors: string[];
  warnings: string[];
}

export interface BIMIRecord {
  raw: string;
  version: string;
  logoUrl: string;
  vmcUrl?: string;
  validSvg: boolean;
  hasVmc: boolean;
  warnings: string[];
  errors: string[];
}

export interface MTASTSRecord {
  raw: string;
  version: string;
  mode: "testing" | "enforce" | "none";
  mxHosts: string[];
  maxAge: number;
  policyUrl?: string;
  valid: boolean;
  errors: string[];
}

export interface TLSRPTRecord {
  raw: string;
  version: string;
  rua: string[];
  valid: boolean;
  errors: string[];
}

// =============================================================================
// DMARC Report Types
// =============================================================================

export type ReportType = "AGGREGATE" | "FORENSIC";
export type PolicyP = "NONE" | "QUARANTINE" | "REJECT";
export type DkimSpfResult = "PASS" | "FAIL" | "NEUTRAL" | "TEMPERROR" | "PERMERROR" | "NONE";

export interface ParsedDmarcReport {
  reportId: string;
  reportType: ReportType;
  beginDate: Date;
  endDate: Date;
  policyDomain: string;
  policyAdkim: string;
  policyAspf: string;
  policyP: PolicyP;
  policyPct: number;
  policySp: string;
  reportOrg: string;
  reportEmail: string;
  extraContactInfo?: string;
  records: ParsedDmarcRecord[];
  rawXml: string;
  errors: string[];
  warnings: string[];
}

export interface ParsedDmarcRecord {
  sourceIp: string;
  sourceHost?: string;
  sourceOrg?: string;
  count: number;
  disposition: PolicyP;
  dkimResult: DkimSpfResult;
  spfResult: DkimSpfResult;
  dkimDomain?: string;
  dkimSelector?: string;
  spfDomain?: string;
  headerFrom: string;
  envelopeFrom?: string;
  envelopeTo?: string;
  extra?: Record<string, unknown>;
}

export interface ParsedForensicReport {
  reportId: string;
  subject?: string;
  sourceIp?: string;
  arrivedDate?: Date;
  disposition?: string;
  headers: Record<string, string>;
  bodyTruncated?: string;
  originalXml: string;
}

// =============================================================================
// Mailbox & Ingestion Types
// =============================================================================

export type MailboxType =
  | "IMAP"
  | "POP3"
  | "MICROSOFT365"
  | "GMAIL_API"
  | "SMTP_RECEIVER"
  | "WEBHOOK";

export type SyncStatus = "PENDING" | "SYNCING" | "OK" | "ERROR" | "RATE_LIMITED";
export type IngestStage = "FETCH" | "PARSE" | "VALIDATE" | "EXTRACT" | "STORE" | "DEDUP" | "DONE" | "FAILED";

export interface IMAPConfig {
  host: string;
  port: number;
  tls: boolean;
  user: string;
  password: string;
}

export interface POP3Config {
  host: string;
  port: number;
  tls: boolean;
  user: string;
  password: string;
}

export interface Microsoft365Config {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  userEmail: string;
}

export interface GmailApiConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  userEmail: string;
}

export interface SmtpReceiverConfig {
  port: number;
  host: string;
  tls: boolean;
  allowedSenders: string[];
}

export type MailboxConfig =
  | IMAPConfig
  | POP3Config
  | Microsoft365Config
  | GmailApiConfig
  | SmtpReceiverConfig;

// =============================================================================
// Alert & Notification Types
// =============================================================================

export type AlertType =
  | "NEW_IP_DETECTED"
  | "SPF_FAIL_SPIKE"
  | "DKIM_FAIL_SPIKE"
  | "DMARC_POLICY_CHANGED"
  | "PROVIDER_STOPPED_SIGNING"
  | "ALIGNMENT_LOST"
  | "TRAFFIC_SPIKE"
  | "POSSIBLE_SPOOFING"
  | "SPF_LOOKUP_LIMIT_EXCEEDED"
  | "DMARC_RECORD_INVALID"
  | "DKIM_KEY_WEAK"
  | "DKIM_KEY_EXPIRING"
  | "NO_SPF_RECORD"
  | "NO_DKIM_RECORD"
  | "NO_DMARC_RECORD"
  | "DNS_CHANGE_DETECTED"
  | "TLS_RPT_FAILURE"
  | "BIMI_INVALID"
  | "MTA_STS_FAILURE"
  | "CUSTOM";

export type Severity = "INFO" | "WARNING" | "CRITICAL";
export type NotificationChannel = "EMAIL" | "SLACK" | "DISCORD" | "TEAMS" | "TELEGRAM" | "WEBHOOK" | "IN_APP";

export interface AlertPayload {
  organizationId: string;
  domainId: string;
  type: AlertType;
  severity: Severity;
  title: string;
  description: string;
  metadata: Record<string, unknown>;
}

// =============================================================================
// Dashboard & API Types
// =============================================================================

export interface DomainHealthScore {
  domain: string;
  overallScore: number;
  spfScore: number;
  dkimScore: number;
  dmarcScore: number;
  spfAlignedPercent: number;
  dkimAlignedPercent: number;
  dmarcPassPercent: number;
  trend: "up" | "down" | "stable";
  lastUpdated: Date;
}

export interface DashboardSummary {
  totalDomains: number;
  activeDomains: number;
  totalEmails: number;
  dmarcPassRate: number;
  spfPassRate: number;
  dkimPassRate: number;
  alertsOpen: number;
  alertsCritical: number;
  healthTrend: number[];
}

export interface TimeSeriesPoint {
  date: string;
  total: number;
  spfPass: number;
  dkimPass: number;
  dmarcPass: number;
  spfFail: number;
  dkimFail: number;
  dmarcFail: number;
}

export interface GeoDistribution {
  country: string;
  code: string;
  count: number;
  passRate: number;
}

export interface SenderDistribution {
  sourceIp: string;
  sourceHost?: string;
  sourceOrg?: string;
  count: number;
  spfPass: boolean;
  dkimPass: boolean;
  country?: string;
  asn?: number;
}

// =============================================================================
// Auth & User Types
// =============================================================================

export type UserRole = "SUPER_ADMIN" | "ORG_ADMIN" | "ANALYST" | "READER" | "API";
export type Plan = "FREE" | "PRO" | "ENTERPRISE" | "MSP";

export interface AuthUser {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  role: UserRole;
  plan: Plan;
}

export interface TokenPayload {
  sub: string;
  org: string;
  role: UserRole;
  plan: Plan;
  iat?: number;
  exp?: number;
}

// =============================================================================
// Utility Types
// =============================================================================

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DateRange {
  from: Date;
  to: Date;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: Record<string, unknown>;
}
