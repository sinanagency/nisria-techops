import Shell from "../../components/Shell";
import { Card, Badge } from "../../components/ui";
import GrantPeek from "../../components/GrantPeek";
import OpportunityView from "../../components/OpportunityView";
import PrepareAllButton from "../../components/PrepareAllButton";
import AddGrantButton from "../../components/AddGrantButton";
import { admin, money, date } from "../../lib/supabase-admin";
import { advanceStatus, declineGrant } from "./actions";
import { PursueButton } from "../../components/GrantQuickActions";
import { Compass, Send, X } from "lucide-react";

export const dynamic = "force-dynamic";
// The slow grant prepare (long-form Claude generation, ~80s each) no longer runs
// on this route. Clicks enqueue a background job and the worker at
// /api/grants/prepare does the work on its own request, so this page stays fast
// and navigation is never blocked. No extended budget needed here anymore.

const COLUMNS: { key: string; label: string }[] = [
  { key: "researching", label: "Researching" },
  { key: "prepared", label: "Prepared · review" },
  { key: "submitted", label: "Submitted" },
  { key: "decided", label: "Won / Lost" },
];

// One quiet accent rail per column state. Researching is automatic now, so it
// reads as "the agent is working on it" rather than "you must act".
function railClass(colKey: string, status: string): string {
  const s = (status || "").toLowerCase();
  if (s === "review") return "is-ready";
  if (s === "won") return "is-won";
  if (s === "lost") return "is-lost";
  if (colKey === "submitted") return "is-submitted";
  return "is-research";
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
          {/* horizontal row, not a tall stack (#36) */}
          <div className="gopps">
            {(opps || []).map((o: any) => {
              const tier = (o.relevance_tier || "").toLowerCase();
              return (
                <div key={o.id} className="gcard is-research">
                  <div className="gcard-top">
                    <div className="gcard-funder">{o.funder || o.title}</div>
                    <Badge tone={o.relevance_tier === "HIGH" ? "green" : o.relevance_tier === "MEDIUM" ? "gold" : "gray"}>{tier} · {Math.round((o.relevance_score || 0) * 100)}%</Badge>
                  </div>
                  {o.funder && o.title && o.funder !== o.title && <div className="gcard-prog">{o.title}</div>}
                  <div className="gcard-meta">
                    {(o.amount_floor || o.amount_ceiling) && <span className="gpill amt">{o.amount_floor ? money(o.amount_floor) : ""}{o.amount_ceiling ? `–${money(o.amount_ceiling)}` : "+"}</span>}
                    {o.close_date && <span className="gpill due">due {o.close_date}</span>}
                    {o.source && <span className="gtag">{o.source}</span>}
                  </div>
                  <div className="gcard-actions">
                    <PursueButton id={o.id} />
                    <OpportunityView o={o} />
                  </div>
                </div>
              );
            })}
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
            The Grant agent auto-prepares every application and parks it in <strong>Prepared · review</strong> — you just accept (Submit) or decline. Nothing to prepare by hand. Scroll the board left and right to see each stage.
          </div>
          {/* horizontal kanban: columns side by side, board scrolls left/right (#36) */}
          <div className="gboard">
            {COLUMNS.map((col) => {
              const list = inColumn(col.key);
              return (
                <div key={col.key} className="gcol">
                  <div className="gcol-head">
                    <span className="gcol-title">{col.label}</span>
                    <Badge tone="gray">{list.length}</Badge>
                  </div>
                  <div className="gcol-list">
                    {list.length === 0 && <div className="gcol-empty">Nothing here yet.</div>}
                    {list.map((g: any) => {
                      const s = (g.status || "").toLowerCase();
                      const submitted = s === "submitted";
                      const prepared = !!(g.notes && String(g.notes).trim());
                      const inReview = s === "review";
                      const drafting = s === "drafting";
                      return (
                        <div className={`gcard ${railClass(col.key, g.status)}`} key={g.id}>
                          <div className="gcard-top">
                            <div className="gcard-funder">{g.funder}</div>
                            <Badge tone={inReview ? "green" : col.key === "researching" ? "teal" : col.key === "submitted" ? "blue" : s === "won" ? "green" : s === "lost" ? "red" : "gray"}>
                              {inReview ? "ready" : col.key === "researching" ? "preparing" : g.status}
                            </Badge>
                          </div>
                          {g.program && <div className="gcard-prog">{g.program}</div>}
                          <div className="gcard-meta">
                            {g.amount_requested != null && <span className="gpill amt">{money(g.amount_requested)}</span>}
                            {g.deadline && <span className="gpill due">due {date(g.deadline)}</span>}
                            {g.amount_awarded != null && <span className="gpill amt">won {money(g.amount_awarded)}</span>}
                          </div>

                          {/* Researching is fully automatic now (#34): NO manual
                              "Prepare application" / "Move to drafting". The card
                              just shows the opportunity + a "preparing" status. */}

                          {/* Prepared package opens the centered focus sheet. */}
                          {prepared && <GrantPeek g={g} />}

                          {/* Prepared · review = the one decision Nur makes. */}
                          {inReview && prepared && (
                            <div className="gcard-actions">
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

                          {/* Legacy drafting cards (pre-automatic): one quiet
                              advance, no AI prep button. */}
                          {drafting && (
                            <div className="gcard-actions">
                              <form action={advanceStatus} style={{ flex: 1 }}>
                                <input type="hidden" name="id" value={g.id} />
                                <input type="hidden" name="status" value="submitted" />
                                <button className="pill" type="submit" style={{ width: "100%", justifyContent: "center" }}>Mark submitted</button>
                              </form>
                            </div>
                          )}

                          {submitted && (
                            <div className="gcard-actions">
                              <form action={advanceStatus} style={{ flex: 1 }}>
                                <input type="hidden" name="id" value={g.id} />
                                <input type="hidden" name="status" value="won" />
                                <button className="pill" type="submit" style={{ width: "100%", justifyContent: "center" }}>Mark won</button>
                              </form>
                              <form action={advanceStatus} style={{ flex: 1 }}>
                                <input type="hidden" name="id" value={g.id} />
                                <input type="hidden" name="status" value="lost" />
                                <button className="pill" type="submit" style={{ width: "100%", justifyContent: "center" }}>Mark lost</button>
                              </form>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Shell>
  );
}
