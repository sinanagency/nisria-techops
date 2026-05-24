// Turn raw marketing-HTML emails into clean, readable text for the inbox.
// Server-side, no deps. We render as text (no XSS surface).
export function cleanEmail(raw: string): string {
  if (!raw) return "";
  let s = raw;
  const looksHtml = /<\/?[a-z][\s\S]*>/i.test(s);
  if (!looksHtml) return s.trim();
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|head|title|noscript)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<!doctype[^>]*>/gi, " ");
  s = s.replace(/<\/(p|div|tr|table|h[1-6]|li|ul|ol|blockquote|section)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<li[^>]*>/gi, "\n• ");
  // keep link TEXT, drop bare-URL links + tracking junk
  s = s.replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, (_m, t) => {
    const txt = String(t).replace(/<[^>]+>/g, "").trim();
    return txt && !/^https?:\/\//i.test(txt) ? ` ${txt} ` : " ";
  });
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
       .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
       .replace(/&rsquo;/gi, "'").replace(/&ldquo;|&rdquo;/gi, '"').replace(/&mdash;/gi, "-")
       .replace(/&[a-z0-9#]+;/gi, " ");
  // strip leftover long tracking URLs
  s = s.replace(/https?:\/\/\S{40,}/g, "");
  s = s.replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

export function snippet(raw: string, n = 90): string {
  return cleanEmail(raw).replace(/\s+/g, " ").slice(0, n);
}

// Is this sender a real person (show a profile) vs an automated system?
const AUTOMATED = /(no-?reply|do-?not-?reply|notify|notification|mailer|accounts@|updates@|automated|team@|support@|@notify|@mail|@em\.|@e\.|donotreply)/i;
export function isIndividual(email?: string | null, senderType?: string | null): boolean {
  if (senderType) return senderType === "individual";
  if (!email) return false;
  return !AUTOMATED.test(email);
}
