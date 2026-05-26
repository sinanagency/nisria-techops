import Shell from "../../components/Shell";
import { Card, Badge, statusTone } from "../../components/ui";
import GrantPeek from "../../components/GrantPeek";
import PrepareAllButton from "../../components/PrepareAllButton";
import AddGrantButton from "../../components/AddGrantButton";
import { admin, money, date } from "../../lib/supabase-admin";
import { prepareGrant, advanceStatus, pursueOpportunity, declineGrant } from "./actions";
import { Sparkles, ArrowRight, Compass, ExternalLink, Send, X } from "lucide-react";

export const dynamic = "force-dynamic";
// The "Prepare all ready" server action runs buildApplication (a long-form
// Claude generation, ~80s each) for a few grants, so this segment asks for the
// extended budget. The action itself caps the batch (idempotent + skip-prepared).
export const maxDuration = 300;

const COLUMNS: { key: string; label: string }[] = [
  { key: "researching", label: "Researching" },
  { key: "prepared", label: "Prepared · review" },
  { key: "submitted", label: "Submitted" },
  { key: "decided", label: "Won / Lost" },
];

// Where each grant lands, and the next move available from there. A grant the
// Grant agent has prepared sits in `review` (ready to submit). `drafting` is
// kept as a legacy/manual state and grouped into the same "Prepared" column.
function nextMove(status: string): { to: string; label: string } | null {
  switch ((status || "").toLowerCase()) {
    case "researching":
      return { to: "drafting", label: "Move to drafting" };
    case "drafting":
      return { to: "submitted", label: "Mark submitted" };
    case "review":
      return null; // review shows Submit + Decline (accept/decline) instead
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
      if (colKey === "prepared") return s === "review" || s === "drafting";
      return s === colKey;
    });

  return (
    <Shell
      title="Grants"
      sub={`${grants.length} applications · ${(opps || []).length} live opportunities from the hunter`}
      action={
        <span className="flex" style={{ gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <PrepareAllButton />
          <AddGrantButton />
        </span>
      }
    >
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
            <div className="faint" style={{ fontSize: 13 }}>Tap “Add grant” above to start the pipeline, or let the grant hunter pursue strong finds. The Grant agent then auto-prepares each one for your review.</div>
          </div>
        </Card>
      ) : (
        <>
        <div className="faint" style={{ fontSize: 12, marginBottom: 12 }}>
          The Grant agent auto-prepares the full application and parks it in <strong>Prepared · review</strong> — you just accept (Submit) or decline. Tap “Prepare all ready” to top up the queue now. Browser auto-submit into funder portals is the next phase.
        </div>
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
                  const s = (g.status || "").toLowerCase();
                  const submitted = s === "submitted";
                  const prepared = !!(g.notes && String(g.notes).trim());
                  // A grant the agent has prepared and parked for Nur's call.
                  const inReview = s === "review";
                  return (
                    <div className="card card-pad" key={g.id} style={{ padding: 16 }}>
                      <div className="between">
                        <strong style={{ fontSize: 14 }}>{g.funder}</strong>
                        <Badge tone={inReview ? "green" : statusTone(g.status)}>{inReview ? "ready" : g.status}</Badge>
                      </div>
                      {g.program && <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>{g.program}</div>}
                      <div className="flex" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                        {g.amount_requested != null && <Badge tone="teal">{money(g.amount_requested)}</Badge>}
                        {g.deadline && <Badge tone="gold">due {date(g.deadline)}</Badge>}
                        {g.amount_awarded != null && <Badge tone="green">won {money(g.amount_awarded)}</Badge>}
                      </div>

                      {/* Researching / drafting still need a package — manual
                          prepare stays available, but the agent auto-prepares
                          these into review on its own. */}
                      {["researching", "drafting"].includes(s) && (
                        <form action={prepareGrant} style={{ marginTop: 10 }}>
                          <input type="hidden" name="id" value={g.id} />
                          <button className="btn teal sm full" type="submit">
                            <Sparkles size={14} /> {prepared ? "Re-prepare with AI" : "Prepare application"}
                          </button>
                        </form>
                      )}

                      {/* Full prepared package — opens a centered peek modal. */}
                      {prepared && <GrantPeek g={g} />}

                      {/* Prepared · review = accept (Submit) or decline. The
                          one decision Nur actually makes. */}
                      {inReview && prepared && (
                        <div className="flex" style={{ gap: 6, marginTop: 10 }}>
                          <form action={advanceStatus} style={{ flex: 1 }}>
                            <input type="hidden" name="id" value={g.id} />
                            <input type="hidden" name="status" value="submitted" />
                            <button className="btn teal sm full" type="submit"><Send size={13} /> Submit</button>
                          </form>
                          <form action={declineGrant}>
                            <input type="hidden" name="id" value={g.id} />
                            <button className="btn ghost sm" type="submit" title="Set aside, do not pursue"><X size={13} /> Decline</button>
                          </form>
                        </div>
                      )}

                      {/* Pipeline advance for non-review states (drafting → submitted). */}
                      {mv && !inReview && (
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
        </>
      )}
    </Shell>
  );
}
