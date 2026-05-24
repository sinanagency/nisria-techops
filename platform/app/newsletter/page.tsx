import Shell from "../../components/Shell";
import { Card, Badge } from "../../components/ui";
import { admin, date } from "../../lib/supabase-admin";
import { draftNewsletter, queueSend } from "./actions";

export const dynamic = "force-dynamic";

export default async function Newsletter() {
  const db = admin();
  const { data } = await db
    .from("content_posts")
    .select("*")
    .contains("channels", ["newsletter"])
    .order("created_at", { ascending: false })
    .limit(20);
  const drafts = data || [];

  return (
    <Shell
      title="Newsletter"
      sub="AI drafts your weekly donor newsletter from the week's activity"
      action={
        <form action={draftNewsletter}>
          <button className="btn yellow" type="submit">Draft this week ✦</button>
        </form>
      }
    >
      <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
        {drafts.length === 0 && (
          <Card><div className="empty">No newsletters yet. Hit “Draft this week ✦” and the AI assembles one from your recent posts, campaigns, and impact stories.</div></Card>
        )}
        {drafts.map((n: any) => (
          <div className="card" key={n.id}>
            <div className="card-h">
              <span className="flex">{n.title || "Newsletter"}<Badge tone={n.status === "scheduled" ? "green" : ""}>{n.status}</Badge>{n.created_by === "AI" && <Badge tone="purple">✦AI</Badge>}</span>
              <span className="muted" style={{ fontSize: 12 }}>{date(n.created_at)}</span>
            </div>
            <div className="card-pad">
              <div style={{ whiteSpace: "pre-wrap", fontSize: 13.5, lineHeight: 1.6 }}>{n.body}</div>
              {n.status === "draft" && (
                <form action={queueSend} style={{ marginTop: 12 }}>
                  <input type="hidden" name="id" value={n.id} />
                  <button className="btn" type="submit">Queue to send</button>
                </form>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        Sending goes out via Givebutter / your email service once connected; drafting + queueing work now.
      </div>
    </Shell>
  );
}
