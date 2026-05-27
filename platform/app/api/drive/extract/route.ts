// Drive extraction worker (the watcher's engine + the manual trigger). Walks the
// configured Drive root folders, classifies every document, and upserts it into
// `documents` (idempotent on drive_file_id) so the Filing system mirrors the Drive.
// Skips pictures/videos for now (Nur). Metadata + classification only here; deep
// text/figure extraction is layered by the per-type passes. Bounded + safe to
// re-run (cron, button, or poke). Auth: agent/cron secret (middleware-bypassed).
import { NextRequest, NextResponse } from "next/server";
import { admin } from "../../../../lib/supabase-admin";
import { emit } from "../../../../lib/events";
import { listChildren, walkFolder, classifyDoc, categoryFor, brandFor, type DriveFile } from "../../../../lib/drive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function authed(req: NextRequest): boolean {
  const agent = process.env.AGENT_TICK_SECRET, cron = process.env.CRON_SECRET;
  const h = req.headers.get("x-agent-secret");
  const auth = req.headers.get("authorization") || "";
  const qs = new URL(req.url).searchParams.get("key");
  return Boolean((agent && (h === agent || qs === agent)) || (cron && auth === `Bearer ${cron}`));
}

const skip = (mime: string) => mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/");

async function run() {
  const roots = (process.env.DRIVE_ROOT_FOLDERS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!roots.length) return { error: "DRIVE_ROOT_FOLDERS not set" };
  const db = admin();
  const rows: any[] = [];
  const seen = new Set<string>();

  // legacy/loose folders (root "[NS]", "[NS] 2026", year folders) resolve to weak
  // categories; fall back to the document TYPE so nothing dumps into "General".
  const GENERIC = new Set(["General", "2026", "2025", "2024"]);
  const BY_TYPE: Record<string, string> = {
    registration: "Admin & Compliance", policy: "Admin & Compliance",
    grant: "Grants & Fundraising", budget: "Finance", expenses: "Finance",
    invoice: "Finance", receipt: "Finance", bank_statement: "Finance",
    contract: "Team & HR", database: "Programs", report: "Reports",
  };

  const file = (f: DriveFile, ctx: { top: string; parentName: string }) => {
    if (skip(f.mimeType) || seen.has(f.id)) return;
    seen.add(f.id);
    const docType = classifyDoc(f.name, f.mimeType);
    let category = categoryFor(ctx.top, ctx.parentName);
    if (GENERIC.has(category) || /^\[?ns\]?$/i.test(category) || category.length < 3) {
      category = BY_TYPE[docType] || category;
    }
    rows.push({
      drive_file_id: f.id,
      title: (f.name || "Untitled").slice(0, 300),
      folder: category,
      subfolder: ctx.parentName === ctx.top ? null : ctx.parentName.slice(0, 120),
      doc_type: docType,
      brand: brandFor(f.name, category),
      mime: f.mimeType,
      size_bytes: f.size ? Number(f.size) : null,
      drive_url: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
      modified_at: f.modifiedTime || null,
      source: "drive",
      updated_at: new Date().toISOString(),
    });
  };

  for (const root of roots) {
    const top = await listChildren(root);
    for (const c of top) {
      if (c.mimeType === "application/vnd.google-apps.folder") {
        // first-level folder name IS the area → category; recurse into it
        await walkFolder(c.id, c.name, file);
      } else {
        file(c, { top: "General", parentName: "General" });
      }
    }
  }

  // upsert in chunks (idempotent on drive_file_id)
  let filed = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await db.from("documents").upsert(chunk, { onConflict: "drive_file_id" });
    if (!error) filed += chunk.length;
  }

  const byCat: Record<string, number> = {};
  for (const r of rows) byCat[r.folder] = (byCat[r.folder] || 0) + 1;
  await emit({ type: "drive.extracted", source: "drive-watcher", actor: "system", payload: { filed, categories: byCat } });
  return { filed, total: rows.length, categories: byCat };
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await run());
}
export async function GET(req: NextRequest) {
  if (authed(req)) return NextResponse.json(await run());
  return NextResponse.json({ ok: true, note: "POST with x-agent-secret to extract the Drive into documents" });
}
