import Shell from "../../components/Shell";
import { Card, Badge } from "../../components/ui";
import { Money } from "../../components/Money";
import GrantPeek from "../../components/GrantPeek";
import OpportunityView from "../../components/OpportunityView";
import PrepareAllButton from "../../components/PrepareAllButton";
import AddGrantButton from "../../components/AddGrantButton";
import { admin, money, date } from "../../lib/supabase-admin";
import { now } from "../../lib/now";
import { advanceStatus, declineGrant } from "./actions";
import { PursueButton } from "../../components/GrantQuickActions";
import FilterBar, { FilterField, Segment } from "../../components/FilterBar";
import { Compass, Send, X, Award, Layers, Search, Trophy } from "lucide-react";

export const dynamic = "force-dynamic";

// Stage values the agent actually writes to grant_applications.status. These are
// the only values worth exposing as a filter, since they are what the data holds
// (drafting/review collapse into "prepared" on the board but remain distinct
// statuses in the row). Each maps the omnibar to a real slice of the grants set.
const STATUS_OPTS: { v: string; label: string }[] = [
  { v: "researching", label: "Researching" },
  { v: "drafting", label: "Drafting" },
  { v: "review", label: "Prepared · review" },
  { v: "submitted", label: "Submitted" },
  { v: "won", label: "Won" },
  { v: "lost", label: "Lost" },
];

// R4-3: a grant whose deadline is in the PAST is dead. Do not surface it as
// actionable. `grant_applications.deadline` is a real date; a grant_opportunity
// `close_date` is free text (usually MM/DD/YYYY, sometimes blank). Parse both to
// a YYYY-MM-DD and compare to the server's today (from now()). A blank/unknown
// deadline is NOT treated as expired (we cannot prove it dead).
function toIsoDay(raw: any): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  // already ISO (YYYY-MM-DD…)
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // US text MM/DD/YYYY
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (us) return `${us[3]}-${String(us[1]).padStart(2, "0")}-${String(us[2]).padStart(2, "0")}`;
  return null;
}
function isExpired(raw: any, todayIso: string): boolean {
  const d = toIsoDay(raw);
  return d != null && d < todayIso; // strictly before today = past deadline
}

