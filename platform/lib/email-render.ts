// Turn raw marketing-HTML emails into clean, readable text for the inbox.
// Server-side, no deps. We render as text (no XSS surface).
export function cleanEmail(raw: string): string {
  if (!raw) return "";
  let s = raw;
  const looksHtml = /<\/?[a-z][\s\S]*>/i.test(s);
  if (!looksHtml) return s.trim();
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|head|title|noscript)[\s\S]*?<\/\1>/gi, " ");
  // Marketing/MJML emails are often stored TRUNCATED, so a <style> (or head/script)
  // block has no closing tag — the matcher above misses it and the raw CSS (@media,
  // .mj-column{…}) leaks as visible text. Drop any unterminated block to end-of-string.
  s = s.replace(/<(style|script|head|noscript)\b[^>]*>[\s\S]*$/gi, " ");
  // Bare CSS that leaked without any <style> wrapper (rule blocks + @media/@font-face).
  s = s.replace(/@(media|font-face|import|keyframes)[\s\S]*?\}\s*\}/gi, " ");
  s = s.replace(/[.#]?[a-z0-9_-]+\s*\{[^{}]*\}/gi, " ");
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
  // strip a trailing truncated tag the generic stripper can't catch (no closing '>'), e.g. "</sty"
  s = s.replace(/<\/?[a-z][^>]*$/i, " ");
  // strip leftover long tracking URLs
  s = s.replace(/https?:\/\/\S{40,}/g, "");
  s = s.replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

export function snippet(raw: string, n = 90): string {
  return cleanEmail(raw).replace(/\s+/g, " ").slice(0, n);
}

// Is this sender a real person (show a profile, expect a reply) vs an automated
// system (notifications, billing, marketing blasts, mailing lists)?
//
// The upstream sender_type classifier lives OUTSIDE this repo (the Gmail sync), so
// it can be absent (null) or wrong. This module is therefore the authoritative
// safety net every surface routes through, never sender_type alone.
const AUTOMATED = /(no-?reply|do-?not-?reply|notify|notification|notifications|mailer|postmaster|accounts@|updates@|automated|team@|support@|service@|billing@|payments?@|receipts?@|news@|newsletter|marketing@|hello@|info(rmation)?@|@notify|@mail\d?\.|@em\.|@e\.|donotreply|paypal|stripe|givebutter|donorbox|railway|kuja|goodstack|charitynavigator|comments-noreply|calendar-notification|notifications\.google|via google)/i;

// Phrases that mark a machine-generated message even from a person-looking address:
// calendar invites, Drive share/comment notifications, automated reminders, blasts.
const AUTOMATED_CONTENT = /(has accepted this invitation|has declined this invitation|requests access to an item|added a comment to the following|replied to a comment in the following|new activity in the following document|this is your reminder|your weekly report|unsubscribe|view (?:this email|it) in your browser|complete profile|enrol for the session|update your (?:email )?preferences|you are receiving this (?:email|because))/i;

// The hard veto used by Workspace and the inbox: a machine / billing / marketing
// sender, OR a person-looking address whose content is clearly machine-generated.
export function isAutomatedSender(name?: string | null, email?: string | null, sample?: string | null): boolean {
  const who = `${name || ""} ${email || ""}`;
  if (AUTOMATED.test(who)) return true;
  if (sample && AUTOMATED_CONTENT.test(sample)) return true;
  return false;
}

export function isIndividual(email?: string | null, senderType?: string | null): boolean {
  if (senderType) return senderType === "individual";
  if (!email) return false;
  return !AUTOMATED.test(email);
}
