/**
 * Known sending services, matched against reverse DNS (PTR), the ASN name, and
 * the DKIM/SPF domains seen in reports. Order matters: first match wins.
 */
interface ProviderRule {
  name: string;
  ptr?: RegExp;
  asn?: RegExp;
  authDomain?: RegExp;
}

const RULES: ProviderRule[] = [
  { name: "Google", ptr: /(\.google\.com|\.googlemail\.com|\.1e100\.net)$/, asn: /^GOOGLE/i, authDomain: /(^|\.)google(mail)?\.com$|gappssmtp\.com$/ },
  { name: "Microsoft 365", ptr: /\.(outlook|protection\.outlook|office365|hotmail|messaging\.microsoft)\.com$/, asn: /MICROSOFT/i, authDomain: /onmicrosoft\.com$|outlook\.com$/ },
  { name: "Amazon SES", ptr: /\.amazonses\.com$|\.smtp-out\.[a-z0-9-]+\.amazonses\.com$/, authDomain: /amazonses\.com$/ },
  { name: "SendGrid", ptr: /\.sendgrid\.net$/, authDomain: /sendgrid\.(net|info)$/ },
  { name: "Mailgun", ptr: /\.mailgun\.(net|org)$/, authDomain: /mailgun\.(org|net)$/ },
  { name: "Mailchimp / Mandrill", ptr: /\.(mcsv\.net|mcdlv\.net|rsgsv\.net|mandrillapp\.com)$/, authDomain: /(mcsv|mcdlv|rsgsv)\.net$|mandrillapp\.com$|mailchimpapp\.net$/ },
  { name: "SparkPost", ptr: /\.sparkpost(mail)?\.com$/, authDomain: /sparkpost(mail)?\.com$/ },
  { name: "Postmark", ptr: /\.mtasv\.net$/, authDomain: /mtasv\.net$|pm\.mtasv\.net$/ },
  { name: "Brevo (Sendinblue)", ptr: /\.(sendinblue\.com|brevo\.com|mailin\.fr|sender-sib\.com)$/, authDomain: /(sendinblue|brevo)\.com$|mailin\.fr$/ },
  { name: "Mailjet", ptr: /\.mailjet\.com$/, authDomain: /mailjet\.com$/ },
  { name: "Zoho", ptr: /\.zoho(mail)?\.(com|eu|in)$/, asn: /ZOHO/i, authDomain: /zoho(mail)?\.(com|eu|in)$/ },
  { name: "Salesforce", ptr: /\.(salesforce\.com|exacttarget\.com|mc\.salesforce\.com)$/, authDomain: /salesforce\.com$|exacttarget\.com$/ },
  { name: "HubSpot", ptr: /\.(hubspot\.com|hubspotemail\.net|hs-sites\.com)$/, authDomain: /hubspot(email)?\.(com|net)$/ },
  { name: "Zendesk", ptr: /\.zendesk\.com$/, authDomain: /zendesk\.com$/ },
  { name: "Freshworks", ptr: /\.(freshdesk|freshworks|freshemail)\.(com|io)$/, authDomain: /fresh(desk|works|email)\.(com|io)$/ },
  { name: "Constant Contact", ptr: /\.(constantcontact\.com|ctctcdn\.com)$/, authDomain: /constantcontact\.com$/ },
  { name: "Campaign Monitor", ptr: /\.(createsend\.com|cmail\d*\.com)$/, authDomain: /createsend\.com$|cmail\d*\.com$/ },
  { name: "Yahoo", ptr: /\.(yahoo\.com|yahoo\.net|yahoodns\.net)$/, asn: /YAHOO|OATH/i },
  { name: "Apple iCloud", ptr: /\.(icloud\.com|apple\.com|me\.com)$/, asn: /^APPLE/i },
  { name: "Proton", ptr: /\.(protonmail\.ch|proton\.me)$/, asn: /PROTON/i },
  { name: "Fastmail", ptr: /\.(messagingengine\.com|fastmail\.com)$/, authDomain: /messagingengine\.com$/ },
  { name: "GoDaddy", ptr: /\.(secureserver\.net|godaddy\.com)$/, asn: /GODADDY/i },
  { name: "OVHcloud", ptr: /\.(ovh\.net|ovh\.com|mail\.ovh\.net)$/, asn: /^OVH/i },
  { name: "Hostinger", ptr: /\.hostinger\.(com|io)$/, asn: /HOSTINGER/i },
  { name: "Cloudflare Email Routing", ptr: /\.cloudflare(-email)?\.(net|com)$/, authDomain: /cloudflare-email\.net$/ },
  { name: "Mimecast", ptr: /\.mimecast\.(com|co\.za)$/, asn: /MIMECAST/i },
  { name: "Proofpoint", ptr: /\.(pphosted\.com|ppe-hosted\.com)$/, asn: /PROOFPOINT/i },
  { name: "Barracuda", ptr: /\.barracudanetworks\.com$|\.cudamail\.com$/, asn: /BARRACUDA/i },
  { name: "Amazon AWS", asn: /^AMAZON/i },
  { name: "DigitalOcean", asn: /DIGITALOCEAN/i },
  { name: "Hetzner", asn: /HETZNER/i },
];

export function detectProvider(input: { ptr?: string | null; asName?: string | null; authDomains?: string[] }): string | null {
  const ptr = input.ptr?.toLowerCase().replace(/\.$/, "") ?? "";
  const auth = (input.authDomains ?? []).map((d) => d.toLowerCase());
  for (const rule of RULES) {
    if (rule.ptr && ptr && rule.ptr.test(ptr)) return rule.name;
    if (rule.authDomain && auth.some((d) => rule.authDomain!.test(d))) return rule.name;
  }
  for (const rule of RULES) {
    if (rule.asn && input.asName && rule.asn.test(input.asName)) return rule.name;
  }
  return null;
}