// Decode the HTML entities the grant feeds leave in titles/funders (e.g.
// &#8203; zero-width space, &amp;), and trim, so a card never renders blank or
// shows raw "&#8203;" (#162). A grant card always has at least a funder or a
// program; this guarantees a readable label.
function clean(s: any): string {
  return String(s || "")
    .replace(/&#8203;|&#x200b;/gi, "")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

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

export default async function Grants({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  // normalize incoming filter params (URL-driven, Law 10)
  const sp = searchParams || {};
  const one = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined)) || "";
  const q = one("q").trim();
  const statusFilter = one("status");
  const funderFilter = one("funder").trim();

  const db = admin();
  const [{ data }, { data: oppsRaw }, n] = await Promise.all([
    db.from("grant_applications").select("*").order("deadline", { ascending: true }).limit(300),
    db.from("grant_opportunities").select("*").eq("pursued", false).order("relevance_score", { ascending: false }).limit(40),
    now(),
  ]);
  const todayIso = n.today;
  const allGrants: any[] = data || [];

  // Apply the omnibar filters to the already-loaded set (small dataset, no new
  // query). Everything downstream (funnel header, active band, kanban) derives
  // from `grants`, so filtering here narrows all of them consistently while the
  // page structure stays intact.
  let grants: any[] = allGrants;
  if (statusFilter) grants = grants.filter((g: any) => (g.status || "researching").toLowerCase() === statusFilter);
  if (funderFilter) {
    const needle = funderFilter.toLowerCase();
    grants = grants.filter((g: any) => clean(g.funder).toLowerCase().includes(needle) || clean(g.program).toLowerCase().includes(needle));
  }
  if (q) {
    const needle = q.toLowerCase();
    grants = grants.filter((g: any) => clean(g.funder).toLowerCase().includes(needle) || clean(g.program).toLowerCase().includes(needle));
  }
  const isFiltered = !!(q || statusFilter || funderFilter);

  // R4-3: drop dead opportunities (close_date strictly before today) from the
  // feed so nothing expired is offered as actionable; keep the top 12 live ones.
  const opps: any[] = (oppsRaw || []).filter((o: any) => !isExpired(o.close_date, todayIso)).slice(0, 12);

  // Active grants = the real funding we hold right now (status won, with an
  // awarded amount). These are our live grants, not historical decisions, so
  // they get a band at the top instead of being buried in the Won/Lost column.
  const activeGrants = grants
    .filter((g: any) => (g.status || "").toLowerCase() === "won" && Number(g.amount_awarded || 0) > 0)
    .sort((a: any, b: any) => Number(b.amount_awarded || 0) - Number(a.amount_awarded || 0));
  const activeTotal = activeGrants.reduce((s: number, g: any) => s + Number(g.amount_awarded || 0), 0);
  const activeIds = new Set(activeGrants.map((g: any) => g.id));

  const inColumn = (colKey: string) =>
    grants.filter((g: any) => {
      const s = (g.status || "researching").toLowerCase();
      // R4-3: never show an expired grant in an ACTIONABLE column (researching /
      // prepared / submitted). Decided (won/lost) is history, so it may keep an
      // old deadline. An unknown (null) deadline is not treated as expired.
      if (colKey !== "decided" && isExpired(g.deadline, todayIso)) return false;
      // active grants live in the band at the top, not the decided column (one home each)
      if (colKey === "decided") return (s === "won" || s === "lost") && !activeIds.has(g.id);
      if (colKey === "prepared") return s === "review" || s === "drafting";
      return s === colKey;
    });

  // Pipeline summary (Law 5: lead with the number that matters). All derived
  // from the grants already fetched above, no new query. Stage buckets mirror
  // the status values the agent writes (researching / drafting / review =
  // in-progress; submitted = awaiting decision; won / lost = decided). Pipeline
  // VALUE is the requested funding still in play (everything not yet
  // won/lost/rejected), since that is the money the org is actively chasing.
  const stageOf = (g: any) => (g.status || "researching").toLowerCase();
  const isOpen = (s: string) => s !== "won" && s !== "lost" && s !== "rejected";
  const researchingCount = grants.filter((g: any) => stageOf(g) === "researching").length;
  const inProgressCount = grants.filter((g: any) => {
    const s = stageOf(g);
    return s === "drafting" || s === "review";
  }).length;
  const submittedCount = grants.filter((g: any) => stageOf(g) === "submitted").length;
  const wonGrants = grants.filter((g: any) => stageOf(g) === "won");
  const lostCount = grants.filter((g: any) => {
    const s = stageOf(g);
    return s === "lost" || s === "rejected";
  }).length;
  const wonCount = wonGrants.length;
  // funding requested that is still in play (not decided yet)
  const pipelineValue = grants
    .filter((g: any) => isOpen(stageOf(g)))
    .reduce((sum: number, g: any) => sum + Number(g.amount_requested || 0), 0);
  // funding actually secured (awarded on won grants)
  const wonValue = wonGrants.reduce((sum: number, g: any) => sum + Number(g.amount_awarded || 0), 0);
  const openCount = researchingCount + inProgressCount + submittedCount;

  // Uniform filter omnibar (Law 10). Fields map 1:1 to the querystring params
  // the server filters on above, so the chip builder is fully functional with
  // the existing data logic. Only fields that actually narrow the grants set are
  // exposed: stage (status) and funder/program (a real grant field).
  const filterFields: FilterField[] = [
    { key: "status", label: "Stage", type: "select", options: STATUS_OPTS },
    { key: "funder", label: "Funder", type: "text" },
  ];
  const filterSegments: Segment[] = [
    { label: "All", patch: { status: undefined }, on: !statusFilter },
    { label: "Researching", patch: { status: "researching" }, on: statusFilter === "researching" },
    { label: "Prepared", patch: { status: "review" }, on: statusFilter === "review" },
    { label: "Submitted", patch: { status: "submitted" }, on: statusFilter === "submitted" },
    { label: "Won", patch: { status: "won" }, on: statusFilter === "won" },
    { label: "Lost", patch: { status: "lost" }, on: statusFilter === "lost" },
  ];
  const filterValues: Record<string, string> = { q, status: statusFilter, funder: funderFilter };

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
      <FilterBar
        basePath="/grants"
        fields={filterFields}
        values={filterValues}
        segments={filterSegments}
        count={grants.length}
        searchKey="q"
        searchPlaceholder="Search funder or program…"
      />

      {/* PIPELINE SUMMARY (Law 5): lead with the number that matters. The
          headline is the funding value still in play; the funnel row below
          counts grants by stage. All values derive from the grants already
          fetched, no new query. */}
      {grants.length > 0 && (
        <>
          <div className="metric-hero">
            <div className="mh-row">
              <div style={{ minWidth: 0 }}>
                <div className="mh-label">Funding in pipeline · requested, not yet decided</div>
                <div className="mh-num disp2">
                  <Money amount={pipelineValue} currency="USD" />
                </div>
                <div className="mh-sub">
                  {openCount} grant{openCount === 1 ? "" : "s"} in play
                  {wonValue > 0 ? (
                    <> · <Money amount={wonValue} currency="USD" /> secured across {wonCount} won</>
                  ) : null}
                </div>
              </div>
              <div className="stack" style={{ gap: 6, minWidth: 200, flex: "1 1 220px", maxWidth: 360, textAlign: "right" }}>
                <div className="mh-label">Won to date</div>
                <div className="disp2" style={{ fontSize: 40, fontWeight: 700, lineHeight: 0.95, letterSpacing: "-0.03em" }}>
                  {wonCount}
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "#7df3f1" }}>
                  {lostCount > 0 ? `${lostCount} closed without award` : "no losses recorded"}
                </div>
              </div>
            </div>
          </div>

          {/* funnel: counts by stage, researching → submitted → won → lost */}
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
            <div className="card card-pad stat">
              <div className="label flex" style={{ gap: 6, alignItems: "center" }}><Search size={13} /> Researching</div>
              <div className="value disp2">{researchingCount}</div>
              <div className="delta">{inProgressCount > 0 ? `+${inProgressCount} preparing for review` : "agent sourcing"}</div>
            </div>
            <div className="card card-pad stat">
              <div className="label flex" style={{ gap: 6, alignItems: "center" }}><Send size={13} /> Submitted</div>
              <div className="value disp2">{submittedCount}</div>
              <div className="delta">awaiting decision</div>
            </div>
            <div className="card card-pad stat">
              <div className="label flex" style={{ gap: 6, alignItems: "center" }}><Trophy size={13} /> Won</div>
              <div className="value disp2">{wonCount}</div>
              <div className="delta up"><Money amount={wonValue} currency="USD" /> secured</div>
            </div>
            <div className="card card-pad stat">
              <div className="label flex" style={{ gap: 6, alignItems: "center" }}><X size={13} /> Lost</div>
              <div className="value disp2">{lostCount}</div>
              <div className="delta">closed without award</div>
            </div>
          </div>
        </>
      )}

      {activeGrants.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-h">
            <span className="flex"><Award size={15} /> Active grants · funding we hold now</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}><Money amount={activeTotal} currency="USD" /> committed</span>
          </div>
          <div className="agrant-grid">
            {activeGrants.map((g: any) => (
              <div key={g.id} className="agrant">
                <div className="between" style={{ alignItems: "flex-start", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="agrant-funder">{clean(g.funder)}</div>
                    {g.program && <div className="agrant-prog">{clean(g.program)}</div>}
                  </div>
                  <Badge tone="green">active</Badge>
                </div>
                <div className="between" style={{ marginTop: 12, alignItems: "flex-end" }}>
                  <div>
                    <Money amount={Number(g.amount_awarded)} currency={g.currency || "USD"} className="agrant-amt" />
                    <div className="faint" style={{ fontSize: 11 }}>committed{g.decision_on ? ` · awarded ${date(g.decision_on)}` : ""}</div>
                  </div>
                  <GrantPeek g={g} />
                </div>
              </div>
            ))}
          </div>
          <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.5, padding: "12px 22px", borderTop: "1px solid var(--line)" }}>
            These grants fund specific programmes (SANARA → Maisha vocational training; Smile Together Korea → School Uniforms). The money flows into Kenya operations and is tracked in Finance; we report against each programme rather than reconciling dollar-for-dollar.
          </div>
        </div>
      )}

      {(opps || []).length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-h"><span className="flex"><Compass size={15} /> Opportunities · found by the grant hunter</span><Badge tone="teal">{(opps || []).length}</Badge></div>
          {/* horizontal row, not a tall stack (#36) */}
          <div className="gopps">
            {(opps || []).map((o: any) => {
              const tier = (o.relevance_tier || "").toLowerCase();
              const oFunder = clean(o.funder);
              const oTitle = clean(o.title);
              const head = oFunder || oTitle || "Funding opportunity";
              const sub = oFunder && oTitle && oFunder !== oTitle ? oTitle : "";
              return (
                <div key={o.id} className="gcard is-research">
                  <div className="gcard-top">
                    <div className="gcard-funder">{head}</div>
                    <Badge tone={o.relevance_tier === "HIGH" ? "green" : o.relevance_tier === "MEDIUM" ? "gold" : "gray"}>{tier || "scored"} · {Math.round((o.relevance_score || 0) * 100)}%</Badge>
                  </div>
                  {sub && <div className="gcard-prog">{sub}</div>}
                  <div className="gcard-meta">
                    {(o.amount_floor || o.amount_ceiling) && <span className="gpill amt">{o.amount_floor ? money(o.amount_floor) : ""}{o.amount_ceiling ? `–${money(o.amount_ceiling)}` : "+"}</span>}
                    {o.close_date && <span className="gpill due">due {o.close_date}</span>}
                    {o.source && <span className="gtag">{o.source}</span>}
                  </div>
                  <div className="gcard-actions gcard-actions-foot">
                    <PursueButton id={o.id} />
                    <OpportunityView o={o} siblings={opps || []} />
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
            {isFiltered ? (
              <div>No grant applications match these filters.</div>
            ) : (
              <>
                <div style={{ marginBottom: 6 }}>No grant applications yet.</div>
                <div className="faint" style={{ fontSize: 13 }}>Tap “Add grant” above to start the pipeline, or let the grant hunter pursue strong finds. The Grant agent then auto-prepares each one for your review.</div>
              </>
            )}
          </div>
        </Card>
      ) : (
        <>
          <div className="faint" style={{ fontSize: 12, marginBottom: 12 }}>
            The Grant agent auto-prepares every application and parks it in <strong>Prepared · review</strong>. You just accept (Submit) or decline. Nothing to prepare by hand. Scroll the board left and right to see each stage.
          </div>
          {/* horizontal kanban: columns side by side, board scrolls left/right (#36) */}
          <div className="gboard">
            {COLUMNS.map((col) => {
              const list = inColumn(col.key);
              // siblings = the prepared grants in THIS column, so the Focus Tab's
              // prev/next arrows step through them without closing (P1).
              const preparedSiblings = list.filter((x: any) => !!(x.notes && String(x.notes).trim()));
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
                      const gFunder = clean(g.funder);
                      const gProgram = clean(g.program);
                      // a card always has at least one readable label (#162)
                      const head = gFunder || gProgram || "Grant application";
                      const sub = gFunder && gProgram && gFunder !== gProgram ? gProgram : "";
                      return (
                        <div className={`gcard ${railClass(col.key, g.status)}`} key={g.id}>
                          <div className="gcard-top">
                            <div className="gcard-funder">{head}</div>
                            <Badge tone={inReview ? "green" : col.key === "researching" ? "teal" : col.key === "submitted" ? "blue" : s === "won" ? "green" : s === "lost" ? "red" : "gray"}>
                              {inReview ? "ready" : col.key === "researching" ? "preparing" : g.status}
                            </Badge>
                          </div>
                          {sub && <div className="gcard-prog">{sub}</div>}
                          <div className="gcard-meta">
                            {g.amount_requested != null && <span className="gpill amt"><Money amount={g.amount_requested} currency={g.currency || "USD"} /></span>}
                            {g.deadline && <span className="gpill due">due {date(g.deadline)}</span>}
                            {g.amount_awarded != null && <span className="gpill amt">won <Money amount={g.amount_awarded} currency={g.currency || "USD"} /></span>}
                          </div>

                          {/* Researching is fully automatic now (#34): NO manual
                              "Prepare application" / "Move to drafting". The card
                              just shows the opportunity + a "preparing" status. */}

                          {/* Prepared package opens the canonical Focus Tab. */}
                          {prepared && <GrantPeek g={g} siblings={preparedSiblings} />}

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
