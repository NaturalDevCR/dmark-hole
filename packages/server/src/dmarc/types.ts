export type Category = "pass" | "forwarded" | "misaligned" | "fail";

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

export interface AggregateRecord {
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
  dkimAuthPass: boolean;
  spfAuthPass: boolean;
  dkimAligned: boolean;
  spfAligned: boolean;
  category: Category;
}

export interface AggregateReport {
  version: string | null;
  orgName: string;
  orgEmail: string | null;
  extraContact: string | null;
  reportId: string;
  begin: number;
  end: number;
  errors: string[];
  policy: {
    domain: string;
    adkim: string | null;
    aspf: string | null;
    p: string | null;
    sp: string | null;
    np: string | null;
    pct: number | null;
    fo: string | null;
    testing: string | null;
  };
  records: AggregateRecord[];
}

export interface ForensicReport {
  reporter: string | null;
  feedbackType: string | null;
  authFailure: string | null;
  deliveryResult: string | null;
  reportedDomain: string | null;
  sourceIp: string | null;
  arrivalTs: number | null;
  originalMailFrom: string | null;
  originalRcptTo: string | null;
  dkimDomain: string | null;
  dkimSelector: string | null;
  spfDns: string | null;
  subject: string | null;
  messageId: string | null;
  headerFrom: string | null;
  headers: string | null;
}

export type ExtractedDocument =
  | { kind: "aggregate"; xml: string; name: string }
  | { kind: "forensic"; report: ForensicReport; raw: string; name: string };
