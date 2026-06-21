import Shell from "../../../components/Shell";
import { Badge, statusTone, Meter } from "../../../components/ui";
import { TabTitle } from "../../../components/tabs-context";
import PreviewLink from "../../../components/PreviewLink";
import { Money } from "../../../components/Money";
import { admin, date } from "../../../lib/supabase-admin";
import { activityLabel, activityTone } from "../../../lib/activity";
import { toggleConsent, setStatus } from "../actions";
import BeneficiaryManage from "../../../components/BeneficiaryManage";
import { Lock, MapPin, Calendar, Users, Tag, Globe, ShieldOff, ImageIcon, HeartHandshake, FileText, Activity } from "lucide-react";

export const dynamic = "force-dynamic";

const PROGRAM_LABEL: Record<string, string> = {
  safe_house: "Safe house",
  education: "Education",
  rescue: "Rescue",
  nutrition: "Nutrition",
  other: "Other",
};
const STATUS_OPTS = ["active", "graduated", "transitioned", "paused", "exited", "inactive"];

function ageFrom(dob: any): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const yrs = Math.floor((Date.now() - d.getTime()) / (365.25 * 86400e3));
  return yrs >= 0 && yrs < 130 ? yrs : null;
}

// Tone -> the timeline dot colour, kept in CSS variables so it tracks the theme.
const DOT_COLOR: Record<string, string> = {
  teal: "var(--teal)",
  gold: "var(--gold)",
  green: "var(--green)",
  red: "var(--red)",
  gray: "var(--muted)",
};

// One shape for every node on the hero timeline, whether it came from the events
// table (real activity) or from a lifecycle stamp on the record itself.
type TLNode = { at: string | null; title: string; meta?: string; tone: string };

