import Shell from "../../components/Shell";
import { Card, Badge, statusTone } from "../../components/ui";
import { admin, money, date } from "../../lib/supabase-admin";
import { addGrant, draftGrant, advanceStatus, pursueOpportunity } from "./actions";
import { Sparkles, ArrowRight, FilePlus2, Compass, ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";

const COLUMNS: { key: string; label: string }[] = [
  { key: "researching", label: "Researching" },
  { key: "drafting", label: "Drafting" },
  { key: "submitted", label: "Submitted" },
  { key: "decided", label: "Won / Lost" },
];

// Where each grant lands, and the next move available from there.
function nextMove(status: string): { to: string; label: string } | null {
  switch ((status || "").toLowerCase()) {
    case "researching":
      return { to: "drafting", label: "Move to drafting" };
    case "drafting":
      return { to: "submitted", label: "Mark submitted" };
    case "submitted":
      return null; // submitted shows Won + Lost buttons instead
    default:
      return null;
  }
}

export default async function Grants() {
  const db = admin();
  const [{ data }, { data: opps }] = await Promise.all([
    db.from("grant_applications").select("*").order("deadline", { ascending: true }).limit(300),
    db.from("grant_opportunities").select("*").eq("pursued", false).order("relevance_score", { ascending: false }).limit(12),
  ]);
  const grants: any[] = data || [];

  const inColumn = (colKey: string) =>
    grants.filter((g: any) => {
      const s = (g.status || "researching").toLowerCase();
      if (colKey === "decided") return s === "won" || s === "lost";
      return s === colKey;
    });

  return (
    <Shell title="Grants" sub={`${grants.length} applications · ${(opps || []).length} live opportunities from the hunter`}>
      {(opps || []).length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-h"><span className="flex"><Compass size={15} /> Opportunities · found by the grant hunter</span><Badge tone="teal">{(opps || []).length}</Badge></div>
          <div className="grid cols-3" style={{ padding: 16, gap: 14 }}>
            {(opps || []).map((o: any) => (
              <div key={o.id} className="card card-pad" style={{ boxShadow: "none", background: "var(--surface-2)", padding: 15 }}>
                <div className="between" style={{ marginBottom: 6 }}>
                  <Badge tone={o.relevance_tier === "HIGH" ? "green" : o.relevance_tier === "MEDIUM" ? "gold" : "gray"}>{(o.relevance_tier || "").toLowerCase()} · {Math.round((o.relevance_score || 0) * 100)}%</Badge>
                  <span className="faint" style={{ fontSize: 11 }}>{o.source}</span>
                </div>
                <div className="strong" style={{ fontSize: 13.5, lineHeight: 1.3 }}>{o.title}</div>
                {o.funder && <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{o.funder}</div>}
                <div className="flex wrap" style={{ gap: 6, marginTop: 8 }}>
                  {(o.amount_floor || o.amount_ceiling) && <Badge tone="teal">{o.amount_floor ? money(o.amount_floor) : ""}{o.amount_ceiling ? `–${money(o.amount_ceiling)}` : "+"}</Badge>}
                  {o.close_date && <Badge tone="gold">due {o.close_date}</Badge>}
                </div>
                <div className="flex" style={{ marginTop: 12, gap: 8 }}>
                  <form action={pursueOpportunity}><input type="hidden" name="id" value={o.id} /><button className="btn sm teal" type="submit">Pursue</button></form>
                  {o.url && <a className="pill" href={o.url} target="_blank" rel="noreferrer"><ExternalLink size={12} /> View</a>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {grants.length === 0 ? (
        <Card title="Grant pipeline">
          <div className="empty">
            <div style={{ marginBottom: 6 }}>No grant applications yet.</div>
            <div className="faint" style={{ fontSize: 13 }}>Add a funder below to start the pipeline, then draft the narrative with AI.</div>
          </div>
        </Card>
      ) : (
        <div className="grid cols-4">
          {COLUMNS.map((col) => {
            const list = inColumn(col.key);
            return (
              <div key={col.key} className="stack">
                <div className="between" style={{ alignItems: "center" }}>
                  <strong style={{ fontSize: 13.5, fontFamily: "var(--font-display)" }}>{col.label}</strong>
                  <Badge tone="gray">{list.length}</Badge>
                </div>
                {list.length === 0 && <div className="faint" style={{ fontSize: 12.5, padding: "8px 2px" }}>—</div>}
                {list.map((g: any) => {
                  const mv = nextMove(g.status);
                  const submitted = (g.status || "").toLowerCase() === "submitted";
                  return (
                    <div className="card card-pad" key={g.id} style={{ padding: 16 }}>
                      <div className="between">
                        <strong style={{ fontSize: 14 }}>{g.funder}</strong>
                        <Badge tone={statusTone(g.status)}>{g.status}</Badge>
                      </div>
                      {g.program && <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>{g.program}</div>}
                      <div className="flex" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                        {g.amount_requested != null && <Badge tone="teal">{money(g.amount_requested)}</Badge>}
                        {g.deadline && <Badge tone="gold">due {date(g.deadline)}</Badge>}
                        {g.amount_awarded != null && <Badge tone="green">won {money(g.amount_awarded)}</Badge>}
                      </div>

                      {/* Draft with AI — available while researching/drafting */}
                      {["researching", "drafting"].includes((g.status || "").toLowerCase()) && (
                        <form action={draftGrant} style={{ marginTop: 10 }}>
                          <input type="hidden" name="id" value={g.id} />
                          <button className="btn teal sm full" type="submit">
                            <Sparkles size={14} /> {g.notes ? "Redraft with AI" : "Draft with AI"}
                          </button>
                        </form>
                      )}

                      {g.notes && (
                        <details style={{ marginTop: 10 }}>
                          <summary className="faint" style={{ fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                            View AI draft
                          </summary>
                          <div
                            className="card-pad"
                            style={{ marginTop: 8, background: "var(--canvas)", borderRadius: 12, fontSize: 12.5, whiteSpace: "pre-wrap", lineHeight: 1.55 }}
                          >
                            {g.notes}
                          </div>
                        </details>
                      )}

                      {/* Pipeline advance */}
                      {mv && (
                        <form action={advanceStatus} style={{ marginTop: 10 }}>
                          <input type="hidden" name="id" value={g.id} />
                          <input type="hidden" name="status" value={mv.to} />
                          <button className="pill" type="submit">
                            {mv.label} <ArrowRight size={12} />
                          </button>
                        </form>
                      )}
                      {submitted && (
                        <div className="flex" style={{ gap: 6, marginTop: 10 }}>
                          <form action={advanceStatus}>
                            <input type="hidden" name="id" value={g.id} />
                            <input type="hidden" name="status" value="won" />
                            <button className="pill" type="submit">Mark won</button>
                          </form>
                          <form action={advanceStatus}>
                            <input type="hidden" name="id" value={g.id} />
                            <input type="hidden" name="status" value="lost" />
                            <button className="pill" type="submit">Mark lost</button>
                          </form>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 16, maxWidth: 520 }}>
        <Card title="Add a grant">
          <form action={addGrant} className="card-pad stack">
            <input name="funder" placeholder="Funder (e.g. Segal Family Foundation)" required />
            <input name="program" placeholder="Program / fund name" />
            <div className="flex" style={{ gap: 10 }}>
              <input name="amount_requested" placeholder="Amount (USD)" type="number" min="0" step="100" style={{ flex: 1 }} />
              <input name="deadline" placeholder="Deadline" type="date" style={{ flex: 1 }} />
            </div>
            <button className="btn" type="submit" style={{ alignSelf: "flex-start" }}>
              <FilePlus2 size={15} /> Add grant
            </button>
          </form>
        </Card>
      </div>
    </Shell>
  );
}
