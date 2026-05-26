import Shell from "../../components/Shell";
import { Card, Meter, Badge, statusTone } from "../../components/ui";
import { admin, date } from "../../lib/supabase-admin";
import { Money } from "../../components/Money";
import CampaignPeek from "../../components/CampaignPeek";
import CampaignEditor from "../../components/CampaignEditor";

export const dynamic = "force-dynamic";

export default async function Campaigns() {
  const db = admin();
  const { data } = await db.from("campaigns").select("*").order("starts_on", { ascending: false }).limit(200);
  return (
    <Shell title="Campaigns" sub={`${data?.length || 0} campaigns`} action={<CampaignEditor label="New campaign" />}>
      <div className="grid cols-2">
        {(data || []).length === 0 && (
          <Card><div className="empty">No campaigns yet. They'll appear here as Givebutter syncs in.</div></Card>
        )}
        {(data || []).map((c: any) => {
          const goal = Number(c.goal_amount || 0);
          const raised = Number(c.raised_amount || 0);
          const pct = goal > 0 ? (raised / goal) * 100 : 0;
          return (
            <div className="card card-pad" key={c.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <CampaignPeek campaign={c} />
                <div className="flex" style={{ gap: 8 }}>
                  <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                  <CampaignEditor campaign={c} label="Edit" variant="pill" />
                </div>
              </div>
              <div style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 4 }}>
                {c.type} · {date(c.starts_on)}{c.ends_on ? ` → ${date(c.ends_on)}` : ""}
              </div>
              <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between" }}>
                <Money amount={raised} className="strong" />
                {goal > 0 && <span style={{ color: "var(--muted)" }}>of <Money amount={goal} /> · {Math.round(pct)}%</span>}
              </div>
              <Meter pct={pct} />
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
