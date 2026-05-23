import { supabase, Campaign } from "../../../lib/supabase";

// Gamified-giving meter (Pillar 2). Embed on Squarespace:
//   <iframe src="https://<vercel-app>/campaign/<id>" width="100%" height="220" style="border:0"></iframe>
// Revalidate so the meter stays close to live.
export const revalidate = 30;

export default async function CampaignMeter({
  params,
}: {
  params: { id: string };
}) {
  const { data } = await supabase
    .from("campaigns")
    .select("id,name,goal_amount,raised_amount,status")
    .eq("id", params.id)
    .single();

  const c = data as Campaign | null;
  if (!c) return <Frame><p>Campaign not found.</p></Frame>;

  const goal = c.goal_amount ?? 0;
  const pct = goal > 0 ? Math.min((c.raised_amount / goal) * 100, 100) : 0;
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

  return (
    <Frame>
      <div style={{ fontSize: 14, color: "#666", marginBottom: 4 }}>{c.name}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 30, fontWeight: 700 }}>{fmt(c.raised_amount)}</span>
        {goal > 0 && <span style={{ color: "#888" }}>raised of {fmt(goal)}</span>}
      </div>
      <div style={{ background: "#eee", borderRadius: 999, height: 14, marginTop: 12, overflow: "hidden" }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            borderRadius: 999,
            background: "linear-gradient(90deg,#e8b923,#d98e04)", // ⚑ brand colors
            transition: "width .6s ease",
          }}
        />
      </div>
      {goal > 0 && (
        <div style={{ marginTop: 8, fontSize: 13, color: "#666" }}>
          {Math.round(pct)}% there{c.status === "live" ? " · give now" : ""}
        </div>
      )}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ padding: 20, maxWidth: 520 }}>
      <div style={{ border: "1px solid #eee", borderRadius: 16, padding: 20, background: "#fff" }}>
        {children}
      </div>
    </main>
  );
}
