export type Category = "pass" | "forwarded" | "misaligned" | "fail";
export type SourceStatus = "authorized" | "forwarder" | "needs_config" | "suspicious" | "mixed";
export type CheckStatus = "ok" | "info" | "warning" | "error";

export interface User {
  id: number;
  email: string;
  name: string;
  role: "admin" | "viewer";
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Totals {
  messages: number;
  reports: number;
  sources: number;
  categories: Record<Category, number>;
  dmarcPass: number;
  compliance: number | null;
  spfAlignedRate: number | null;
  dkimAlignedRate: number | null;
  disposition: { none: number; quarantine: number; reject: number };
}

export interface Overview extends Totals {
  range: { from: string; to: string };
  previous: Totals;
}

export interface Timeseries {
  days: string[];
  series: Record<Category, number[]> & { compliance: (number | null)[] };
}

export interface DomainSummary {
  id: number;
  name: string;
  displayName: string | null;
  notes: string | null;
  autoCreated: boolean;
  createdAt: number;
  messages: number;
  failing: number;
  misaligned: number;
  sources: number;
  compliance: number | null;
  totalReports: number;
  lastReportAt: number | null;
  policy: string | null;
  pct: number | null;
  dnsScore: number | null;
  dnsCheckedAt: number | null;
  dnsIssues: number | null;
  health: number | null;
  spark: { day: string; messages: number; compliance: number | null }[];
}

export interface Check {
  status: CheckStatus;
  title: string;
  detail?: string;
}

export interface SpfNode {
  domain: string;
  record: string | null;
  lookups: number;
  error?: string;
  mechanisms: { qualifier: string; type: string; value: string | null }[];
  children: SpfNode[];
}

export interface DkimSelector {
  selector: string;
  domain: string;
  found: boolean;
  record: string | null;
  keyType: string | null;
  keyBits: number | null;
  testing: boolean;
  revoked: boolean;
  fromReports: boolean;
  checks: Check[];
}

export interface DnsReport {
  domain: string;
  checkedAt: number;
  score: number;
  dmarc: { record: string | null; source: "domain" | "organizational" | null; tags: Record<string, string>; rua: string[]; ruf: string[]; checks: Check[] };
  spf: { record: string | null; tree: SpfNode | null; lookups: number; voidLookups: number; all: string | null; checks: Check[] };
  dkim: { selectors: DkimSelector[]; checks: Check[] };
  mx: { hosts: { exchange: string; priority: number }[]; checks: Check[] };
  mtaSts: { record: string | null; policy: { mode: string | null; mx: string[]; maxAge: number | null } | null; checks: Check[] };
  tlsRpt: { record: string | null; rua: string[]; checks: Check[] };
  bimi: { record: string | null; logo: string | null; vmc: string | null; checks: Check[] };
}

export interface DomainDetail {
  id: number;
  name: string;
  displayName: string | null;
  notes: string | null;
  autoCreated: boolean;
  dkimSelectors: string[];
  dnsCheckedAt: number | null;
  dnsResult: DnsReport | null;
  createdAt: number;
}

export interface Recommendation {
  id: string;
  severity: "critical" | "warning" | "info" | "success";
  title: string;
  detail: string;
  action?: string;
}

export interface Source {
  ip: string;
  ptr: string | null;
  asn: number | null;
  asName: string | null;
  country: string | null;
  provider: string | null;
  messages: number;
  pass: number;
  forwarded: number;
  misaligned: number;
  fail: number;
  spfAligned: number;
  dkimAligned: number;
  firstSeen: number;
  lastSeen: number;
  domains: string[];
  dkimDomains: string[];
  spfDomains: string[];
  dispositions: Record<string, number>;
  status: SourceStatus;
}

export interface Provider {
  name: string;
  ips: number;
  messages: number;
  pass: number;
  forwarded: number;
  misaligned: number;
  fail: number;
  countries: string[];
  compliance: number | null;
  status: SourceStatus;
}

export interface Reporter {
  name: string;
  reports: number;
  messages: number;
  compliance: number | null;
}

export interface DkimAuth {
  domain: string;
  selector: string | null;
  result: string;
  humanResult: string | null;
  aligned: boolean;
}
export interface SpfAuth {
  domain: string;
  scope: string | null;
  result: string;
  aligned: boolean;
}

export interface ReportListItem {
  id: number;
  domainId: number;
  domain: string;
  orgName: string;
  orgEmail: string | null;
  reportId: string;
  beginTs: number;
  endTs: number;
  p: string | null;
  sp: string | null;
  pct: number | null;
  messages: number;
  pass: number;
  recordCount: number;
  source: string;
  receivedAt: number;
}

export interface ReportRecord {
  id: number;
  sourceIp: string;
  count: number;
  disposition: string;
  dkimEval: string;
  spfEval: string;
  dmarcPass: boolean;
  reasons: { type: string; comment: string | null }[];
  headerFrom: string;
  envelopeFrom: string | null;
  envelopeTo: string | null;
  dkim: DkimAuth[];
  spf: SpfAuth[];
  category: Category;
  ptr: string | null;
  provider: string | null;
  country: string | null;
  asName: string | null;
}

export interface ReportDetail extends ReportListItem {
  extraContact: string | null;
  policyDomain: string;
  np: string | null;
  adkim: string | null;
  aspf: string | null;
  fo: string | null;
  testing: string | null;
  version: string | null;
  errors: string[];
  hasXml: boolean;
  records: ReportRecord[];
}

export interface Alert {
  id: number;
  domainId: number | null;
  domain: string | null;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  data: Record<string, unknown>;
  createdAt: number;
  readAt: number | null;
}

export interface Mailbox {
  id: number;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  folder: string;
  afterAction: "seen" | "move" | "delete";
  processedFolder: string;
  failedFolder: string;
  onlyUnseen: boolean;
  tlsRejectUnauthorized: boolean;
  enabled: boolean;
  pollMinutes: number;
  lastRunAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
  totalMessages: number;
  totalReports: number;
  running: boolean;
}

export interface IngestLogItem {
  id: number;
  ts: number;
  source: string;
  status: "ok" | "duplicate" | "error" | "ignored";
  kind: string | null;
  message: string | null;
  subject: string | null;
  domain: string | null;
  reportRef: number | null;
}

export interface IngestStatus {
  smtp: { running: boolean; host: string; port: number; tls: boolean; received: number; lastError: string | null };
  enrichment: { pending: number; active: number };
  counts: { reports: number; forensic: number; last: number | null };
  ingestToken: string | null;
}

export interface Settings {
  autoCreateDomains: boolean;
  storeRawXml: boolean;
  retentionDays: number;
  forensicRetentionDays: number;
  enrichment: boolean;
  dnsCheckHours: number;
  smtpReceiver: { enabled: boolean; allowedRecipients: string[] };
  alerts: { enabled: boolean; newSourceMinMessages: number; complianceThreshold: number; minSeverity: "info" | "warning" | "critical" };
  notifications: {
    webhookUrl: string;
    webhookFormat: "auto" | "slack" | "discord" | "teams" | "generic";
    email: { enabled: boolean; host: string; port: number; secure: boolean; username: string; password: string; from: string; to: string };
    weeklyDigest: boolean;
  };
}

export interface ForensicItem {
  id: number;
  domainId: number | null;
  domain: string | null;
  receivedAt: number;
  arrivalTs: number | null;
  reporter: string | null;
  sourceIp: string | null;
  feedbackType: string | null;
  authFailure: string | null;
  deliveryResult: string | null;
  originalMailFrom: string | null;
  originalRcptTo: string | null;
  subject: string | null;
  headerFrom: string | null;
  ptr: string | null;
  provider: string | null;
  country: string | null;
}
