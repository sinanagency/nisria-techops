// The shared brain. Full-text retrieval now (tsv); upgrades to pgvector the day
// an embedder is wired (see lib/embedder.ts). Both agents and the asset library
// write here, so the AI grounds replies/posts in brand voice + past approved
// work + imported assets + the ORG'S OWN HISTORY (key events, losses, assets,
// people, programs captured in Settings onboarding).
import { admin } from "./supabase-admin";
import { embed, embedderConfigured, toVectorLiteral } from "./embedder";

export type Memory = {
  kind: string;            // brand_voice | org_fact | approved_reply | message | asset | decision | doc_chunk
  brand?: string | null;
  title?: string | null;
  content: string;
  metadata?: Record<string, any>;
  source_type?: string | null;
  source_id?: string | null;
};

// Kinds that describe WHO THE ORG IS — always relevant grounding, like brand
// voice. These are surfaced on every recall regardless of the caller's kind
// filter, so an agent drafting a donor reply still "knows" the org's history.
export const ORG_GROUNDING_KINDS = ["brand_voice", "org_fact"];

// Write a memory. Stores an embedding too WHEN an embedder is configured;
// otherwise embedding stays null and the row is found by full-text only. Either
// way the write succeeds — the embedder never gates remembering.
export async function remember(m: Memory) {
  try {
    let embedding: number[] | null = null;
    if (embedderConfigured()) {
      embedding = await embed(`${m.title || ""}\n${m.content}`);
    }
    const row: Record<string, any> = { ...m, metadata: m.metadata || {} };
    if (embedding) row.embedding = embedding; // pg accepts a number[] for vector
    await admin().from("agent_memory").insert(row);
  } catch (err) {
    console.error("remember failed", err);
  }
}

// Update (or insert) a SINGLETON memory row identified by a stable string slug
// (e.g. an onboarding section key), so a re-edit overwrites in place instead of
// piling up duplicate org facts. The slug lives in metadata.slug (NOT source_id,
// which is a uuid column). Returns the memory row id so org_profile can link to
// it. Re-embeds on change.
export async function rememberUpsert(
  m: Memory & { slug: string }
): Promise<string | null> {
  const db = admin();
  const { slug, ...mem } = m;
  try {
    let embedding: number[] | null = null;
    if (embedderConfigured()) {
      embedding = await embed(`${mem.title || ""}\n${mem.content}`);
    }
    const metadata = { ...(mem.metadata || {}), slug };
    const row: Record<string, any> = { ...mem, source_id: null, metadata };
    if (embedding) row.embedding = embedding;

    // find the existing singleton row for this slug
    const { data: existing } = await db
      .from("agent_memory")
      .select("id")
      .eq("kind", mem.kind)
      .eq("metadata->>slug", slug)
      .maybeSingle();

    if (existing?.id) {
      await db.from("agent_memory").update(row).eq("id", existing.id);
      return existing.id as string;
    }
    const { data: ins } = await db.from("agent_memory").insert(row).select("id").single();
    return (ins?.id as string) ?? null;
  } catch (err) {
    console.error("rememberUpsert failed", err);
    return null;
  }
}

// Retrieve grounding for a draft. Strategy:
//  1) ALWAYS include the org-grounding kinds (brand voice + org facts) so every
//     agent output is anchored in who Nisria is and what it has lived through.
//  2) Then the closest matches to the query:
//       - by VECTOR similarity when an embedder is configured (semantic), else
//       - by tsvector full-text (today's default), else recent rows.
export async function recall(
  query: string,
  opts: { kinds?: string[]; brand?: string | null; limit?: number } = {}
) {
  const limit = opts.limit ?? 5;
  const db = admin();
  const out: any[] = [];
  const seen = new Set<string>();
  const push = (rows: any[] | null | undefined) => {
    for (const r of rows || []) {
      const k = `${r.kind}|${r.title || ""}|${(r.content || "").slice(0, 60)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ kind: r.kind, brand: r.brand, title: r.title, content: r.content });
    }
  };

  // 1) org-defining grounding is always on (brand voice + org facts). Doctrine
  // (lib/CLAUDE.md rule 4): recall ALWAYS loads org_facts, even on the simplest
  // query. The query-relevance step below EXCLUDES these kinds, so this is the
  // ONLY path org_facts reach the agent. The cap therefore has to cover the whole
  // org-grounding set, not an arbitrary slice. Ordered oldest-first for a stable,
  // deterministic prompt. Revisit if org_facts ever outgrow this bound.
  try {
    let g = db
      .from("agent_memory")
      .select("kind,brand,title,content")
      .in("kind", ORG_GROUNDING_KINDS)
      .order("created_at", { ascending: true })
      .limit(50);
    if (opts.brand) g = g.or(`brand.eq.${opts.brand},brand.is.null`);
    const { data } = await g;
    push(data);
  } catch {}

  // 2) closest query matches (vector when embeddings exist, else full-text)
  const q = (query || "").trim().slice(0, 200);
  if (q) {
    let usedVector = false;
    if (embedderConfigured()) {
      const v = await embed(q);
      if (v) {
        try {
          const { data, error } = await db.rpc("match_memory", {
            query_embedding: toVectorLiteral(v) as any,
            match_count: limit,
            filter_kinds: opts.kinds?.length ? opts.kinds : null,
            exclude_kinds: ORG_GROUNDING_KINDS, // already added above
          });
          if (!error && data) {
            push(data);
            usedVector = true;
          }
        } catch {
          // vector path failed -> fall through to full-text
        }
      }
    }

    if (!usedVector) {
      try {
        let s = db
          .from("agent_memory")
          .select("kind,brand,title,content")
          .not("kind", "in", `(${ORG_GROUNDING_KINDS.join(",")})`)
          .limit(limit);
        if (opts.kinds?.length) s = s.in("kind", opts.kinds);
        const { data } = await s.textSearch("tsv", q, { type: "websearch" });
        push(data);
      } catch {
        // textSearch can choke on odd input; fall back to recent
        const { data } = await db
          .from("agent_memory")
          .select("kind,brand,title,content")
          .not("kind", "in", `(${ORG_GROUNDING_KINDS.join(",")})`)
          .order("created_at", { ascending: false })
          .limit(limit);
        push(data);
      }
    }
  }
  return out;
}

export function groundingText(mem: any[]): string {
  if (!mem?.length) return "(no stored guidance yet)";
  return mem
    .map((m) => `[${m.kind}${m.brand ? "/" + m.brand : ""}] ${m.title ? m.title + ": " : ""}${m.content}`)
    .join("\n\n");
}
