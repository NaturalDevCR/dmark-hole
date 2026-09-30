import { describe, expect, it } from "vitest";
import { classify, looksLikeAggregate, parseAggregate, ReportParseError } from "../src/dmarc/aggregate.js";
import { isAligned, orgDomain } from "../src/dmarc/alignment.js";
import { fixture, miniReport } from "./helpers.js";

describe("google.xml", () => {
  const r = parseAggregate(fixture("google.xml"));

  it("parses metadata", () => {
    expect(r.orgName).toBe("google.com");
    expect(r.orgEmail).toBe("noreply-dmarc-support@google.com");
    expect(r.extraContact).toBe("https://support.google.com/a/answer/2466580");
    expect(r.reportId).toBe("13500954812349287491");
    expect(r.version).toBe("1.0");
    expect(r.begin).toBe(1759276800);
    expect(r.end).toBe(1759363199);
    expect(r.errors).toEqual([]);
  });

  it("parses published policy", () => {
    expect(r.policy).toEqual({
      domain: "example.com",
      adkim: "r",
      aspf: "r",
      p: "quarantine",
      sp: "quarantine",
      np: "reject",
      pct: 100,
      fo: null,
      testing: null,
    });
  });

  it("parses all records", () => {
    expect(r.records).toHaveLength(4);
    expect(r.records.map((x) => x.category)).toEqual(["pass", "forwarded", "fail", "misaligned"]);
    expect(r.records.reduce((n, x) => n + x.count, 0)).toBe(178);
  });

  it("full pass from own IP", () => {
    const rec = r.records[0]!;
    expect(rec).toMatchObject({
      sourceIp: "192.0.2.10",
      count: 120,
      disposition: "none",
      dkimEval: "pass",
      spfEval: "pass",
      dmarcPass: true,
      headerFrom: "example.com",
      envelopeFrom: null,
      envelopeTo: null,
      dkimAuthPass: true,
      spfAuthPass: true,
      dkimAligned: true,
      spfAligned: true,
      category: "pass",
      reasons: [],
    });
    expect(rec.dkim).toEqual([
      { domain: "example.com", selector: "google", result: "pass", humanResult: null, aligned: true },
    ]);
    expect(rec.spf).toEqual([{ domain: "example.com", scope: null, result: "pass", aligned: true }]);
  });

  it("forwarded: SPF fail for own domain, DKIM pass aligned", () => {
    const rec = r.records[1]!;
    expect(rec.sourceIp).toBe("198.51.100.7");
    expect(rec.dmarcPass).toBe(true);
    expect(rec.dkimAligned).toBe(true);
    expect(rec.spfAligned).toBe(false);
    expect(rec.spfAuthPass).toBe(false);
    expect(rec.spf[0]).toMatchObject({ domain: "example.com", result: "fail", aligned: false });
    expect(rec.category).toBe("forwarded");
  });

  it("spoofing: both fail, quarantined", () => {
    const rec = r.records[2]!;
    expect(rec.sourceIp).toBe("203.0.113.66");
    expect(rec.disposition).toBe("quarantine");
    expect(rec.dmarcPass).toBe(false);
    expect(rec.dkim).toEqual([]);
    expect(rec.spf).toEqual([{ domain: "bulk.example.net", scope: null, result: "fail", aligned: false }]);
    expect(rec.dkimAuthPass).toBe(false);
    expect(rec.spfAuthPass).toBe(false);
    expect(rec.category).toBe("fail");
  });

  it("third-party sender passes auth but is not aligned", () => {
    const rec = r.records[3]!;
    expect(rec.sourceIp).toBe("198.51.100.99");
    expect(rec.dmarcPass).toBe(false);
    expect(rec.dkimAuthPass).toBe(true);
    expect(rec.spfAuthPass).toBe(true);
    expect(rec.dkimAligned).toBe(false);
    expect(rec.spfAligned).toBe(false);
    expect(rec.dkim[0]).toMatchObject({ domain: "sendgrid.net", result: "pass", aligned: false });
    expect(rec.spf[0]).toMatchObject({ domain: "sendgrid.net", result: "pass", aligned: false });
    expect(rec.category).toBe("misaligned");
  });
});

