// Read-only Gmail client for the sasa@nisria.co inbox. Same service account as
// lib/drive.ts (GOOGLE_SERVICE_ACCOUNT_B64), but domain-wide-delegated and
// impersonating sasa@nisria.co with the gmail.readonly scope (the same delegation
// the bank-statement extractor already uses). This lets Sasa answer "did the
// SANARA statements land in the inbox?" from chat. Read-only: list + read only,
// never send, never modify, never delete.
import crypto from "crypto";

const SUBJECT = "sasa@nisria.co";
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

type SA = { client_email: string; private_key: string };

function sa(): SA | null {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  if (!b64) return null;
  try {
    const j = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    return { client_email: j.client_email, private_key: j.private_key };
  } catch {
    return null;
  }
}

// One cached token per impersonation subject. The SA can DWD-impersonate any
// @nisria.co user with gmail.readonly; the cache is keyed by the subject so
// sasa@ and nur@ don't trample each other.
const _tokenCache: Record<string, { token: string; exp: number }> = {};

// Gmail-scoped access token via JWT-bearer. Defaults to sasa@nisria.co (the
// historical caller); pass `subject` to impersonate another @nisria.co user.
export async function gmailToken(subject: string = SUBJECT): Promise<string> {
  const cached = _tokenCache[subject];
  if (cached && Date.now() < cached.exp - 60_000) return cached.token;
  const s = sa();
  if (!s) throw new Error("GOOGLE_SERVICE_ACCOUNT_B64 not configured");
  const now = Math.floor(Date.now() / 1000);
  const b64u = (o: any) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const claim = { iss: s.client_email, sub: subject, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 };
  const input = `${b64u({ alg: "RS256", typ: "JWT" })}.${b64u(claim)}`;
  const sig = crypto.sign("RSA-SHA256", Buffer.from(input), s.private_key).toString("base64url");
  const jwt = `${input}.${sig}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    cache: "no-store",
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(j.error_description || j.error || "gmail token failed");
  _tokenCache[subject] = { token: j.access_token, exp: now * 1000 + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}

// Walk a Gmail message payload tree and decode the first text/html or text/plain
// body part to a UTF-8 string. Used by the Digital Nur sweep to pull meeting
// invites apart for URL + date extraction.
export function decodeMessageBody(payload: any): string {
  if (!payload) return "";
  const out: string[] = [];
  const decode = (data: string) => {
    try { return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); } catch { return ""; }
  };
  const walk = (p: any) => {
    if (!p) return;
    const mime = String(p.mimeType || "").toLowerCase();
    if (p.body?.data && (mime.startsWith("text/") || !mime)) {
      out.push(decode(p.body.data));
    }
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  return out.join("\n\n");
}

// Fetch full message (including body) for a given id, impersonating `subject`.
export async function fetchFullMessage(subject: string, id: string): Promise<{ headers: any[]; body: string; snippet: string }> {
  const tok = await gmailToken(subject);
  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
    { headers: { Authorization: `Bearer ${tok}` }, cache: "no-store" },
  );
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "gmail message fetch failed");
  return { headers: j.payload?.headers || [], body: decodeMessageBody(j.payload), snippet: j.snippet || "" };
}

// List recent messages for an impersonated subject. Same shape as searchInbox
// but parameterized.
export async function searchInboxFor(subject: string, query: string, max = 25): Promise<InboxHit[]> {
  const tok = await gmailToken(subject);
  const auth = { Authorization: `Bearer ${tok}` };
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${Math.min(Math.max(max, 1), 50)}`;
  const lr = await fetch(listUrl, { headers: auth, cache: "no-store" });
  const lj = await lr.json();
  if (lj.error) throw new Error(lj.error.message || "gmail list failed");
  const ids: string[] = (lj.messages || []).map((m: any) => m.id);
  const hits: InboxHit[] = [];
  for (const id of ids) {
    const mr = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: auth, cache: "no-store" },
    );
    const mj = await mr.json();
    if (mj.error) continue;
    const headers = mj.payload?.headers || [];
    hits.push({
      id,
      from: header(headers, "From"),
      subject: header(headers, "Subject"),
      date: header(headers, "Date"),
      snippet: mj.snippet || null,
      attachments: attachmentNames(mj.payload),
    });
  }
  return hits;
}

export type InboxHit = {
  id: string;
  from: string | null;
  subject: string | null;
  date: string | null;
  snippet: string | null;
  attachments: string[]; // filenames of any attachments
  mailbox?: string;       // which @nisria.co inbox this hit came from
};

