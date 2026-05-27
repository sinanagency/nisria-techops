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

let _tok: { token: string; exp: number } | null = null;

// OAuth2 access token via the JWT-bearer grant (RS256-signed assertion).
export async function driveToken(): Promise<string> {
  if (_tok && Date.now() < _tok.exp - 60_000) return _tok.token;
  const s = sa();
  if (!s) throw new Error("GOOGLE_SERVICE_ACCOUNT_B64 not configured");
  const now = Math.floor(Date.now() / 1000);
  const b64u = (o: any) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const claim = {
    iss: s.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
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
  _tok = { token: j.access_token, exp: now * 1000 + (j.expires_in || 3600) * 1000 };
  return j.access_token;
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
