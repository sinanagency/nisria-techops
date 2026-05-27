import { NextRequest, NextResponse } from "next/server";
import { admin } from "../../../../lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Spotlight document search: match a query against title + extracted text across
// every document, return the top hits with a snippet so the ⌘K palette can jump
// straight into the native reader. Session-gated by middleware.
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const db = admin();
  const { data } = await db
    .from("documents")
    .select("id,title,folder,doc_type,extracted_text")
    .or(`title.ilike.${like},extracted_text.ilike.${like}`)
    .limit(8);
  const needle = q.toLowerCase();
  const results = (data || []).map((d: any) => {
    const txt = d.extracted_text || "";
    const i = txt.toLowerCase().indexOf(needle);
    const snippet = i >= 0 ? ((i > 50 ? "…" : "") + txt.slice(Math.max(0, i - 50), i + 110).replace(/\s+/g, " ").trim() + "…") : "";
    return { id: d.id, title: (d.title || "").replace(/^\[NS\]\s*/, "").replace(/\.(pdf|docx?|doc|xlsx?)$/i, ""), folder: d.folder, inBody: i >= 0, snippet };
  });
  return NextResponse.json({ results });
}
