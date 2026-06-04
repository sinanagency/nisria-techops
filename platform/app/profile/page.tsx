import Link from "next/link";
import Shell from "../../components/Shell";
import { Badge } from "../../components/ui";
import { admin } from "../../lib/supabase-admin";
import { getCurrentUser } from "../../lib/auth";
import { getCurrentTeamMember, initialsOf } from "../../lib/profile";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = { founder: "Founder", builder: "Builder" };

export default async function Profile() {
  const user = getCurrentUser();
  const profile = await getCurrentTeamMember();

  if (!user) {
    return (
      <Shell title="Profile">
        <div className="card"><div className="card-pad muted">Not signed in.</div></div>
      </Shell>
    );
  }

  const db = admin();
  const initials = profile ? initialsOf(profile.name) : user.initials;

  // Task stats grounded in the profile bridge: what's assigned to me, what I created.
  let assignedOpen = 0, assignedDone = 0, createdMine = 0;
  if (profile) {
    const { data: assigned } = await db.from("tasks").select("status").eq("assignee_id", profile.id).limit(1000);
    assignedOpen = (assigned || []).filter((t: any) => t.status !== "done").length;
    assignedDone = (assigned || []).filter((t: any) => t.status === "done").length;
  }
  const { count } = await db.from("tasks").select("id", { count: "exact", head: true }).eq("created_by", user.name);
  createdMine = count || 0;

  const Stat = ({ n, label, href }: { n: number; label: string; href?: string }) => {
    const inner = (
      <div className="card card-pad stat" style={{ flex: 1 }}>
        <div className="label">{label}</div>
        <div className="value disp2">{n}</div>
      </div>
    );
    return href ? <Link href={href} style={{ flex: 1, textDecoration: "none", color: "inherit" }}>{inner}</Link> : inner;
  };

  const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, padding: "13px 0", borderBottom: "1px solid var(--line)" }}>
      <span className="muted" style={{ fontSize: 12.5 }}>{label}</span>
      <span style={{ fontSize: 13.5, textAlign: "right", minWidth: 0 }}>{value}</span>
    </div>
  );

  return (
    <Shell title="Profile" sub="Who you are on the platform, and your work at a glance">
      {/* Identity header: avatar + name + role, lead of the page */}
      <div className="feature teal">
        <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
          <div className="avatar" aria-hidden style={{ width: 64, height: 64, fontSize: 24, flexShrink: 0, background: "rgba(255,255,255,0.85)", color: "var(--teal-700)" }}>
            {initials}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span className="ftitle" style={{ fontSize: 22 }}>{profile?.name || user.name}</span>
              <Badge tone="teal">{ROLE_LABEL[user.role] || user.role}</Badge>
            </div>
            <div className="fmeta" style={{ fontSize: 13.5 }}>{profile?.role || user.org}</div>
          </div>
        </div>
      </div>

      {/* Work at a glance */}
      <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
        <Stat n={assignedOpen} label="Assigned to me · open" href="/tasks?mine=1" />
        <Stat n={assignedDone} label="Assigned to me · done" href="/tasks?mine=1" />
        <Stat n={createdMine} label="Created by me" href="/tasks?mine=1" />
      </div>

      {/* Account details */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">Account details</div>
        <div className="card-pad" style={{ paddingTop: 6, paddingBottom: 6 }}>
          <Field label="Name" value={profile?.name || user.name} />
          <Field label="Role" value={<Badge tone="teal">{ROLE_LABEL[user.role] || user.role}</Badge>} />
          {profile?.role && <Field label="Title" value={profile.role} />}
          <Field label="Organisation" value={user.org} />
          {profile?.email && <Field label="Email" value={profile.email} />}
          {profile?.member_type && <Field label="Member type" value={profile.member_type} />}
        </div>
      </div>

      {/* Responsibilities */}
      {profile?.responsibilities && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h">Responsibilities</div>
          <div className="card-pad" style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
            {profile.responsibilities}
          </div>
        </div>
      )}

      {!profile && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-pad muted" style={{ fontSize: 12.5 }}>
            No team directory profile is linked to this login yet. Task assignment counts need one.
          </div>
        </div>
      )}
    </Shell>
  );
}
