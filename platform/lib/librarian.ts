// The librarian: a daily background pass that keeps the shared brain healthy.
// It is a JOB, not a live agent, so it stays deterministic and off the critical
// path of every other agent's turn.
//
// Three responsibilities:
//  1) CONSOLIDATION. Cluster near-duplicate facts. High-confidence, non-conflicting
//     clusters are merged into ONE canonical row; the rest become status=superseded
//     (they stop grounding). This is the cure for the duplicate-drift that produced
//     four conflicting Dorcas-statement rows and three Kenya-name rows.
//  2) CONTRADICTION GUARD. When members of a cluster state DIFFERENT values for the
//     same attribute, the librarian does NOT merge. It flags them needs_review so a
//     human resolves the truth. A contradiction stops grounding until resolved,
//     which is safer than letting recall pick one at random.
//  3) ENTITY GRAPH. Extract the people, orgs, accounts and programs each fact is
//     about, and link them, so recall can answer "everything about Dorcas".
//
// recall() filters status='active', so superseded/needs_review rows leave grounding
// the moment the librarian touches them. One batched Claude call per run.
import { admin } from "./supabase-admin";
import { claudeJSON } from "./anthropic";
import { embed, embedderConfigured } from "./embedder";
import { OWNER_PRIVATE_KIND } from "./privacy";

const CURATABLE = ["org_fact", "auto_fact", OWNER_PRIVATE_KIND];

type Fact = { id: string; kind: string; topic: string | null; title: string | null; content: string };

type Cluster = {
  member_ids: string[];
  canonical_title: string;
  canonical_content: string;
  topic: string;
  confidence: "high" | "medium" | "low";
  conflict: boolean;
  conflict_note?: string;
};
type EntityOut = { fact_id: string; entities: { type: string; name: string; summary?: string }[] };

const SYS_CONSOLIDATE = `You are the librarian of an organisation's memory (the "brain"). You receive a JSON array of stored facts, each { id, kind, topic, title, content }. Your job is hygiene, not invention. Never use em-dashes or en-dashes, only commas, periods, colons.

Return ONLY a JSON object: { "clusters": [...] }.

Group facts that are about the SAME atomic thing (the same account, the same person's role, the same policy). For each cluster of 2+ facts:
- "member_ids": the ids in the cluster.
- "conflict": true if the members state DIFFERENT values for the same attribute (e.g. two different bank names for the same account, two different legal names, two different amounts). false if they are just duplicates or fragments of one consistent fact.
- If conflict is false: "canonical_content" = ONE clear sentence capturing the full merged fact (combine the non-overlapping details), "canonical_title" = a short label, "topic" = a stable slug like "bank-statements-stanbic". "confidence" = "high" only when you are certain they are the same fact.
- If conflict is true: still give "topic" and a "conflict_note" explaining what disagrees. Do NOT invent a canonical; a human will resolve it.
Only output clusters with 2+ members. Do not cluster facts that are genuinely about different things. Most facts are singletons and belong in no cluster.`;

const SYS_ENTITIES = `You extract entities from an organisation's stored facts. You receive a JSON array of facts, each { id, title, content }. Never use em-dashes or en-dashes.

Return ONLY a JSON object: { "entities": [...] }. For EVERY fact (by id), list the concrete entities it is about. For each entity: "type" (person | org | account | program | place | thing), "name" (the canonical name), optional "summary" (one short line of who/what). Skip vague references. Shape: [{ "fact_id": "...", "entities": [ { "type": "...", "name": "...", "summary": "..." } ] }]. Omit facts that mention no concrete entity.`;

async function findOrCreateEntity(db: any, type: string, name: string, summary?: string): Promise<string | null> {
  const clean = String(name || "").trim();
  if (!clean) return null;
  const t = String(type || "thing").trim().toLowerCase();
  const { data: existing } = await db
    .from("memory_entities")
    .select("id,summary")
    .eq("type", t)
    .ilike("name", clean)
    .maybeSingle();
  if (existing?.id) {
    if (summary && !existing.summary) await db.from("memory_entities").update({ summary, updated_at: new Date().toISOString() }).eq("id", existing.id);
    return existing.id as string;
  }
  const { data: ins } = await db.from("memory_entities").insert({ type: t, name: clean, summary: summary || null }).select("id").single();
  return (ins?.id as string) ?? null;
}

