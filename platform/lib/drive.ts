// Server-side Google Drive client using a service account (read-only). This is
// the engine for the Filing system + the durable watcher: the app reads the
// Nisria Drive on its own, independent of any chat session. Credential is the
// base64 of the service-account JSON in GOOGLE_SERVICE_ACCOUNT_B64; the two root
// folder ids are in DRIVE_ROOT_FOLDERS (comma-separated).
import crypto from "crypto";

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

const READONLY = "https://www.googleapis.com/auth/drive.readonly";
const READWRITE = "https://www.googleapis.com/auth/drive";

// Token cache keyed by scope + impersonated subject. Reads use the SA's own
// identity (no subject); an ownership transfer impersonates the current owner
// via domain-wide delegation (subject = owner@nisria.co) and needs READWRITE.
const _toks = new Map<string, { token: string; exp: number }>();

// Mint an OAuth2 access token via the JWT-bearer grant (RS256-signed assertion).
// When `subject` is set, the SA impersonates that Workspace user (domain-wide
// delegation must be configured for the requested scope in the admin console;
// otherwise Google returns unauthorized_client and we surface that honestly).
async function mintToken(scope: string, subject?: string): Promise<string> {
  const key = `${scope}|${subject || ""}`;
  const cached = _toks.get(key);
  if (cached && Date.now() < cached.exp - 60_000) return cached.token;
  const s = sa();
  if (!s) throw new Error("GOOGLE_SERVICE_ACCOUNT_B64 not configured");
  const now = Math.floor(Date.now() / 1000);
  const b64u = (o: any) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const claim: any = { iss: s.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 };
  if (subject) claim.sub = subject;
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
  if (!j.access_token) throw new Error(j.error_description || j.error || "drive token failed");
  _toks.set(key, { token: j.access_token, exp: now * 1000 + (j.expires_in || 3600) * 1000 });
  return j.access_token;
}

// OAuth2 access token for the read-only Drive engine (filing + watcher).
export async function driveToken(): Promise<string> {
  return mintToken(READONLY);
}

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  parentId?: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
};

const FOLDER_MIME = "application/vnd.google-apps.folder";
const PARAMS = "supportsAllDrives=true&includeItemsFromAllDrives=true";

// list direct children of a folder (paginates)
export async function listChildren(folderId: string): Promise<DriveFile[]> {
  const token = await driveToken();
  const out: DriveFile[] = [];
  let pageToken = "";
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)&pageSize=200&${PARAMS}${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const r = await fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message || "drive list failed");
    for (const f of j.files || []) out.push({ ...f, parentId: folderId });
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  return out;
}

// Recursively walk a folder. Calls onFile for every non-folder, carrying the
// top-level folder name (the Drive area, e.g. "02_Finance") and the immediate
// parent folder name. Bounded by maxDepth to avoid pathological trees.
export async function walkFolder(
  rootId: string,
  topLabel: string,
  onFile: (f: DriveFile, ctx: { top: string; parentName: string }) => Promise<void> | void,
  opts: { maxDepth?: number } = {},
): Promise<void> {
  const maxDepth = opts.maxDepth ?? 6;
  async function recur(folderId: string, parentName: string, depth: number) {
    if (depth > maxDepth) return;
    const children = await listChildren(folderId);
    for (const c of children) {
      if (c.mimeType === FOLDER_MIME) {
        await recur(c.id, c.name, depth + 1);
      } else {
        await onFile(c, { top: topLabel, parentName });
      }
    }
  }
  await recur(rootId, topLabel, 0);
}

// Native-Google docs must be EXPORTED; binary files are downloaded as-is.
const EXPORT_MAP: Record<string, string> = {
  "application/vnd.google-apps.document": "application/pdf",
  "application/vnd.google-apps.spreadsheet": "application/pdf",
  "application/vnd.google-apps.presentation": "application/pdf",
};

