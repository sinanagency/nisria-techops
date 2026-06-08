import Shell from "../../components/Shell";
import { Card, Badge } from "../../components/ui";
import { admin, date } from "../../lib/supabase-admin";
import BeneficiaryPeek from "../../components/BeneficiaryPeek";
import BeneficiaryIntake from "../../components/BeneficiaryIntake";
import CaseManage from "../../components/CaseManage";
import { approveCase, declineCase, setCaseStage, reopenCase } from "./actions";
import { formatPersonName } from "../../lib/names";
import { Lock, UserPlus, CheckCircle2, XCircle, Wallet, RotateCcw, Inbox, Users } from "lucide-react";

export const dynamic = "force-dynamic";

// The Cases board. A "case" is a potential person the team flagged who is not a
// beneficiary yet. They live on the beneficiaries table with intake_stage set, so
// the whole PII contract (RLS, private photos, consent gate) already covers them.
// Nur triages here: approve graduates a case into an active beneficiary, decline
// keeps the record as an audit trail. Open cases (under_review + pending_funds) are
// the one number that matters, so they lead.

const LANES: { key: string; label: string; sub: string; tone: any }[] = [
  { key: "prospect", label: "Prospect", sub: "Flagged, not yet assessed", tone: "peri" },
  { key: "under_review", label: "Under review", sub: "Being assessed now", tone: "teal" },
  { key: "pending_funds", label: "Pending funds", sub: "Waiting on funding to take on", tone: "gold" },
  { key: "declined", label: "Declined", sub: "Could not take on. Kept on record.", tone: "gray" },
];

// The funnel order, source to outcome. "Funded / converted" is the graduation
// stage: an approved case has its intake_stage cleared and becomes an active
// beneficiary, so it LEAVES this dataset. We therefore cannot count converted
// cases from these rows. We surface the live pipeline honestly and label the
// conversion figure as what it is: the share of decided cases that were not
// declined, among cases still visible here.
const STALE_DAYS = 10;

// Days since a case was logged (intake_date is the only creation timestamp on the
// row). Returns null when there is no date, so we never invent an age.
function ageDays(intakeDate: any): number | null {
  if (!intakeDate) return null;
  const d = new Date(intakeDate);
  if (isNaN(d.getTime())) return null;
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400e3);
  return days >= 0 ? days : null;
}

