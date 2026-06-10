// The shared brain. Full-text retrieval now (tsv); upgrades to pgvector the day
// an embedder is wired (see lib/embedder.ts). Both agents and the asset library
// write here, so the AI grounds replies/posts in brand voice + past approved
// work + imported assets + the ORG'S OWN HISTORY (key events, losses, assets,
// people, programs captured in Settings onboarding).
import { admin } from "./supabase-admin";
import { embed, embedderConfigured, toVectorLiteral } from "./embedder";
import { OWNER_PRIVATE_KIND } from "./privacy";
import { isSandbox } from "./sandbox";

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
    const row: Record<string, any> = { ...m, metadata: m.metadata || {}, sandbox: isSandbox() };
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
    const sandbox = isSandbox();
    const metadata = { ...(mem.metadata || {}), slug };
    const row: Record<string, any> = { ...mem, source_id: null, metadata, sandbox };
    if (embedding) row.embedding = embedding;

    // find the existing singleton row for this slug — scoped to the current
    // sandbox lane so a harness re-run upserts its OWN row, never overwrites
    // the live production singleton for the same slug.
    const { data: existing } = await db
      .from("agent_memory")
      .select("id")
      .eq("kind", mem.kind)
      .eq("metadata->>slug", slug)
      .eq("sandbox", sandbox)
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
  opts: { kinds?: string[]; brand?: string | null; limit?: number; ownerView?: boolean } = {}
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

  // PRIVACY WALL (asymmetric). Taona's owner-private notes (kind owner_private)
  // are surfaced ONLY when the caller is the owner. For everyone else (Nur, the
  // group, donor comms) they are excluded from EVERY retrieval path below, so a
  // private note Taona told Sasa never grounds an answer Nur sees. The owner gets
  // them always-on, like org facts, so his own line stays grounded in them.
  const groundingKinds = opts.ownerView ? [...ORG_GROUNDING_KINDS, OWNER_PRIVATE_KIND] : ORG_GROUNDING_KINDS;
  const blockedKinds = opts.ownerView ? ORG_GROUNDING_KINDS : [...ORG_GROUNDING_KINDS, OWNER_PRIVATE_KIND];

  // 1) org-defining grounding is always on (brand voice + org facts). Doctrine
  // (lib/CLAUDE.md rule 4): recall ALWAYS loads org_facts, even on the simplest
  // query. The query-relevance step below EXCLUDES these kinds, so this is the
  // ONLY path org_facts reach the agent. The cap therefore has to cover the whole
  // org-grounding set, not an arbitrary slice. Ordered oldest-first for a stable,
  // deterministic prompt. Revisit if org_facts ever outgrow this bound.
  // Sandbox isolation: when SASA_SANDBOX_MODE=true the process reads its OWN
  // tagged rows so eval can test recall end-to-end; otherwise (production) we
  // exclude every sandbox row, regardless of status. Same filter applied to
  // both lexical and semantic arms below.
  const sandbox = isSandbox();
  try {
    let g = db
      .from("agent_memory")
      .select("kind,brand,title,content")
      .in("kind", groundingKinds)
      .eq("status", "active") // never ground in superseded/needs_review/archived facts (librarian lifecycle)
      .eq("sandbox", sandbox)
      .order("created_at", { ascending: true })
      .limit(50);
    if (opts.brand) g = g.or(`brand.eq.${opts.brand},brand.is.null`);
    const { data } = await g;
    push(data);
  } catch {}

  // 2) closest query matches: HYBRID retrieval (the memorae-class recall win).
  // We run the SEMANTIC arm (vector) and the LEXICAL arm (full-text) and fuse
  // them with Reciprocal Rank Fusion, instead of using full-text only as a
  // fallback. Why this matters: vectors are strong on paraphrase ("how do we
  // reach the lead tailor") but weak on exact tokens (a name, an EIN like
  // 92-2509133, a case number); full-text is the mirror image. Either arm alone
  // misses half of what a person means. Fusing both, then ranking by where a row
  // scores well across arms, is what makes recall feel precise instead of fuzzy.
  // The org grounding above is untouched (one-brain law); this only sharpens the
  // query arm. Fail-soft: any arm can be empty and the other still answers.
  const q = (query || "").trim().slice(0, 200);
  if (q) {
    const RRF_K = 60;          // standard RRF damping; larger = flatter rank weighting
    const pool = Math.max(limit * 2, 10); // pull a wider net per arm, fuse down to `limit`
    const arms: any[][] = [];

    // SEMANTIC arm (vector). Skipped cleanly if no embedder or it errors.
    if (embedderConfigured()) {
      const v = await embed(q);
      if (v) {
        try {
          const { data, error } = await db.rpc("match_memory", {
            query_embedding: toVectorLiteral(v) as any,
            match_count: pool,
            filter_kinds: opts.kinds?.length ? opts.kinds : null,
            exclude_kinds: blockedKinds, // org grounding (added above) + owner-private for non-owner
            include_sandbox: sandbox,   // mirror sandbox isolation into the RPC; default false in prod
          });
          if (!error && data?.length) arms.push(data);
        } catch { /* semantic arm down, lexical still answers */ }
      }
    }

    // LEXICAL arm (full-text tsv). On odd input it can throw, so recency stands in.
    try {
      let s = db
        .from("agent_memory")
        .select("kind,brand,title,content")
        .not("kind", "in", `(${blockedKinds.join(",")})`)
        .eq("status", "active")
        .eq("sandbox", sandbox)
        .limit(pool);
      if (opts.kinds?.length) s = s.in("kind", opts.kinds);
      const { data } = await s.textSearch("tsv", q, { type: "websearch" });
      if (data?.length) arms.push(data);
    } catch {
      try {
        let r = db
          .from("agent_memory")
          .select("kind,brand,title,content")
          .not("kind", "in", `(${blockedKinds.join(",")})`)
          .eq("sandbox", sandbox)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (opts.kinds?.length) r = r.in("kind", opts.kinds);
        const { data } = await r;
        if (data?.length) arms.push(data);
      } catch { /* nothing to add */ }
    }

    // FUSE: Reciprocal Rank Fusion. A row's score is the sum over arms of
    // 1/(k + rank). A row that ranks well in BOTH arms beats one that only spikes
    // in a single arm, which is exactly the precision we want. Then take top-`limit`
    // and hand them to push() (which dedupes against the org grounding above).
    const fuse = new Map<string, { row: any; score: number }>();
    for (const arm of arms) {
      arm.forEach((r: any, i: number) => {
        const key = `${r.kind}|${r.title || ""}|${(r.content || "").slice(0, 60)}`;
        const cur = fuse.get(key) || { row: r, score: 0 };
        cur.score += 1 / (RRF_K + i + 1);
        fuse.set(key, cur);
      });
    }
    const fused = [...fuse.values()].sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.row);
    push(fused);
  }
  return out;
}

