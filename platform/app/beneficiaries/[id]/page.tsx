import Shell from "../../../components/Shell";
import { Badge, statusTone } from "../../../components/ui";
import { TabTitle } from "../../../components/tabs-context";
import { admin, money, date } from "../../../lib/supabase-admin";
import { toggleConsent, setStatus } from "../actions";
import { Lock, MapPin, Calendar, Users, Tag, Globe, ShieldOff, ImageIcon, HeartHandshake, FileText } from "lucide-react";

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

export default async function Beneficiary360({ params }: { params: { id: string } }) {
  const db = admin();
  const id = params.id;

  const { data: row } = await db.from("beneficiaries").select("*").eq("id", id).single();
  const b: any = row || {};

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

  const PrivTag = () => <span className="badge red" style={{ fontSize: 9.5, padding: "1px 6px" }}><Lock size={9} /> Private</span>;

  const Row = ({ icon: Icon, label, children, priv }: { icon: any; label: string; children: React.ReactNode; priv?: boolean }) => (
    <div className="between" style={{ fontSize: 13, padding: "9px 0", borderTop: "1px solid var(--line)" }}>
      <span className="muted flex" style={{ gap: 7 }}><Icon size={13} /> {label} {priv && <PrivTag />}</span>
      <span style={{ textAlign: "right" }}>{children || "—"}</span>
    </div>
  );

  return (
    <Shell
      title={display}
      sub={b.ref_code || "Beneficiary"}
      action={
        <span className="flex" style={{ gap: 6 }}>
          <Badge tone="red"><Lock size={10} /> PII</Badge>
          {b.status && <Badge tone={statusTone(b.status)}>{b.status}</Badge>}
        </span>
      }
    >
      <TabTitle title={display} />
      <div className="grid" style={{ gridTemplateColumns: "1fr 1.4fr" }}>
        {/* profile column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card card-pad">
            <div className="flex" style={{ marginBottom: 14, gap: 13 }}>
              {photoUrl ? (
                <img src={photoUrl} alt={display} style={{ width: 52, height: 52, borderRadius: 14, objectFit: "cover" }} />
              ) : (
                <div className="avatar" style={{ width: 52, height: 52, fontSize: 20 }}>{display.charAt(0).toUpperCase()}</div>
              )}
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17 }} className="flex">
                  {display} <PrivTag />
                </div>
                <div className="muted" style={{ fontSize: 12.5 }}>{program || "no program set"}</div>
              </div>
            </div>
            <div className="stack" style={{ gap: 0 }}>
              <Row icon={Tag} label="Program">{program ? <Badge tone="teal">{program}</Badge> : null}</Row>
              <Row icon={Lock} label="Full name" priv>{b.full_name}</Row>
              <Row icon={MapPin} label="Location" priv>{b.location || b.region}</Row>
              {b.region && b.location && <Row icon={MapPin} label="Region" priv>{b.region}</Row>}
              <Row icon={Users} label="Guardian" priv>{b.guardian_status}</Row>
              <Row icon={Calendar} label="Age" priv>{a !== null ? a : null}</Row>
              <Row icon={Users} label="Gender" priv>{b.gender}</Row>
              <Row icon={Calendar} label="Intake">{date(b.intake_date)}</Row>
              <Row icon={Globe} label="Consent">{consented ? <span className="strong">granted {date(b.consent_date)}</span> : "not granted"}</Row>
            </div>
            {tags.length > 0 && (
              <div className="flex" style={{ flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                {tags.map((t, i) => <span key={i} className="chip"><Tag size={11} /> {t}</span>)}
              </div>
            )}
          </div>

          {/* funding */}
          {goal > 0 && (
            <div className="feature peri">
              <div className="ficon"><HeartHandshake size={20} /></div>
              <div className="ftitle money">{money(funded)} / {money(goal)}</div>
              <div className="fmeta">{fundedPct}% funded</div>
            </div>
          )}

          {/* lifecycle status changer */}
          <div className="card card-pad">
            <div className="flex" style={{ marginBottom: 10 }}><FileText size={15} color="var(--muted)" /><span style={{ fontWeight: 600, fontSize: 13.5 }}>Lifecycle status</span></div>
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
        </div>

        {/* story + consent column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* consent / public profile control */}
          <div className={`card card-pad`}>
            <div className="between" style={{ marginBottom: 10 }}>
              <span className="flex" style={{ fontWeight: 600, fontSize: 14 }}><Globe size={15} color="var(--muted)" /> Donor-facing profile</span>
              {consented ? <Badge tone="green">public profile live</Badge> : <Badge tone="gray">private only</Badge>}
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

          {/* public-facing fields (what donors would see) */}
          <div className="card">
            <div className="card-h"><span className="flex"><Globe size={14} /> Public profile</span><Badge tone="gray">donor view</Badge></div>
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
            <div className="card-h"><span className="flex"><Lock size={14} /> Case notes</span><PrivTag /></div>
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
