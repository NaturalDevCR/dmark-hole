import { readFileSync } from "node:fs";

export function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

export interface MiniReport {
  adkim?: string;
  aspf?: string;
  headerFrom?: string;
  dkimDomain?: string;
  dkimResult?: string;
  spfDomain?: string;
  spfResult?: string;
  dkimEval?: string;
  spfEval?: string;
}

/** Builds a one-record aggregate report; every field is overridable. */
export function miniReport(o: MiniReport = {}): string {
  const headerFrom = o.headerFrom ?? "example.com";
  const dkim = o.dkimDomain
    ? `<dkim><domain>${o.dkimDomain}</domain><result>${o.dkimResult ?? "pass"}</result><selector>s1</selector></dkim>`
    : "";
  const spf = o.spfDomain ? `<spf><domain>${o.spfDomain}</domain><result>${o.spfResult ?? "pass"}</result></spf>` : "";
  return `<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <org_name>example.net</org_name>
    <report_id>mini-1</report_id>
    <date_range><begin>1759276800</begin><end>1759363199</end></date_range>
  </report_metadata>
  <policy_published>
    <domain>${headerFrom}</domain>
    ${o.adkim ? `<adkim>${o.adkim}</adkim>` : ""}
    ${o.aspf ? `<aspf>${o.aspf}</aspf>` : ""}
    <p>none</p>
  </policy_published>
  <record>
    <row>
      <source_ip>192.0.2.1</source_ip>
      <count>1</count>
      <policy_evaluated>
        <disposition>none</disposition>
        <dkim>${o.dkimEval ?? "fail"}</dkim>
        <spf>${o.spfEval ?? "fail"}</spf>
      </policy_evaluated>
    </row>
    <identifiers><header_from>${headerFrom}</header_from></identifiers>
    <auth_results>${dkim}${spf}</auth_results>
  </record>
</feedback>`;
}
