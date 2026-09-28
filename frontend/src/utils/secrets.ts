/**
 * K18 privacy check: looks for things that probably shouldn't reach Team Space.
 * A helper, not a guarantee: it can miss a secret and can flag something harmless.
 */

export type SecretKind = "credential" | "contact";

export interface SecretMatch {
  kind: SecretKind;
  /** What it looks like, in plain words ("API key", "Email address"). */
  label: string;
  /** The exact text found, used to remove it. */
  value: string;
  /** Safe to show on screen: credentials are masked. */
  display: string;
}

const CREDENTIALS: [string, RegExp][] = [
  ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g],
  ["API key", /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g],
  ["API key", /\bgsk_[A-Za-z0-9]{20,}/g],
  ["API key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["API key", /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/g],
  ["Access token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g],
  ["Access token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ["Access key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["Access token", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ["Password or secret", /\b(?:password|passwd|pwd|secret|api[_-]?key|token)\s*[:=]\s*["']?[^\s"']{6,}/gi],
];

const EMAIL = /[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// ponytail: a loose phone shape (10-15 digits); formats with fewer digits are missed. A bare
// run of digits only counts at exactly 10 (a mobile number); longer runs are ids and timestamps.
const PHONE = /\+?\d[\d\s().-]{8,}\d/g;

function mask(value: string): string {
  const flat = value.replace(/\s+/g, " ");
  if (flat.startsWith("-----BEGIN")) return flat.slice(0, flat.indexOf("KEY-----") + 8) + " …";
  return `${flat.slice(0, 4)}${"•".repeat(6)}${flat.length > 12 ? flat.slice(-2) : ""}`;
}

export function scanForSecrets(text: string): SecretMatch[] {
  const found = new Map<string, SecretMatch>();
  const add = (kind: SecretKind, label: string, value: string) => {
    // Overlapping matches count once; the more specific pattern (checked first) wins.
    if ([...found.keys()].some((v) => v.includes(value) || value.includes(v))) return;
    found.set(value, { kind, label, value, display: kind === "credential" ? mask(value) : value });
  };
  for (const [label, re] of CREDENTIALS) for (const m of text.matchAll(re)) add("credential", label, m[0]);
  for (const m of text.matchAll(EMAIL)) add("contact", "Email address", m[0]);
  for (const m of text.matchAll(PHONE)) {
    const digits = m[0].replace(/\D/g, "").length;
    const bare = /^\d+$/.test(m[0]);
    if (digits >= 10 && digits <= 15 && !(bare && digits !== 10) && !/^\d{4}-\d{2}-\d{2}/.test(m[0])) add("contact", "Phone number", m[0].trim());
  }
  return [...found.values()];
}

export function removeSecret(text: string, value: string): string {
  return text.split(value).join("[removed]");
}