export default async function Beneficiary360({ params }: { params: { id: string } }) {
  const db = admin();
  const id = params.id;

  const { data: row } = await db.from("beneficiaries").select("*").eq("id", id).single();
  const b: any = row || {};

  // Other ACCEPTED beneficiaries, for the merge-duplicate picker in Manage.
  const { data: othersRows } = await db
    .from("beneficiaries").select("id,full_name,ref_code")
    .is("intake_stage", null).neq("id", id)
    .order("full_name", { ascending: true }).limit(300);
  const others = (othersRows || []).map((o: any) => ({ id: o.id, name: o.full_name || o.ref_code || "Beneficiary" }));
  const isCase = b.intake_stage != null;

  // The real activity feed for THIS record. The events table is the single source
  // of "what happened" (intake, status changes, consent grants/withdrawals).
  // Service-role only, ordered newest-first.
  const { data: evRows } = await db
    .from("events")
    .select("type,source,actor,payload,created_at")
    .eq("subject_type", "beneficiary")
    .eq("subject_id", id)
    .order("created_at", { ascending: false })
    .limit(60);
  const events = evRows || [];

  // Resolve a signed photo URL from the private assets bucket if a photo asset is
  // linked. Service-role only; the signed URL is short-lived (1h).
  let photoUrl: string | null = null;
  if (b.photo_asset_id) {
    const { data: asset } = await db.from("assets").select("storage_path").eq("id", b.photo_asset_id).maybeSingle();
    if (asset?.storage_path) {
      const { data: signed } = await db.storage.from("assets").createSignedUrl(asset.storage_path, 3600);
      photoUrl = signed?.signedUrl || null;
    }
  }

  const display = b.full_name || b.public_name || b.ref_code || "Beneficiary";
  const tags: string[] = Array.isArray(b.tags) ? b.tags : [];
  const consented = !!b.consent_public;
  const program = b.program ? PROGRAM_LABEL[b.program] || b.program : null;
  const a = ageFrom(b.date_of_birth);

  const goal = Number(b.goal_amount || 0);
  const funded = Number(b.funded_amount || 0);
  const fundedPct = goal > 0 ? Math.min(100, Math.round((funded / goal) * 100)) : 0;
  // Funding is donor-facing money. Keep one currency per record; never mix.
  const fundCurrency = b.currency || "USD";

  // Build the hero timeline. Prefer the real events feed. Whatever the events
  // table does not capture, the lifecycle stamps on the record fill in (intake,
  // consent), so the spine is never empty when there is history to show.
  const eventNodes: TLNode[] = events.map((e: any) => ({
    at: e.created_at,
    title: activityLabel(e),
    meta: e.actor ? `${e.actor}${e.source ? ` · ${e.source}` : ""}` : e.source || undefined,
    tone: activityTone(e.type),
  }));

  // Lifecycle / funding stamps, used only when the events feed has no node for them.
  const haveType = (frag: string) => events.some((e: any) => String(e.type).includes(frag));
  const stampNodes: TLNode[] = [];
  if (b.intake_date && !haveType("intake")) {
    stampNodes.push({ at: b.intake_date, title: "Entered the program", meta: program || undefined, tone: "teal" });
  }
  if (consented && b.consent_date && !haveType("consent")) {
    stampNodes.push({ at: b.consent_date, title: "Donor consent granted", meta: "public profile live", tone: "green" });
  }

  const timeline: TLNode[] = [...eventNodes, ...stampNodes].sort((x, y) => {
    const tx = x.at ? new Date(x.at).getTime() : 0;
    const ty = y.at ? new Date(y.at).getTime() : 0;
    return ty - tx;
  });
  // True when the spine is built only from record stamps, not the events feed.
  const noActivity = events.length === 0;

  // Single-tenant (you + Nur), so no per-field "Private" badges. The whole record
  // is private by default; the only meaningful distinction is what gets PUBLISHED
  // to donors, which the Donor-facing card controls. PrivTag kept as a no-op so the
  // existing `priv` props stay harmless.
  const PrivTag = () => null;

  const Row = ({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode; priv?: boolean }) => (
    <div className="between" style={{ fontSize: 13, padding: "9px 0", borderTop: "1px solid var(--line)" }}>
      <span className="muted flex" style={{ gap: 7 }}><Icon size={13} /> {label}</span>
      <span style={{ textAlign: "right" }}>{children || "-"}</span>
    </div>
  );

  return (
    <Shell
      title={display}
      sub={b.ref_code || "Beneficiary"}
      action={
        <span className="flex" style={{ gap: 6 }}>
          <Badge tone="gray"><Lock size={10} /> Private</Badge>
          {b.status && <Badge tone={statusTone(b.status)}>{b.status}</Badge>}
          {b.id && !isCase && <BeneficiaryManage b={b} others={others} />}
        </span>
      }
    >
      <TabTitle title={display} />

      {/* identity banner: name + status lead the record */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="between" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 14 }}>
          <div className="flex" style={{ gap: 16 }}>
            {photoUrl ? (
              <PreviewLink href={photoUrl} kind="image" title={display} style={{ flexShrink: 0, display: "block" }}>
                <img src={photoUrl} alt={display} style={{ width: 76, height: 76, borderRadius: 16, objectFit: "cover", boxShadow: "var(--shadow-sm)", border: "1px solid var(--line)", cursor: "pointer" }} />
              </PreviewLink>
            ) : (
              <div className="avatar" style={{ width: 76, height: 76, fontSize: 28, flexShrink: 0 }}>{display.charAt(0).toUpperCase()}</div>
            )}
            <div>
              <div className="disp2" style={{ fontWeight: 700, fontSize: 26, lineHeight: 1.05 }}>{display}</div>
              <div className="muted flex" style={{ fontSize: 13, gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                <span>{b.ref_code || "Beneficiary"}</span>
                {program && <><span>·</span><span>{program}</span></>}
              </div>
            </div>
          </div>
          <span className="flex" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Badge tone={statusTone(b.status)}>{b.status || "active"}</Badge>
            {b.category && (
              <Badge tone={b.category.toLowerCase().includes("microfund") ? "gold" : "teal"}>
                {b.category.toLowerCase().includes("kwetu") ? "Kwetu Haven" : b.category.toLowerCase().includes("microfund") ? "Microfund" : b.category}
              </Badge>
            )}
            {consented ? <Badge tone="green">public profile live</Badge> : <Badge tone="gray">private only</Badge>}
          </span>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "0.9fr 1.5fr", alignItems: "start" }}>
        {/* LEFT: details rail */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* funding */}
          {goal > 0 && (
            <div className="feature peri">
              <div className="ficon"><HeartHandshake size={20} /></div>
              <div className="ftitle">
                <Money amount={funded} currency={fundCurrency} /> / <Money amount={goal} currency={fundCurrency} />
              </div>
              <div className="fmeta" style={{ marginBottom: 10 }}>{fundedPct}% funded</div>
              <Meter pct={fundedPct} />
            </div>
          )}

          {/* key attributes */}
          <div className="card card-pad">
            <div className="flex" style={{ marginBottom: 10, gap: 7 }}><FileText size={15} color="var(--muted)" /><span style={{ fontWeight: 600, fontSize: 13.5 }}>Details</span></div>
            <div className="stack" style={{ gap: 0 }}>
              <Row icon={Tag} label="Program">{program ? <Badge tone="peri">{program}</Badge> : null}</Row>
              <Row icon={Lock} label="Full name" priv>{b.full_name}</Row>
              <Row icon={MapPin} label="Location" priv>{b.location || b.region}</Row>
              {b.region && b.location && <Row icon={MapPin} label="Region" priv>{b.region}</Row>}
              <Row icon={Users} label="Guardian" priv>{b.guardian_status}</Row>
              <Row icon={Calendar} label="Age" priv>{a !== null ? a : b.age_at_intake != null ? `${b.age_at_intake} at intake` : null}</Row>
              <Row icon={Users} label="Gender" priv>{b.gender}</Row>
              {b.national_id && <Row icon={Lock} label="National ID" priv>{b.national_id}</Row>}
              {b.case_number && <Row icon={Lock} label="Case number" priv>{b.case_number}</Row>}
              {b.case_type && <Row icon={Tag} label="Case type">{b.case_type}</Row>}
              {b.contact_phone && <Row icon={Users} label="Contact" priv>{b.contact_phone}</Row>}
              <Row icon={Calendar} label="Intake">{date(b.intake_date)}</Row>
              <Row icon={Globe} label="Consent">{consented ? <span className="strong">granted {date(b.consent_date)}</span> : "not granted"}</Row>
            </div>
            {tags.length > 0 && (
              <div className="flex" style={{ flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                {tags.map((t, i) => <span key={i} className="chip"><Tag size={11} /> {t}</span>)}
              </div>
            )}
          </div>

          {/* lifecycle status changer */}
          <div className="card card-pad">
            <div className="flex" style={{ marginBottom: 10, gap: 7 }}><Activity size={15} color="var(--muted)" /><span style={{ fontWeight: 600, fontSize: 13.5 }}>Lifecycle status</span></div>
            <div className="flex wrap" style={{ gap: 6 }}>
              {STATUS_OPTS.map((s) => (
                <form key={s} action={setStatus}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="status" value={s} />
                  <button type="submit" className={`pill ${(b.status || "active") === s ? "on" : ""}`}>{s}</button>
                </form>
              ))}
            </div>
          </div>

          {/* consent / public profile control */}
          <div className="card card-pad">
            <div className="between" style={{ marginBottom: 10 }}>
              <span className="flex" style={{ fontWeight: 600, fontSize: 14, gap: 7 }}><Globe size={15} color="var(--muted)" /> Donor-facing profile</span>
              {consented ? <Badge tone="green">live</Badge> : <Badge tone="gray">off</Badge>}
            </div>
            <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.55, marginBottom: 12 }}>
              {consented
                ? "Live on the public donor widget. Donors see the alias, program, sanitized story and public photo only. Unpublishing removes it immediately."
                : "Publishing shows ONLY the alias, program, sanitized story and public photo to donors. Full name, location, guardian and other PII never leave this admin surface."}
            </div>
            <form action={toggleConsent}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="to" value={consented ? "off" : "on"} />
              <button className={`btn ${consented ? "ghost" : "teal"}`} type="submit">
                {consented ? <><ShieldOff size={14} /> Unpublish profile</> : <><Globe size={14} /> Publish to donors</>}
              </button>
            </form>
          </div>
        </div>

        {/* CENTER/RIGHT: the activity + funding timeline is the hero */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div className="card-h">
              <span className="flex" style={{ gap: 7 }}><Activity size={14} /> Activity timeline</span>
              <Badge tone="gray">{timeline.length} {timeline.length === 1 ? "event" : "events"}</Badge>
            </div>
            <div style={{ padding: "16px 18px" }}>
              {noActivity && (
                <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.55, marginBottom: 14 }}>
                  No recorded activity events yet. Showing this record's funding and lifecycle history. New intakes, status changes and consent updates will appear here as they happen.
                </div>
              )}
              {timeline.length === 0 ? (
                <div className="faint" style={{ fontSize: 13 }}>Nothing on file yet.</div>
              ) : (
                <div style={{ position: "relative", paddingLeft: 22 }}>
                  {/* the vertical spine */}
                  <span style={{ position: "absolute", left: 5, top: 4, bottom: 4, width: 2, background: "var(--line)" }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                    {timeline.map((n, i) => (
                      <div key={i} style={{ position: "relative" }}>
                        <span style={{ position: "absolute", left: -22, top: 3, width: 12, height: 12, borderRadius: "50%", background: DOT_COLOR[n.tone] || "var(--muted)", boxShadow: "0 0 0 3px var(--surface)" }} />
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{n.title}</div>
                        <div className="muted flex" style={{ fontSize: 12, gap: 7, marginTop: 2, flexWrap: "wrap" }}>
                          <span>{date(n.at)}</span>
                          {n.meta && <><span>·</span><span>{n.meta}</span></>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* funding history feeds the timeline; surfaced explicitly when there is a goal */}
          {goal > 0 && (
            <div className="card">
              <div className="card-h"><span className="flex" style={{ gap: 7 }}><HeartHandshake size={14} /> Funding history</span><Badge tone="peri">{fundedPct}% funded</Badge></div>
              <div style={{ padding: "14px 18px" }}>
                <div className="between" style={{ fontSize: 13 }}>
                  <span className="muted">Raised</span>
                  <span className="strong"><Money amount={funded} currency={fundCurrency} /></span>
                </div>
                <div className="between" style={{ fontSize: 13, padding: "9px 0 0", marginTop: 9, borderTop: "1px solid var(--line)" }}>
                  <span className="muted">Goal</span>
                  <span className="strong"><Money amount={goal} currency={fundCurrency} /></span>
                </div>
                <div style={{ marginTop: 12 }}><Meter pct={fundedPct} /></div>
                <div className="faint" style={{ fontSize: 11.5, marginTop: 10, lineHeight: 1.5 }}>
                  Per-gift donation events are not yet linked to this record. As donations are attributed here, each gift will appear as a node on the timeline above.
                </div>
              </div>
            </div>
          )}

          {/* public-facing fields (what donors would see) */}
          <div className="card">
            <div className="card-h"><span className="flex" style={{ gap: 7 }}><Globe size={14} /> Public profile</span><Badge tone="gray">donor view</Badge></div>
            <div style={{ padding: "14px 18px" }}>
              <div className="stack" style={{ gap: 8, fontSize: 13 }}>
                <div className="between"><span className="muted">Display name</span><span className="strong">{b.public_name || "Anonymous"}</span></div>
                <div className="between"><span className="muted">Photo</span><span className="flex" style={{ gap: 5 }}>{photoUrl ? <><ImageIcon size={13} /> attached</> : "none"}</span></div>
              </div>
              <div style={{ marginTop: 12 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Sanitized story</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-2)" }}>
                  {b.public_story || <span className="faint">No public story written yet. Add one before publishing.</span>}
                </div>
              </div>
            </div>
          </div>

          {/* private case notes */}
          <div className="card">
            <div className="card-h"><span className="flex" style={{ gap: 7 }}><Lock size={14} /> Case notes</span><PrivTag /></div>
            <div style={{ padding: "14px 18px" }}>
              {b.story_private ? (
                <div style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--ink-2)", whiteSpace: "pre-wrap" }}>{b.story_private}</div>
              ) : (
                <div className="faint" style={{ fontSize: 13 }}>No private case notes recorded.</div>
              )}
              {b.needs && (
                <div style={{ marginTop: 12 }}>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Current needs</div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{b.needs}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
