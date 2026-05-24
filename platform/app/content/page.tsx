import Shell from "../../components/Shell";
import { Card, Badge, statusTone } from "../../components/ui";
import { admin, date } from "../../lib/supabase-admin";
import { composePost, aiDraft, setPostStatus } from "./actions";

export const dynamic = "force-dynamic";
const CHANNELS = ["instagram", "facebook", "linkedin", "tiktok", "pinterest", "youtube"];

export default async function Content() {
  const db = admin();
  const { data: brands } = await db.from("brands").select("id,name").order("name");
  const { data: posts } = await db.from("content_posts").select("*,brand:brands(name)").order("created_at", { ascending: false }).limit(100);
  const list = posts || [];
  const cols = [
    { key: "scheduled", label: "Scheduled" },
    { key: "draft", label: "Drafts" },
    { key: "posted", label: "Posted" },
  ];

  return (
    <Shell title="Content" sub="Drop a post in, the system queues it to publish across channels">
      <Card title="Compose">
        <form className="card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="flex">
            <select name="brand_id" style={{ maxWidth: 200 }}>
              {(brands || []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <input type="datetime-local" name="scheduled_for" style={{ maxWidth: 230 }} />
          </div>
          <div className="flex" style={{ flexWrap: "wrap", gap: 14 }}>
            {CHANNELS.map((c) => (
              <label key={c} className="flex" style={{ gap: 6, fontWeight: 500 }}>
                <input type="checkbox" name="channels" value={c} style={{ width: "auto" }} defaultChecked={c === "instagram" || c === "facebook"} /> {c}
              </label>
            ))}
          </div>
          <textarea name="body" rows={3} placeholder="Write the post, or type a brief and hit 'Draft with AI'…" />
          <div className="flex">
            <button className="btn" formAction={composePost} type="submit">Add to queue</button>
            <button className="btn yellow" formAction={aiDraft} type="submit">Draft with AI ✦</button>
          </div>
        </form>
      </Card>

      <div className="grid cols-3" style={{ marginTop: 16 }}>
        {cols.map((col) => {
          const items = list.filter((p: any) => p.status === col.key);
          return (
            <div className="card" key={col.key}>
              <div className="card-h">{col.label}<Badge>{items.length}</Badge></div>
              <div className="card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {items.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>Empty.</div>}
                {items.map((p: any) => (
                  <div key={p.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                    <div className="between">
                      <Badge tone="purple">{p.brand?.name || "—"}</Badge>
                      <span className="muted" style={{ fontSize: 11.5 }}>{(p.channels || []).join(" · ")}</span>
                    </div>
                    <div style={{ fontSize: 13, marginTop: 8 }}>{p.body}</div>
                    <div className="between" style={{ marginTop: 8 }}>
                      <span className="muted" style={{ fontSize: 11.5 }}>
                        {p.created_by === "AI" ? "✦AI · " : ""}{p.scheduled_for ? `for ${date(p.scheduled_for)}` : p.posted_at ? date(p.posted_at) : "no date"}
                      </span>
                      {p.status !== "posted" && (
                        <form action={setPostStatus}>
                          <input type="hidden" name="id" value={p.id} />
                          <input type="hidden" name="status" value={p.status === "draft" ? "scheduled" : "posted"} />
                          <button className="pill" type="submit">{p.status === "draft" ? "Schedule" : "Mark posted"}</button>
                        </form>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        Auto-publishing to the live channels runs through n8n once each platform's posting API is connected. Scheduling + drafting work now.
      </div>
    </Shell>
  );
}