describe("microsoft.xml (dmarc-2.0 namespace)", () => {
  const r = parseAggregate(fixture("microsoft.xml"));

  it("parses metadata with hex report_id", () => {
    expect(r.orgName).toBe("Outlook.com");
    expect(r.reportId).toBe("0a1b2c3d4e5f60718293a4b5c6d7e8f9");
    expect(typeof r.reportId).toBe("string");
    expect(r.begin).toBe(1759276800);
    expect(r.end).toBe(1759363200);
    expect(r.policy).toMatchObject({ domain: "example.com", p: "reject", sp: "reject", np: null, pct: 100, fo: "1", testing: null });
  });

  it("IPv6 passing record with envelope_to", () => {
    const rec = r.records[0]!;
    expect(rec.sourceIp).toBe("2001:db8::25");
    expect(rec.envelopeTo).toBe("outlook.com");
    expect(rec.envelopeFrom).toBe("example.com");
    expect(rec.dkim[0]).toMatchObject({ selector: "selector1", humanResult: "ok", aligned: true });
    expect(rec.spf[0]).toMatchObject({ scope: "mfrom", aligned: true });
    expect(rec.category).toBe("pass");
  });

  it("local_policy reason is preserved", () => {
    const rec = r.records[1]!;
    expect(r.records).toHaveLength(2);
    expect(rec.envelopeTo).toBe("contoso.example.net");
    expect(rec.reasons).toEqual([
      { type: "local_policy", comment: "arc=pass; overridden by enterprise.protection.outlook.com transport rule" },
    ]);
    expect(rec.disposition).toBe("none");
    expect(rec.dmarcPass).toBe(false);
    expect(rec.dkim[0]).toMatchObject({ result: "fail", humanResult: "body hash did not verify", aligned: false });
    expect(rec.spf[0]).toMatchObject({ result: "softfail", aligned: false });
    expect(rec.category).toBe("fail");
  });
});

describe("yahoo.xml", () => {
  it("handles multiple DKIM results and default alignment modes", () => {
    const r = parseAggregate(fixture("yahoo.xml"));
    expect(r.orgName).toBe("Yahoo");
    expect(r.version).toBeNull();
    expect(r.reportId).toBe("0012345678901234567890");
    expect(r.policy).toMatchObject({ adkim: "r", aspf: "r", p: "none", sp: null, np: null, pct: 100, testing: null });
    expect(r.records).toHaveLength(1);
    const rec = r.records[0]!;
    expect(rec.dkim).toHaveLength(2);
    expect(rec.dkim[0]).toMatchObject({ domain: "example.net", selector: "legacy", result: "fail", aligned: false });
    expect(rec.dkim[1]).toMatchObject({ domain: "example.com", selector: "s2025", result: "pass", aligned: true });
    expect(rec.dkimAligned).toBe(true);
    expect(rec.dkimAuthPass).toBe(true);
    expect(rec.category).toBe("pass");
  });

  it("tolerates a UTF-8 BOM prefix", () => {
    const r = parseAggregate("﻿" + fixture("yahoo.xml"));
    expect(r.reportId).toBe("0012345678901234567890");
    expect(r.records).toHaveLength(1);
  });
});

