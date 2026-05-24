// The shared brain. Full-text retrieval now (tsv); upgrades to pgvector once an
// embedder is wired. Both agents and the asset library write here, so the AI
// grounds replies/posts in brand voice + past approved work + imported assets.
import { admin } from "./supabase-admin";

export type Memory = {
  kind: string;            // brand_voice | approved_reply | message | asset | decision | doc_chunk
  brand?: string | null;
  title?: string | null;
  content: string;
  metadata?: Record<string, any>;
  source_type?: string | null;
  source_id?: string | null;
};

export async function remember(m: Memory) {
  try {
    await admin().from("agent_memory").insert({ ...m, metadata: m.metadata || {} });
  } catch (err) {
    console.error("remember failed", err);
  }
}

// Retrieve grounding for a draft: always include brand voice, plus the closest
// past approved replies / notes matching the query.
export async function recall(query: string, opts: { kinds?: string[]; brand?: string | null; limit?: number } = {}) {
  const limit = opts.limit ?? 5;
  const db = admin();
  const out: any[] = [];

  // brand voice is always-on grounding
  try {
    let bv = db.from("agent_memory").select("kind,brand,title,content").eq("kind", "brand_voice").limit(3);
    if (opts.brand) bv = bv.eq("brand", opts.brand);
    const { data } = await bv;
    if (data) out.push(...data);
  } catch {}

  // closest matches by full-text
  const q = (query || "").trim().slice(0, 200);
  if (q) {
    try {
      let s = db.from("agent_memory").select("kind,brand,title,content").neq("kind", "brand_voice").limit(limit);
      if (opts.kinds?.length) s = s.in("kind", opts.kinds);
      const { data } = await s.textSearch("tsv", q, { type: "websearch" });
      if (data) out.push(...data);
    } catch {
      // textSearch can choke on odd input; fall back to recent
      const { data } = await db.from("agent_memory").select("kind,brand,title,content").neq("kind", "brand_voice").order("created_at", { ascending: false }).limit(limit);
      if (data) out.push(...data);
    }
  }
  return out;
}

export function groundingText(mem: any[]): string {
  if (!mem?.length) return "(no stored guidance yet)";
  return mem.map((m) => `[${m.kind}${m.brand ? "/" + m.brand : ""}] ${m.title ? m.title + ": " : ""}${m.content}`).join("\n\n");
}