export default async function Cases() {
  const db = admin();
  const { data } = await db
    .from("beneficiaries")
    .select("*")
    .not("intake_stage", "is", null)
    .order("intake_date", { ascending: false, nullsFirst: false })
    .limit(500);

  const rows = (data || []) as any[];

  // resolve signed thumbnail URLs (private bucket) for cases that carry a photo
  const photoIds = [...new Set(rows.filter((r) => r.photo_asset_id).map((r) => r.photo_asset_id))];
  if (photoIds.length) {
    const { data: assets } = await db.from("assets").select("id,storage_path").in("id", photoIds);
    const pathById = new Map((assets || []).map((a: any) => [a.id, a.storage_path]));
    const paths = [...new Set([...pathById.values()].filter(Boolean))] as string[];
    if (paths.length) {
      const { data: signed } = await db.storage.from("assets").createSignedUrls(paths, 3600);
      const urlByPath = new Map((signed || []).map((s: any) => [s.path, s.signedUrl]));
      for (const r of rows) {
        const p = pathById.get(r.photo_asset_id);
        if (p) r._photoUrl = urlByPath.get(p) || null;
      }
    }
  }

  const byStage = (k: string) => rows.filter((r) => (r.intake_stage || "") === k);
  const openCount = byStage("under_review").length + byStage("pending_funds").length;
  // every other case, for the merge picker (fold a fragment into the right family)
  const allCases = rows.map((r) => ({ id: r.id as string, name: (r.full_name || r.ref_code || "case") as string }));

  // Detect likely FRAGMENTS: a bare single-name case whose name is listed as a
  // dependent of another case (from that case's family-phrase name or its
  // Dependents note). These are the ones the bot probably should have folded into a
  // family, so we flag them for Nur to merge, edit, or keep.
  const depToParent = new Map<string, string>();
  for (const r of rows) {
    const f = formatPersonName(r.full_name || "");
    const fromNote = (String(r.triage_notes || "").match(/Dependents:\s*(.*)/i)?.[1] || "").split(/\s*,\s*/);
    for (const d of [...f.dependents, ...fromNote]) {
      const k = String(d || "").trim().toLowerCase();
      if (k) depToParent.set(k, f.name || r.full_name || "");
    }
  }
  const fragmentParent = (r: any): string | null => {
    const nm = String(r.full_name || "").trim();
    if (!nm || /\s/.test(nm)) return null; // only bare single-name cases
    const p = depToParent.get(nm.toLowerCase());
    return p && p.toLowerCase() !== nm.toLowerCase() ? p : null;
  };

  // Funnel maths. Each visible stage is a step. "Decided" = declined (a terminal
  // outcome we can see). Approved/funded cases are no longer in this table, so the
  // honest conversion figure here is: of cases that reached a decision in-view,
  // what share were kept moving rather than declined. When nothing is decided yet
  // we omit the figure rather than divide by zero.
  const stageCounts: Record<string, number> = {};
  for (const lane of LANES) stageCounts[lane.key] = byStage(lane.key).length;
  const maxStage = Math.max(1, ...LANES.map((l) => stageCounts[l.key]));
  const declinedN = stageCounts["declined"] || 0;
  const stillMoving = (stageCounts["prospect"] || 0) + (stageCounts["under_review"] || 0) + (stageCounts["pending_funds"] || 0);
  const decidedN = declinedN + stillMoving;
  const keepRate = decidedN > 0 ? Math.round((stillMoving / decidedN) * 100) : null;

  const sub = (
    <span className="flex" style={{ gap: 6 }}>
      <Lock size={12} color="var(--faint)" /> Potential people, private to you and Nur. Not beneficiaries until you approve.
    </span>
  );

  return (
    <Shell title="Cases" sub={sub} action={<Badge tone="teal">{openCount} open</Badge>}>
      {/* CONVERSION FUNNEL. The pipeline at a glance: each stage as a proportional
          bar with its count, plus the kept-moving rate. ONE headline number still
          leads (cases waiting on you); the funnel is the shape behind it. */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="flex" style={{ alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: rows.length ? 18 : 0 }}>
          <div className="disp2" style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 40, lineHeight: 1, letterSpacing: "-0.02em" }}>
            {openCount}
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{openCount === 1 ? "case waiting on you" : "cases waiting on you"}</div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              {byStage("under_review").length} under review, {byStage("pending_funds").length} pending funds.
              {byStage("declined").length ? ` ${byStage("declined").length} declined on record.` : ""}
            </div>
          </div>
          {keepRate !== null && (
            <div className="stat" style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 26, lineHeight: 1 }}>{keepRate}%</div>
              <div className="faint" style={{ fontSize: 11 }}>kept moving, not declined</div>
            </div>
          )}
        </div>

        {rows.length > 0 && (
          <div className="case-funnel" style={{ display: "grid", gridTemplateColumns: `repeat(${LANES.length}, 1fr)`, gap: 12, alignItems: "end" }}>
            {LANES.map((lane) => {
              const n = stageCounts[lane.key];
              const h = Math.max(6, Math.round((n / maxStage) * 64));
              return (
                <div key={lane.key} className="flex" style={{ flexDirection: "column", alignItems: "center", gap: 7 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, lineHeight: 1 }}>{n}</div>
                  <div style={{ width: "100%", height: 64, display: "flex", alignItems: "flex-end" }}>
                    <span className="bar" style={{ height: h, maxWidth: "100%", background: `var(--${lane.tone === "gray" ? "muted" : lane.tone})`, opacity: lane.tone === "gray" ? 0.5 : 1 }} />
                  </div>
                  <div className="flex" style={{ gap: 6, alignItems: "center" }}>
                    <span className={`cohort-dot ${lane.tone}`} style={{ position: "static" }} />
                    <span className="faint" style={{ fontSize: 11, textAlign: "center" }}>{lane.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <Card title="No cases yet">
          <div className="stack" style={{ gap: 8, padding: "8px 2px" }}>
            <div className="flex" style={{ gap: 9, alignItems: "center" }}>
              <span className="aico teal" style={{ width: 34, height: 34, borderRadius: 10 }}><Inbox size={16} /></span>
              <div className="muted" style={{ fontSize: 13 }}>
                When the team flags someone in need, log them below or have Sasa catch them from the Rescue &amp; Rehab WhatsApp group. They land here for you to review, then approve or decline.
              </div>
            </div>
          </div>
        </Card>
      ) : (
        // Cohort board: four lane-cards SIDE BY SIDE on one row, fixed in
        // place. Inside each lane, cases lay out HORIZONTALLY and scroll
        // left/right. Same shape as /tasks. The cards remain visible at all
        // times; the operator swipes within a lane to see additional cases
        // in that stage.
        <div className="cboard">
          {LANES.map((lane) => {
            const items = byStage(lane.key);
            return (
              <div key={lane.key} className="card card-pad lanecol">
                <div className="flex" style={{ justifyContent: "space-between", alignItems: "center", flex: "0 0 auto" }}>
                  <div className="flex" style={{ gap: 8, alignItems: "center" }}>
                    <span className={`cohort-dot ${lane.tone}`} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{lane.label}</div>
                      <div className="faint" style={{ fontSize: 11 }}>{lane.sub}</div>
                    </div>
                  </div>
                  <Badge tone={lane.tone}>{items.length}</Badge>
                </div>

                <div className="lanestrip">
                {items.length === 0 && <div className="muted lanestrip-empty">Nothing here.</div>}

                {items.map((r) => {
                  const days = ageDays(r.intake_date);
                  const stale = days !== null && days > STALE_DAYS && lane.key !== "declined";
                  return (
                  <div key={r.id} className="lanecard case-card" style={{ background: "var(--surface-2)" }}>
                    <div className="flex" style={{ gap: 10, alignItems: "flex-start" }}>
                      {r._photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r._photoUrl} alt="" style={{ width: 42, height: 42, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
                      ) : (
                        <span className="aico gray" style={{ width: 42, height: 42, borderRadius: 10, flexShrink: 0 }}><Lock size={15} /></span>
                      )}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <BeneficiaryPeek b={r} />
                        <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>
                          {r.ref_code}
                          {r.referred_by ? ` · via ${r.referred_by}` : ""}
                          {r.intake_date ? ` · ${date(r.intake_date)}` : ""}
                        </div>
                        {/* owner/actor + age. There is no per-row owner field; the only
                            real actor signal stored on the case is who referred it.
                            Age is days since intake_date, red once it goes stale. */}
                        <div className="flex wrap" style={{ gap: 6, marginTop: 5 }}>
                          <span className="chip" style={{ fontSize: 10.5 }}>
                            <UserPlus size={9} /> {r.referred_by ? r.referred_by : "no referrer logged"}
                          </span>
                          <span
                            className="chip"
                            style={{ fontSize: 10.5, color: stale ? "var(--danger)" : undefined, fontWeight: stale ? 700 : undefined }}
                            title={stale ? `Stale: open more than ${STALE_DAYS} days` : undefined}
                          >
                            {days === null
                              ? "no date"
                              : days === 0
                              ? "today"
                              : `${days}d old`}
                          </span>
                          {fragmentParent(r) && (
                            <span className="chip" style={{ fontSize: 10.5, color: "var(--warning)", fontWeight: 700 }} title={`This looks like part of ${fragmentParent(r)}'s family. Merge it in, or ask Nur.`}>
                              <Users size={9} /> part of {fragmentParent(r)}?
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {(r.region || r.location || r.case_channel) && (
                      <div className="flex wrap" style={{ gap: 6 }}>
                        {(r.location || r.region) && (
                          <span className="chip" style={{ fontSize: 11 }}><Lock size={9} /> {r.location || r.region}</span>
                        )}
                        {r.case_channel && <span className="chip" style={{ fontSize: 11 }}>{r.case_channel}</span>}
                      </div>
                    )}

                    {r.needs && <div style={{ fontSize: 12.5, color: "var(--text)" }}>{r.needs}</div>}
                    {r.triage_notes && <div className="muted" style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{r.triage_notes}</div>}

                    {/* lifecycle actions. Real server actions, gated by an explicit click. */}
                    <div className="flex wrap" style={{ gap: 7, marginTop: 2 }}>
                      {lane.key !== "declined" ? (
                        <>
                          <form action={approveCase}>
                            <input type="hidden" name="id" value={r.id} />
                            <button type="submit" className="btn teal sm" title="Make them an active beneficiary">
                              <CheckCircle2 size={13} /> Approve
                            </button>
                          </form>
                          {lane.key === "under_review" ? (
                            <form action={setCaseStage}>
                              <input type="hidden" name="id" value={r.id} />
                              <input type="hidden" name="stage" value="pending_funds" />
                              <button type="submit" className="btn ghost sm" title="Waiting on funds">
                                <Wallet size={13} /> Pending funds
                              </button>
                            </form>
                          ) : (
                            <form action={setCaseStage}>
                              <input type="hidden" name="id" value={r.id} />
                              <input type="hidden" name="stage" value="under_review" />
                              <button type="submit" className="btn ghost sm" title={lane.key === "prospect" ? "Start assessing" : "Back to review"}>
                                <RotateCcw size={13} /> {lane.key === "prospect" ? "Start review" : "To review"}
                              </button>
                            </form>
                          )}
                          <form action={declineCase}>
                            <input type="hidden" name="id" value={r.id} />
                            <button type="submit" className="btn ghost sm" title="Cannot take on" style={{ color: "var(--danger)" }}>
                              <XCircle size={13} /> Decline
                            </button>
                          </form>
                        </>
                      ) : (
                        <form action={reopenCase}>
                          <input type="hidden" name="id" value={r.id} />
                          <button type="submit" className="btn ghost sm" title="Reopen for review">
                            <RotateCcw size={13} /> Reopen
                          </button>
                        </form>
                      )}
                      {/* owner controls: edit, merge into a family, or delete */}
                      <span style={{ marginLeft: "auto" }}>
                        <CaseManage
                          c={r}
                          others={allCases.filter((o) => o.id !== r.id)}
                          hint={fragmentParent(r) ? `looks like part of ${fragmentParent(r)}'s family, merge or keep separate?` : undefined}
                        />
                      </span>
                    </div>
                  </div>
                  );
                })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TOOL: log a new case with AI. Same gated extract-then-confirm flow as the
          beneficiary intake, in case mode. PII stays private. */}
      <div id="case-intake" style={{ marginTop: 16 }}>
        <BeneficiaryIntake mode="case" />
      </div>

      <div className="flex" style={{ gap: 7, marginTop: 12, fontSize: 12 }}>
        <UserPlus size={14} color="var(--faint)" />
        <span className="muted">Approve a case and it becomes an active beneficiary on the Beneficiaries page, keeping its photo and story.</span>
      </div>
    </Shell>
  );
}