describe("dmarcbis.xml", () => {
  const r = parseAggregate(fixture("dmarcbis.xml"));

  it("parses DMARCbis policy fields and errors", () => {
    expect(r.version).toBe("2.0");
    expect(r.reportId).toBe("bis-2025-10-01-000042");
    expect(r.errors).toEqual([
      "Unable to fetch DMARC record for sub.example.com",
      "Rate limited while resolving _dmarc.example.org",
    ]);
    expect(r.policy).toEqual({
      domain: "example.com",
      adkim: "s",
      aspf: "r",
      p: "reject",
      sp: "quarantine",
      np: "reject",
      pct: null,
      fo: "1",
      testing: "n",
    });
  });

  it("classifies records", () => {
    expect(r.records).toHaveLength(2);
    expect(r.records[0]).toMatchObject({ sourceIp: "2001:db8:abcd::1", count: 25, envelopeTo: "example.net", category: "pass" });
  });

  it("mailing_list reason yields forwarded", () => {
    const rec = r.records[1]!;
    expect(rec.reasons).toEqual([{ type: "mailing_list", comment: null }]);
    expect(rec.dmarcPass).toBe(false);
    expect(rec.spfAuthPass).toBe(true);
    expect(rec.spfAligned).toBe(false);
    expect(rec.envelopeFrom).toBe("lists.example.org");
    expect(rec.category).toBe("forwarded");
  });
});

describe("namespace handling", () => {
  it("strips namespace prefixes", () => {
    const xml = fixture("microsoft.xml")
      .replace('<feedback xmlns="urn:ietf:params:xml:ns:dmarc-2.0">', '<d:feedback xmlns:d="urn:ietf:params:xml:ns:dmarc-2.0">')
      .replace("</feedback>", "</d:feedback>");
    expect(looksLikeAggregate(xml)).toBe(true);
    expect(parseAggregate(xml).records).toHaveLength(2);
  });
});

describe("alignment", () => {
  it("strict mode requires exact domain match", () => {
    const r = parseAggregate(miniReport({ adkim: "s", dkimDomain: "mail.example.com", headerFrom: "example.com" }));
    const rec = r.records[0]!;
    expect(r.policy.adkim).toBe("s");
    expect(rec.dkimAuthPass).toBe(true);
    expect(rec.dkimAligned).toBe(false);
    expect(rec.dkim[0]!.aligned).toBe(false);
    expect(rec.category).toBe("misaligned");
  });

  it("strict mode accepts exact match", () => {
    const r = parseAggregate(miniReport({ adkim: "s", dkimDomain: "example.com", dkimEval: "pass" }));
    expect(r.records[0]).toMatchObject({ dkimAligned: true, dmarcPass: true, category: "pass" });
  });

  it("strict SPF (aspf=s) applies to SPF only", () => {
    const r = parseAggregate(
      miniReport({ aspf: "s", spfDomain: "bounce.example.com", dkimDomain: "bounce.example.com", spfEval: "pass" }),
    );
    const rec = r.records[0]!;
    expect(rec.spfAligned).toBe(false);
    expect(rec.dkimAligned).toBe(true); // adkim defaults to relaxed
  });

  it("relaxed mode aligns subdomains", () => {
    const r = parseAggregate(miniReport({ dkimDomain: "mail.example.com", dkimEval: "pass" }));
    expect(r.policy.adkim).toBe("r");
    expect(r.records[0]).toMatchObject({ dkimAligned: true, category: "pass" });
  });

  it("relaxed mode aligns across a multi-label public suffix", () => {
    const r = parseAggregate(
      miniReport({ headerFrom: "example.co.uk", dkimDomain: "mail.example.co.uk", spfDomain: "bounce.example.co.uk" }),
    );
    expect(r.records[0]).toMatchObject({ dkimAligned: true, spfAligned: true });
  });

  it("does not align distinct registrants under the same public suffix", () => {
    const r = parseAggregate(miniReport({ headerFrom: "example.co.uk", dkimDomain: "evil.co.uk" }));
    expect(r.records[0]).toMatchObject({ dkimAuthPass: true, dkimAligned: false, category: "misaligned" });
  });

  it("failed auth results are never aligned", () => {
    const r = parseAggregate(miniReport({ dkimDomain: "example.com", dkimResult: "fail" }));
    expect(r.records[0]!.dkimAligned).toBe(false);
    expect(r.records[0]!.category).toBe("fail");
  });

  it("falls back to own alignment math when policy_evaluated is missing", () => {
    const xml = miniReport({ dkimDomain: "example.com" }).replace(/<dkim>fail<\/dkim>\s*<spf>fail<\/spf>/, "");
    expect(parseAggregate(xml).records[0]).toMatchObject({ dmarcPass: true, dkimEval: "none" });
  });

  it("helper functions", () => {
    expect(orgDomain("Mail.Example.CO.UK.")).toBe("example.co.uk");
    expect(orgDomain("a.b.example.com")).toBe("example.com");
    expect(isAligned("a.example.com", "example.com", "r")).toBe(true);
    expect(isAligned("a.example.com", "example.com", "s")).toBe(false);
    expect(isAligned("EXAMPLE.com.", "example.com", "s")).toBe(true);
    expect(isAligned(null, "example.com", "r")).toBe(false);
    expect(isAligned("example.com", "example.com", undefined)).toBe(true);
  });
});