// Fetch a file's bytes for in-app preview. Returns the buffer + the content-type
// the browser should render. Google-native files are exported to PDF.
export async function fetchFileBytes(fileId: string, mimeType: string): Promise<{ buf: Buffer; contentType: string }> {
  const token = await driveToken();
  const exportTo = EXPORT_MAP[mimeType];
  const url = exportTo
    ? `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportTo)}`
    : `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&${PARAMS}`;
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!r.ok) throw new Error(`drive fetch ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return { buf, contentType: exportTo || mimeType };
}

// Export a Google-native file straight to text (Docs/Slides -> plain, Sheets -> CSV).
// Returns null for non-native types (the caller downloads raw bytes and parses).
const TEXT_EXPORT: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
};
export async function fetchFileText(fileId: string, mimeType: string): Promise<string | null> {
  const exportTo = TEXT_EXPORT[mimeType];
  if (!exportTo) return null;
  const token = await driveToken();
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportTo)}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!r.ok) return null;
  return await r.text();
}

// Classify a file into a document type from its name + mime (best-effort, never throws).
export function classifyDoc(name: string, mime: string): string {
  const n = (name || "").toLowerCase();
  if (/bank|statement|stanbic|i&m|mandate|bankbook/.test(n)) return "bank_statement";
  if (/invoice/.test(n)) return "invoice";
  if (/receipt|m-?pesa/.test(n)) return "receipt";
  if (/contract|agreement|mou/.test(n)) return "contract";
  if (/budget/.test(n)) return "budget";
  if (/expense|payroll/.test(n)) return "expenses";
  if (/registration|certificate|determination|kra|pin|constitution|incorporation/.test(n)) return "registration";
  if (/policy|policies|safeguard|child protection/.test(n)) return "policy";
  if (/concept note|proposal|grant|application|fellowship/.test(n)) return "grant";
  if (/report|audit|summary/.test(n)) return "report";
  if (/database|students|microfund|kwetu/.test(n)) return "database";
  if (/audit/.test(n)) return "report";
  if (mime.includes("spreadsheet") || /\.xlsx$/.test(n)) return "spreadsheet";
  if (mime.includes("presentation")) return "presentation";
  return "document";
}

// Map a top-level Drive folder label to a clean platform category.
export function categoryFor(top: string, parentName: string): string {
  const t = `${top} ${parentName}`.toLowerCase();
  if (/finance|expense|budget|payroll/.test(t)) return "Finance";
  if (/team|hr|staff|contract/.test(t)) return "Team & HR";
  if (/fundrais|grant|concept note|proposal|fellowship|donor/.test(t)) return "Grants & Fundraising";
  if (/admin|compliance|legal|registration|board|governance|insurance|policy|safeguard/.test(t)) return "Admin & Compliance";
  if (/maisha/.test(t)) return "Maisha";
  if (/ahadi/.test(t)) return "AHADI";
  if (/kepenzi/.test(t)) return "Kepenzi";
  if (/comm|marketing|social|content/.test(t)) return "Communications";
  if (/program|kwetu|education|health|food|school|sponsor|student|water|lfw|life from water/.test(t)) return "Programs";
  return top.replace(/^\d+[_\s-]*/, "").replace(/\[.*?\]/g, "").trim() || "General";
}

export function brandFor(name: string, category: string): string | null {
  const n = (name || "").toLowerCase();
  if (n.includes("maisha") || category === "Maisha") return "maisha";
  if (n.includes("ahadi") || category === "AHADI") return "ahadi";
  if (n.includes("kepenzi") || category === "Kepenzi") return "kepenzi";
  return "nisria";
}

export type DriveMatch = { id: string; name: string; mimeType: string; ownerEmail: string | null; webViewLink?: string };

// Find files/folders whose name contains a fragment, across the Nisria Drive.
// Returns owner email so an ownership transfer can impersonate the right owner.
export async function searchFiles(nameFragment: string, max = 8): Promise<DriveMatch[]> {
  const token = await driveToken();
  const safe = String(nameFragment).replace(/['\\]/g, " ").trim();
  const q = encodeURIComponent(`name contains '${safe}' and trashed=false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,owners(emailAddress),webViewLink)&pageSize=${max}&${PARAMS}`;
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "drive search failed");
  return ((j.files || []) as any[]).map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, ownerEmail: f.owners?.[0]?.emailAddress || null, webViewLink: f.webViewLink }));
}

export type TransferResult = { ok: boolean; error?: string; needsScope?: boolean };

// Transfer ownership of a file/folder to a new owner WITHIN the nisria.co
// Workspace. Google forbids cross-domain and external (personal Gmail) ownership
// transfer, so the caller must validate the target domain first. Impersonates the
// CURRENT owner via domain-wide delegation, which requires the read-write Drive
// scope to be enabled on the service account's DWD in the Workspace admin console.
// Until that scope is granted, the token mint or the API returns 401/403 and we
// flag needsScope=true so the caller reports it honestly (never a raw stack trace).
export async function transferOwnership(fileId: string, newOwnerEmail: string, currentOwnerEmail: string): Promise<TransferResult> {
  let token: string;
  try {
    token = await mintToken(READWRITE, currentOwnerEmail);
  } catch (e: any) {
    const msg = String(e?.message || e);
    return { ok: false, error: msg, needsScope: /unauthorized_client|access_denied|scope|invalid_grant/i.test(msg) };
  }
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?transferOwnership=true&supportsAllDrives=true&sendNotificationEmail=false`;
  const r = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ role: "owner", type: "user", emailAddress: newOwnerEmail }),
    cache: "no-store",
  });
  if (r.ok) return { ok: true };
  const j = await r.json().catch(() => ({} as any));
  const msg = j?.error?.message || `transfer failed (${r.status})`;
  const needsScope = r.status === 401 || r.status === 403 || /insufficient|scope|permission|delegat|consent/i.test(msg);
  return { ok: false, error: msg, needsScope };
}