export async function runLibrarian(): Promise<{ ok: boolean; clusters: number; merged: number; flagged: number; entities: number; links: number; note?: string }> {
  const db = admin();
  const nowIso = new Date().toISOString();
  const { data: runRow } = await db.from("memory_curation_runs").insert({ started_at: nowIso }).select("id").single();
  const runId = runRow?.id as string | undefined;

  const { data: factRows } = await db
    .from("agent_memory")
    .select("id,kind,topic,title,content")
    .in("kind", CURATABLE)
    .eq("status", "active")
    .limit(500);
  const facts = (factRows || []) as Fact[];

  const finish = async (counts: any, note?: string) => {
    if (runId) await db.from("memory_curation_runs").update({ finished_at: new Date().toISOString(), ...counts, note }).eq("id", runId);
    return { ok: true, clusters: counts.clusters || 0, merged: counts.merged || 0, flagged: counts.flagged || 0, entities: counts.entities_upserted || 0, links: counts.links_made || 0, note };
  };

  if (facts.length < 2) return finish({}, "not enough facts to curate");

  // Phase 1: consolidation. All facts in one call so cross-row duplicates cluster.
  // Output is compact (only 2+ member clusters), so it does not truncate at scale.
  const consol = await claudeJSON<{ clusters: Cluster[] }>(SYS_CONSOLIDATE, JSON.stringify(facts.map((f) => ({ id: f.id, kind: f.kind, topic: f.topic, title: f.title, content: f.content }))), 4000);

  // Phase 2: entity extraction. Chunked (20 facts/call) so the large per-fact output
  // never hits the token cap, however big the brain grows.
  const entityOut: EntityOut[] = [];
  const CHUNK = 20;
  for (let i = 0; i < facts.length; i += CHUNK) {
    const batch = facts.slice(i, i + CHUNK).map((f) => ({ id: f.id, title: f.title, content: f.content }));
    const er = await claudeJSON<{ entities: EntityOut[] }>(SYS_ENTITIES, JSON.stringify(batch), 3000);
    if (er?.entities?.length) entityOut.push(...er.entities);
  }

  if (!consol && !entityOut.length) return finish({}, "librarian model call failed (no JSON / model unavailable)");

  const ids = new Set(facts.map((f) => f.id));
  let merged = 0, flagged = 0, clusters = 0, entitiesUpserted = 0, linksMade = 0;

  // --- consolidation + contradiction guard ---
  for (const cl of consol?.clusters || []) {
    const members = (cl.member_ids || []).filter((id) => ids.has(id));
    if (members.length < 2) continue;
    clusters++;
    if (cl.conflict) {
      // flag every member needs_review; do not merge contradictions
      await db.from("agent_memory").update({ status: "needs_review", review_note: cl.conflict_note || "conflicting values for the same fact", curated_at: nowIso, topic: cl.topic || null }).in("id", members);
      flagged += members.length;
      continue;
    }
    if (cl.confidence !== "high" || !cl.canonical_content) continue; // only auto-merge when certain
    const [canonicalId, ...rest] = members;
    const update: Record<string, any> = { content: cl.canonical_content, title: cl.canonical_title || null, topic: cl.topic || null, curated_at: nowIso, status: "active" };
    if (embedderConfigured()) {
      const v = await embed(`${cl.canonical_title || ""}\n${cl.canonical_content}`);
      if (v) update.embedding = v;
    }
    await db.from("agent_memory").update(update).eq("id", canonicalId);
    await db.from("agent_memory").update({ status: "superseded", superseded_by: canonicalId, curated_at: nowIso }).in("id", rest);
    merged += rest.length;
  }

  // --- entity graph ---
  for (const e of entityOut) {
    if (!ids.has(e.fact_id)) continue;
    for (const ent of e.entities || []) {
      const entId = await findOrCreateEntity(db, ent.type, ent.name, ent.summary);
      if (!entId) continue;
      entitiesUpserted++;
      // link (idempotent: PK on (memory_id, entity_id))
      const { error } = await db.from("memory_entity_links").upsert({ memory_id: e.fact_id, entity_id: entId }, { onConflict: "memory_id,entity_id", ignoreDuplicates: true });
      if (!error) linksMade++;
    }
  }

  return finish({ clusters, merged, flagged, entities_upserted: entitiesUpserted, links_made: linksMade });
}
