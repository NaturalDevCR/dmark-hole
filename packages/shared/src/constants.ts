// =============================================================================
// Time constants
// =============================================================================

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

// =============================================================================
// Rate limits
// =============================================================================

export const RATE_LIMITS = {
  API_GLOBAL: { max: 600, window: "1 minute" },
  API_AUTH: { max: 10, window: "1 minute" },
  API_INGEST_WEBHOOK: { max: 60, window: "1 minute" },
  DNS_QUERIES: { max: 100, window: "1 minute" },
  INGEST_EMAILS: { max: 30, window: "1 minute" },
} as const;

// =============================================================================
// DNS thresholds
// =============================================================================

export const SPF_MAX_LOOKUPS = 10;
export const SPF_MAX_VOID_LOOKUPS = 2;
export const SPF_SOFTFAIL_WARN_THRESHOLD = 0.5;
export const DKIM_MIN_KEY_SIZE = 1024;
export const DKIM_WEAK_KEY_SIZE = 1024;
export const DKIM_STRONG_KEY_SIZE = 2048;
export const DMARC_MIN_PCT = 100;
export const DMARC_RUA_REQUIRED = true;

// =============================================================================
// Alert thresholds
// =============================================================================

export const ALERT_THRESHOLDS = {
  SPF_FAIL_SPIKE_PERCENT: 20,
  DKIM_FAIL_SPIKE_PERCENT: 20,
  TRAFFIC_SPIKE_PERCENT: 200,
  NEW_IP_WINDOW_DAYS: 90,
  HEALTH_SCORE_WARNING: 70,
  HEALTH_SCORE_CRITICAL: 50,
} as const;

// =============================================================================
// Known email providers & forwarders
// =============================================================================

export const KNOWN_EMAIL_PROVIDERS: Record<string, string> = {
  "google.com": "Google Workspace / Gmail",
  "googlemail.com": "Google Workspace / Gmail",
  "outlook.com": "Microsoft 365 / Outlook",
  "hotmail.com": "Microsoft 365 / Hotmail",
  "office365.com": "Microsoft 365",
  "protection.outlook.com": "Microsoft 365 Protection",
  "yahoo.com": "Yahoo Mail",
  "aol.com": "AOL / Yahoo",
  "zoho.com": "Zoho Mail",
  "zoho.eu": "Zoho Mail Europe",
  "protonmail.com": "ProtonMail",
  "proton.me": "ProtonMail",
  "fastmail.com": "Fastmail",
  "fastmailusercontent.com": "Fastmail",
  "icloud.com": "Apple iCloud",
  "me.com": "Apple iCloud",
  "mac.com": "Apple iCloud",
  "gmx.com": "GMX",
  "mail.ru": "Mail.ru",
  "yandex.ru": "Yandex",
  "qq.com": "Tencent QQ",
  "126.com": "NetEase",
  "163.com": "NetEase",
  "sendgrid.net": "SendGrid / Twilio",
  "mandrillapp.com": "Mailchimp / Mandrill",
  "mailgun.org": "Mailgun",
  "amazonses.com": "Amazon SES",
  "mxtoolbox.com": "MXToolbox",
  "valimail.com": "Valimail",
  "dmarcian.com": "dmarcian",
  "agari.com": "Agari",
  "proofpoint.com": "Proofpoint",
  "mimecast.com": "Mimecast",
  "barracuda.com": "Barracuda",
  "sparkpostmail.com": "SparkPost / MessageBird",
  "mailchimp.com": "Mailchimp",
  "hubspot.com": "HubSpot",
  "salesforce.com": "Salesforce",
  "marketo.com": "Marketo",
};

export const KNOWN_FORWARDERS: Set<string> = new Set([
  "forwardemail.net",
  "forwardmx.io",
  "purelymail.com",
  "improvmx.com",
  "mailgun.org",
]);

// =============================================================================
// Known DKIM selectors
// =============================================================================

export const COMMON_DKIM_SELECTORS = [
  "default",
  "google",
  "selector1",
  "selector2",
  "dkim",
  "s1",
  "s2",
  "k1",
  "k2",
  "mail",
  "email",
  "2023",
  "2024",
  "2025",
  "2026",
  "smtp",
  "mta",
  "x",
  "key1",
  "key2",
  "sig1",
  "pm",
  "protonmail",
  "protonmail2",
  "protonmail3",
  "fm1",
  "fm2",
  "fm3",
  "mx",
  "mandrill",
  "sendgrid",
  "sparkpost",
  "zoho",
  "yahoo",
];

// =============================================================================
// DMARC report XML namespaces & patterns
// =============================================================================

export const DMARC_XML_NAMESPACES = [
  "urn:ietf:params:xml:ns:dmarc-2.0",
  "http://dmarc.org/dmarc-xml/0.1",
];

export const DMARC_REPORT_CONTENT_TYPES = [
  "application/zip",
  "application/gzip",
  "application/x-gzip",
  "application/x-zip-compressed",
  "application/xml",
  "text/xml",
  "application/octet-stream",
];

export const DMARC_REPORT_FILENAME_PATTERNS = [
  /^.*\.zip$/i,
  /^.*\.gz$/i,
  /^.*\.gzip$/i,
  /^.*\.xml$/i,
  /^report.*\.xml$/i,
  /^dmarc.*\.xml$/i,
  /^rua.*\.xml$/i,
];

// =============================================================================
// Abuse / Threat Intel sources
// =============================================================================

export const THREAT_INTEL_SOURCES = ["AbuseIPDB", "Spamhaus", "Talos", "VirusTotal"] as const;

// =============================================================================
// Default DNS TTLs
// =============================================================================

export const DNS_TTL_DEFAULTS: Record<string, number> = {
  TXT: 300,
  MX: 3600,
  A: 300,
  AAAA: 300,
  CNAME: 3600,
  PTR: 7200,
} as const;

// =============================================================================
// Export defaults
// =============================================================================

export const EXPORT_RETENTION_DAYS = 7;
export const MAX_EXPORT_ROWS = 100_000;

// =============================================================================
// Forensic report privacy
// =============================================================================

export const FORENSIC_RETENTION_DAYS = 30;
export const FORENSIC_BODY_TRUNCATE_LENGTH = 500;
