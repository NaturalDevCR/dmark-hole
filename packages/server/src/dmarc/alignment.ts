import { getDomain } from "tldts";

/** Organizational domain per the Public Suffix List (RFC 7489 §3.2). */
export function orgDomain(domain: string): string {
  const d = domain.trim().toLowerCase().replace(/\.$/, "");
  return getDomain(d, { allowPrivateDomains: false }) ?? d;
}

export function isAligned(authDomain: string | undefined | null, headerFrom: string, mode: string | null | undefined): boolean {
  if (!authDomain || !headerFrom) return false;
  const a = authDomain.trim().toLowerCase().replace(/\.$/, "");
  const h = headerFrom.trim().toLowerCase().replace(/\.$/, "");
  if (mode === "s") return a === h;
  return orgDomain(a) === orgDomain(h);
}