// The query window: ask the brain directly. Combines hybrid recall() with the
// entity graph, so "what do we know about Dorcas" returns both the closest facts
// AND every active fact linked to the Dorcas entity. Read-only. Honors the same
// owner-private wall as recall (owner_private facts only when ownerView).
export async function queryMemory(
  query: string,
  opts: { ownerView?: boolean; limit?: number } = {}
): Promise<{ facts: any[]; entities: any[] }> {
  const db = admin();
  const facts = await recall(query, { limit: opts.limit ?? 8, ownerView: opts.ownerView });

  const entities: any[] = [];
  const q = (query || "").trim().slice(0, 80);
  if (q) {
    try {
      const sandbox = isSandbox();
      const { data: ents } = await db
        .from("memory_entities")
        .select("id,type,name,summary")
        .or(`name.ilike.%${q.replace(/[,%()*]/g, "")}%,aliases.cs.{${q.replace(/[,{}%]/g, "")}}`)
        .eq("sandbox", sandbox)
        .limit(3);
      for (const e of (ents || []) as any[]) {
        const { data: links } = await db
          .from("memory_entity_links")
          .select("agent_memory(kind,title,content,status)")
          .eq("entity_id", e.id)
          .limit(25);
        const linked = ((links || []) as any[])
          .map((l) => l.agent_memory)
          .filter((m) => m && m.status === "active")
          .filter((m) => opts.ownerView || m.kind !== OWNER_PRIVATE_KIND)
          .map((m) => ({ kind: m.kind, title: m.title, content: m.content }));
        entities.push({ type: e.type, name: e.name, summary: e.summary, facts: linked });
      }
    } catch { /* entity graph empty or query odd: facts alone still answer */ }
  }
  return { facts, entities };
}

export function groundingText(mem: any[]): string {
  if (!mem?.length) return "(no stored guidance yet)";
  return mem
    .map((m) => `[${m.kind}${m.brand ? "/" + m.brand : ""}] ${m.title ? m.title + ": " : ""}${m.content}`)
    .join("\n\n");
}
