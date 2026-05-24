import Shell from "../../components/Shell";
import { Card, Badge } from "../../components/ui";
import { admin, date, num } from "../../lib/supabase-admin";
import { draftNewsletter } from "./actions";
import Compose from "./Compose";
import { Users, Sparkles, Mail } from "lucide-react";

export const dynamic = "force-dynamic";

const firstName = (full?: string | null) => (full || "").trim().split(/\s+/)[0] || "there";

export default async function Newsletter() {
  const db = admin();

  // Audience: donors with a non-null email.
  const { count: audience } = await db
    .from("donors")
    .select("id", { count: "exact", head: true })
    .not("email", "is", null);
  const audienceCount = audience || 0;

  const { data: sampleDonors } = await db
    .from("donors")
    .select("full_name,email")
    .not("email", "is", null)
    .order("created_at", { ascending: false })
    .limit(5);
  const sample = (sampleDonors || []) as any[];
  const sampleName = firstName(sample[0]?.full_name);

  // Newsletter stream (drafts + sent records).
  const { data: stream } = await db
    .from("content_posts")
    .select("*")
    .contains("channels", ["newsletter"])
    .order("created_at", { ascending: false })
    .limit(20);
  const items = (stream || []) as any[];

  // Seed the compose area with the most recent AI draft, if any.
  const latestDraft = items.find((n) => n.status === "draft");
  const initialSubject = latestDraft?.title && latestDraft.title !== "Weekly newsletter (draft)" ? latestDraft.title : "A note from Nisria";
  const initialBody = latestDraft?.body || "Hi {{first_name}},\n\n";

  return (
    <Shell
      title="Newsletter"
      sub="One blast, every greeting personalized — {{first_name}} merges to each donor"
      action={
        <form action={draftNewsletter}>
          <button className="btn ghost" type="submit"><Sparkles size={15} /> Draft this week</button>
        </form>
      }
    >
      {/* audience */}
      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        <div className="feature teal">
          <div className="ficon"><Users size={20} /></div>
          <div className="ftitle">{num(audienceCount)} donor{audienceCount === 1 ? "" : "s"} with an email</div>
          <div className="fmeta">
            {sample.length > 0
              ? <>e.g. {sample.slice(0, 3).map((d) => firstName(d.full_name)).join(", ")}{audienceCount > 3 ? "…" : ""}</>
              : "No donor emails on file yet — add donors in the CRM to build your list."}
          </div>
        </div>
        <div className="card card-pad">
          <div className="flex" style={{ marginBottom: 6 }}>
            <Mail size={16} color="var(--muted)" />
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>Sends from sasa@nisria.co</span>
          </div>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            Each donor gets a 1:1 email with their first name merged into the greeting. Capped at 50 recipients per send for now. The Send button is the only thing that mails anyone — nothing goes out automatically.
          </div>
        </div>
      </div>

      {audienceCount === 0 ? (
        <Card>
          <div className="empty">
            No donors with an email yet. Add donors (with emails) in the CRM, then come back to write and send your newsletter.
          </div>
        </Card>
      ) : (
        <Compose
          audience={Math.min(audienceCount, 50)}
          sampleName={sampleName}
          initialSubject={initialSubject}
          initialBody={initialBody}
        />
      )}

      {/* history */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-h">History<Badge>{items.length}</Badge></div>
        <div className="card-pad stack" style={{ gap: 12 }}>
          {items.length === 0 && (
            <div className="empty">No newsletters yet. Hit "Draft this week" to have the AI assemble one from recent posts, campaigns, and impact stories — then personalize and send.</div>
          )}
          {items.map((n) => (
            <div key={n.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 14 }}>
              <div className="between">
                <span className="flex">
                  <strong style={{ fontSize: 13.5 }}>{n.title || "Newsletter"}</strong>
                  <Badge tone={n.status === "posted" ? "green" : n.status === "scheduled" ? "blue" : "gray"}>{n.status === "posted" ? "sent" : n.status}</Badge>
                  {n.created_by === "AI" && <Badge tone="purple">✦AI</Badge>}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>{date(n.posted_at || n.created_at)}</span>
              </div>
              <div style={{ whiteSpace: "pre-wrap", fontSize: 12.5, lineHeight: 1.55, marginTop: 8, maxHeight: 120, overflow: "hidden", color: "var(--ink-2)" }}>{n.body}</div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}
