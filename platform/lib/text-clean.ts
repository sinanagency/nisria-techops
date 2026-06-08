// stripDashes — render-time guard for the doctrine's "no em/en-dashes" rule.
// Apply to any text cell that originates from imported data (bank statements,
// donor exports, scraped reports) before passing it to render. Bracketed tokens
// like [STP] are preserved; only unicode em (—), en (–), and figure (‒) dashes
// are normalized to a single ASCII hyphen with surrounding spaces, matching the
// pattern documented in NISRIA-DESIGN-SYSTEM.md §6.5.
//
// Idempotent. Safe on null/undefined.
export function stripDashes(s: any): string {
  if (s == null) return "";
  return String(s).replace(/[—–‒]/g, " - ").replace(/ {2,}/g, " ");
}