describe("normalisation and classify", () => {
  it("drops records with zero count or no source IP", () => {
    const xml = miniReport().replace("<count>1</count>", "<count>0</count>");
    expect(parseAggregate(xml).records).toEqual([]);
  });

  it("maps hardfail to fail and lowercases values", () => {
    const xml = miniReport({ spfDomain: "EXAMPLE.com.", spfResult: "HardFail", dkimDomain: "Example.COM", dkimResult: "PASS" });
    const rec = parseAggregate(xml).records[0]!;
    expect(rec.spf[0]).toMatchObject({ domain: "example.com", result: "fail" });
    expect(rec.dkim[0]).toMatchObject({ domain: "example.com", result: "pass", aligned: true });
  });

  it("classify covers each category", () => {
    const base = {
      sourceIp: "192.0.2.1", count: 1, disposition: "none", dkimEval: "fail", spfEval: "fail", dmarcPass: false,
      reasons: [] as { type: string; comment: string | null }[], headerFrom: "example.com", envelopeFrom: null,
      envelopeTo: null, dkim: [], spf: [], dkimAuthPass: false, spfAuthPass: false, dkimAligned: false, spfAligned: false,
    };
    expect(classify(base)).toBe("fail");
    expect(classify({ ...base, spfAuthPass: true })).toBe("misaligned");
    expect(classify({ ...base, dmarcPass: true, dkimAligned: true, spfAligned: true })).toBe("pass");
    expect(classify({ ...base, reasons: [{ type: "forwarded", comment: null }] })).toBe("forwarded");
    expect(classify({ ...base, dmarcPass: true, dkimAligned: true, reasons: [{ type: "trusted_forwarder", comment: null }] })).toBe("forwarded");
  });

  it("looksLikeAggregate", () => {
    expect(looksLikeAggregate(fixture("google.xml"))).toBe(true);
    expect(looksLikeAggregate("<html><body/></html>")).toBe(false);
  });
});

describe("ReportParseError", () => {
  it("rejects garbage", () => {
    expect(() => parseAggregate("this is definitely not xml")).toThrow(ReportParseError);
    expect(() => parseAggregate("")).toThrow(ReportParseError);
    expect(() => parseAggregate("<feedback><unclosed></feedback>")).toThrow(ReportParseError);
  });

  it("rejects non-DMARC XML", () => {
    expect(() => parseAggregate("<?xml version='1.0'?><html><body>hi</body></html>")).toThrow(/Not a DMARC aggregate report/);
  });

  it("rejects a report without report_id", () => {
    const xml = fixture("google.xml").replace(/<report_id>.*<\/report_id>/, "");
    expect(() => parseAggregate(xml)).toThrow(ReportParseError);
    expect(() => parseAggregate(xml)).toThrow(/report_id/);
  });

  it("rejects a report without policy domain or date range", () => {
    expect(() => parseAggregate(fixture("google.xml").replace("<domain>example.com</domain>", ""))).toThrow(/domain/);
    expect(() => parseAggregate(fixture("google.xml").replace(/<begin>.*<\/begin>/, ""))).toThrow(/date_range/);
  });
});
