import { supabase, PublicProfile } from "../../lib/supabase";

// Donor-facing beneficiary profiles (Pillar 3). Reads ONLY the
// public_beneficiary_profiles view (consent-gated). Embed or link from the site.
export const revalidate = 300;

export default async function Beneficiaries() {
  const { data } = await supabase
    .from("public_beneficiary_profiles")
    .select("*")
    .limit(60);

  const profiles = (data ?? []) as PublicProfile[];

  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>The people you support</h1>
      <p style={{ color: "#666", marginTop: 0 }}>
        Every profile here is shared with consent. Your gift goes directly to their goals.
      </p>
      {profiles.length === 0 && (
        <p style={{ color: "#888" }}>No public profiles yet.</p>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))",
          gap: 16,
          marginTop: 16,
        }}
      >
        {profiles.map((p) => (
          <article key={p.id} style={{ border: "1px solid #eee", borderRadius: 16, overflow: "hidden", background: "#fff" }}>
            {p.photo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.photo_url} alt={p.name} style={{ width: "100%", height: 180, objectFit: "cover" }} />
            )}
            <div style={{ padding: 16 }}>
              <div style={{ fontSize: 12, color: "#999", textTransform: "uppercase", letterSpacing: 0.5 }}>
                {p.category ?? "Support"}
              </div>
              <h3 style={{ margin: "4px 0 8px" }}>{p.name}</h3>
              {p.public_story && (
                <p style={{ fontSize: 14, color: "#444", margin: 0 }}>{p.public_story}</p>
              )}
              {p.goal_amount && p.goal_amount > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ background: "#eee", borderRadius: 999, height: 10, overflow: "hidden" }}>
                    <div style={{ width: `${p.funded_pct}%`, height: "100%", background: "#d98e04" }} />
                  </div>
                  <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>{p.funded_pct}% funded</div>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
