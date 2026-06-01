import Shell from "../../components/Shell";
import { Card, Badge } from "../../components/ui";
import { admin, date } from "../../lib/supabase-admin";
import BeneficiaryPeek from "../../components/BeneficiaryPeek";
import BeneficiaryIntake from "../../components/BeneficiaryIntake";
import { approveCase, declineCase, setCaseStage, reopenCase } from "./actions";
import { Lock, UserPlus, CheckCircle2, XCircle, Wallet, RotateCcw, Inbox } from "lucide-react";

export const dynamic = "force-dynamic";

// The Cases board. A "case" is a potential person the team flagged who is not a
// beneficiary yet. They live on the beneficiaries table with intake_stage set, so
// the whole PII contract (RLS, private photos, consent gate) already covers them.
// Nur triages here: approve graduates a case into an active beneficiary, decline
// keeps the record as an audit trail. Open cases (under_review + pending_funds) are
// the one number that matters, so they lead.

const LANES: { key: string; label: string; sub: string; tone: any }[] = [
  { key: "under_review", label: "Under review", sub: "Being assessed now", tone: "teal" },
  { key: "pending_funds", label: "Pending funds", sub: "Waiting on funding to take on", tone: "gold" },
  { key: "declined", label: "Declined", sub: "Could not take on. Kept on record.", tone: "gray" },
];

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

  const sub = (
    <span className="flex" style={{ gap: 6 }}>
      <Lock size={12} color="var(--faint)" /> Potential people, private to you and Nur. Not beneficiaries until you approve.
    </span>
  );

  return (
    <Shell title="Cases" sub={sub} action={<Badge tone="teal">{openCount} open</Badge>}>
      {/* ONE headline: how many cases are waiting on a decision. Everything else
          is a drill-down from here. */}
      <div className="card card-pad" style={{ marginBottom: 16, display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 40, lineHeight: 1, letterSpacing: "-0.02em" }}>
          {openCount}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{openCount === 1 ? "case waiting on you" : "cases waiting on you"}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {byStage("under_review").length} under review, {byStage("pending_funds").length} pending funds.
            {byStage("declined").length ? ` ${byStage("declined").length} declined on record.` : ""}
          </div>
        </div>
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
        <div className="cases-board" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, alignItems: "start" }}>
          {LANES.map((lane) => {
            const items = byStage(lane.key);
            return (
              <div key={lane.key} className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="flex" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <div className="flex" style={{ gap: 8, alignItems: "center" }}>
                    <span className={`cohort-dot ${lane.tone}`} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{lane.label}</div>
                      <div className="faint" style={{ fontSize: 11 }}>{lane.sub}</div>
                    </div>
                  </div>
                  <Badge tone={lane.tone}>{items.length}</Badge>
                </div>

                {items.length === 0 && <div className="faint" style={{ fontSize: 12, padding: "6px 2px" }}>Nothing here.</div>}

                {items.map((r) => (
                  <div key={r.id} className="case-card" style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 9, background: "var(--surface-2)" }}>
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
                              <button type="submit" className="btn ghost sm" title="Back to review">
                                <RotateCcw size={13} /> To review
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
                    </div>
                  </div>
                ))}
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