// The inboxes the bot reads across. Defaults to the shared bot mailboxes; add
// more @nisria.co addresses via INBOX_MAILBOXES (comma-separated) with NO code
// change. All must be @nisria.co users the domain-wide-delegated service account
// can impersonate (verified live: sasa@ and bot@ both reachable, gmail.readonly).
export const INBOX_MAILBOXES: string[] = (process.env.INBOX_MAILBOXES || "sasa@nisria.co,bot@nisria.co")
  .split(",").map((s) => s.trim()).filter(Boolean);

// Search EVERY configured inbox and merge, newest first, each hit tagged with the
// mailbox it came from (so read_email can fetch the full body from the right one).
// Per-mailbox failures are skipped, never fatal: one dead mailbox cannot blind the rest.
export async function searchAllInboxes(query: string, max = 10): Promise<InboxHit[]> {
  const perBox = Math.min(Math.max(max, 1), 25);
  const all: InboxHit[] = [];
  for (const mb of INBOX_MAILBOXES) {
    try {
      const hits = await searchInboxFor(mb, query, perBox);
      for (const h of hits) all.push({ ...h, mailbox: mb });
    } catch (e: any) {
      console.error(`[gmail:searchAllInboxes] ${mb}: ${e?.message || e}`);
    }
  }
  const ts = (d: string | null) => { const t = d ? Date.parse(d) : NaN; return isNaN(t) ? 0 : t; };
  all.sort((a, b) => ts(b.date) - ts(a.date));
  return all.slice(0, max);
}

function header(headers: any[], name: string): string | null {
  const h = (headers || []).find((x) => String(x.name).toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

function attachmentNames(payload: any): string[] {
  const out: string[] = [];
  const walk = (p: any) => {
    if (!p) return;
    if (p.filename && p.filename.length) out.push(p.filename);
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  return out;
}

// Decode a Gmail base64url body part to UTF-8 text.
function b64urlDecode(d: string): string {
  try { return Buffer.from(String(d).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); }
  catch { return ""; }
}

// Pull a readable body out of a Gmail `format=full` payload: prefer text/plain,
// fall back to a stripped text/html. Walks multipart trees.
function extractGmailBody(payload: any): string {
  let plain = "", html = "";
  const walk = (p: any) => {
    if (!p) return;
    const mt = String(p.mimeType || "");
    if (mt === "text/plain" && p.body?.data) plain += b64urlDecode(p.body.data);
    else if (mt === "text/html" && p.body?.data) html += b64urlDecode(p.body.data);
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  if (plain.trim()) return plain.trim();
  if (html.trim()) {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  return "";
}

// Read ONE email's FULL body (so the bot can read it to Nur, not just a snippet).
// Returns null on error. `subject` selects the mailbox (defaults to sasa@).
export async function readEmail(id: string, subject?: string): Promise<{ id: string; from: string | null; subject: string | null; date: string | null; body: string } | null> {
  const tok = await gmailToken(subject);
  const auth = { Authorization: `Bearer ${tok}` };
  const mr = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: auth, cache: "no-store" });
  const mj = await mr.json();
  if (mj.error) return null;
  const headers = mj.payload?.headers || [];
  return { id, from: header(headers, "From"), subject: header(headers, "Subject"), date: header(headers, "Date"), body: extractGmailBody(mj.payload) };
}

// Search the sasa@ inbox with a Gmail query string (e.g. 'from:imbank subject:statement
// newer_than:30d'). Returns lightweight hits with from/subject/date/snippet/attachments.
export async function searchInbox(query: string, max = 10): Promise<InboxHit[]> {
  const tok = await gmailToken();
  const auth = { Authorization: `Bearer ${tok}` };
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${Math.min(Math.max(max, 1), 25)}`;
  const lr = await fetch(listUrl, { headers: auth, cache: "no-store" });
  const lj = await lr.json();
  if (lj.error) throw new Error(lj.error.message || "gmail list failed");
  const ids: string[] = (lj.messages || []).map((m: any) => m.id);
  const hits: InboxHit[] = [];
  for (const id of ids) {
    const mr = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: auth, cache: "no-store" }
    );
    const mj = await mr.json();
    if (mj.error) continue;
    const headers = mj.payload?.headers || [];
    hits.push({
      id,
      from: header(headers, "From"),
      subject: header(headers, "Subject"),
      date: header(headers, "Date"),
      snippet: mj.snippet || null,
      attachments: attachmentNames(mj.payload),
    });
  }
  return hits;
}
