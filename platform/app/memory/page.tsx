import Shell from "../../components/Shell";
import { Badge } from "../../components/ui";
import { admin, date } from "../../lib/supabase-admin";
import DispatchBox from "../../components/DispatchBox";
import TabbedPane, { type TabbedTab } from "../../components/TabbedPane";

export const dynamic = "force-dynamic";

// The memory window. Read-only view of the shared Brain. Phase 2 design audit:
// previously rendered every entity + every fact in one body scroll (17000px on
// mobile). Now uses the TabbedPane primitive so each kind has its own scroll
// owner with sticky rail on desktop and horizontal swipe-pills on mobile.
// Curation still runs in /api/cron/librarian; this view is presentation only.
const KIND_LABEL: Record<string, string> = {
  org_fact: "Org facts",
  owner_private: "Owner private",
  auto_fact: "Learned (auto)",
  brand_voice: "Brand voice",
};

export default async function Memory() {
  const db = admin();
  const [{ data: factRows }, { data: entRows }, { data: linkRows }, { data: runRows }] = await Promise.all([
    db.from("agent_memory").select("id,kind,title,content,status,review_note,topic,created_at").order("created_at", { ascending: false }).limit(500),
    db.from("memory_entities").select("id,type,name,summary").order("name", { ascending: true }).limit(300),
    db.from("memory_entity_links").select("entity_id").limit(2000),
    db.from("memory_curation_runs").select("*").order("started_at", { ascending: false }).limit(1),
  ]);
  const facts = (factRows || []) as any[];
  const entities = (entRows || []) as any[];
  const links = (linkRows || []) as any[];
  const lastRun = (runRows || [])[0] as any;

  const active = facts.filter((f) => f.status === "active");
  const review = facts.filter((f) => f.status === "needs_review");
  const superseded = facts.filter((f) => f.status === "superseded");
  const linkCount: Record<string, number> = {};
  for (const l of links) linkCount[l.entity_id] = (linkCount[l.entity_id] || 0) + 1;

  const byKind: Record<string, any[]> = {};
  for (const f of active) (byKind[f.kind] ||= []).push(f);
  const kinds = Object.keys(byKind).sort((a, b) => (byKind[b].length - byKind[a].length));

  const runSub = lastRun
    ? `last curated ${date(lastRun.started_at)} · ${lastRun.merged || 0} merged, ${lastRun.flagged || 0} flagged, ${lastRun.entities_upserted || 0} entities`
    : "not yet curated";

  // build the tab set. Review first (operator action). Then each kind. Then
  // entities. Counts shown on every tab so the operator sees scope before clicking.
  const tabs: TabbedTab[] = [];

  if (review.length > 0) {
    tabs.push({
      id: "review",
      label: "Needs review",
      count: review.length,
      hint: "contradictions to resolve",
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="muted" style={{ fontSize: 12.5 }}>
            The librarian found facts that contradict each other. It did not merge them. Tell Sasa the correct version to resolve.
          </div>
          {review.map((f) => (
            <div key={f.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
              <div className="strong" style={{ fontSize: 13.5 }}>{f.title || f.topic || "(untitled)"}</div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{f.content}</div>
              {f.review_note && <div style={{ fontSize: 12, marginTop: 6, color: "var(--warn, #b45309)" }}>Conflict: {f.review_note}</div>}
            </div>
          ))}
        </div>
      ),
    });
  }

  for (const kind of kinds) {
    const list = byKind[kind];
    tabs.push({
      id: `kind-${kind}`,
      label: KIND_LABEL[kind] || kind,
      count: list.length,
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {list.map((f: any) => (
            <div key={f.id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 10 }}>
              {f.title && <div className="strong" style={{ fontSize: 13, marginBottom: 2 }}>{f.title}</div>}
              <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{f.content}</div>
              {f.topic && <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>{f.topic}</div>}
            </div>
          ))}
        </div>
      ),
    });
  }

  tabs.push({
    id: "entities",
    label: "Entity graph",
    count: entities.length,
    hint: entities.length === 0 ? "built on next librarian run" : undefined,
    body: (
      entities.length === 0 ? (
        <div className="muted" style={{ fontSize: 12.5 }}>The librarian builds this on its next run.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {entities.map((e: any) => (
            <div key={e.id} className="between" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 6 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <span className="strong" style={{ fontSize: 12.5 }}>{e.name}</span>{" "}
                <Badge tone="blue">{e.type}</Badge>
                {e.summary && <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{e.summary}</div>}
              </div>
              <span className="muted" style={{ fontSize: 11.5, flexShrink: 0, marginLeft: 12 }}>{linkCount[e.id] || 0} facts</span>
            </div>
          ))}
        </div>
      )
    ),
  });

  if (superseded.length > 0) {
    tabs.push({
      id: "superseded",
      label: "Consolidated",
      count: superseded.length,
      hint: "retired by librarian",
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            These duplicates were merged into newer facts. Kept for audit, hidden from active recall.
          </div>
          {superseded.map((f) => (
            <div key={f.id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 6, opacity: .7 }}>
              <div style={{ fontSize: 12.5 }}>{f.title || f.topic || "(untitled)"}</div>
              <div className="faint" style={{ fontSize: 11.5 }}>{f.content}</div>
            </div>
          ))}
        </div>
      ),
    });
  }

  return (
    <Shell title="Memory" sub={`${active.length} active facts · ${entities.length} entities · ${runSub}`}>
      <DispatchBox />
      <TabbedPane tabs={tabs} initialId={review.length > 0 ? "review" : tabs[0]?.id} emptyHint="The Brain is empty. Tell Sasa something to remember." />
    </Shell>
  );
}
