import Shell from "../../components/Shell";
import { Card, Badge } from "../../components/ui";
import StudioConsole from "../../components/StudioConsole";
import StudioDocCard from "../../components/StudioDocCard";
import { admin } from "../../lib/supabase-admin";
import { FileText, Wand2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Studio() {
  const db = admin();
  const { data } = await db
    .from("studio_documents")
    .select("id,title,doc_type,brand,prompt,html,created_at")
    .order("created_at", { ascending: false })
    .limit(12);
  const docs = (data || []) as any[];

  return (
    <Shell
      title="Document Studio"
      sub="Drop screenshots or files, say what you need, and the Studio assembles a branded, printable document grounded in Nisria's history."
      action={<Badge tone="teal"><Wand2 size={11} /> AI document studio</Badge>}
    >
      <StudioConsole />

      <Card title="Recent documents" action={<Badge tone="gray">{docs.length}</Badge>}>
        <div className="card-pad">
          {docs.length === 0 ? (
            <div className="empty">
              <div style={{ marginBottom: 6 }}><FileText size={20} color="var(--faint)" /></div>
              <div>No documents yet.</div>
              <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>Create your first one above. Each document is saved here and in your Library.</div>
            </div>
          ) : (
            <div className="grid cols-3" style={{ gap: 14 }}>
              {docs.map((d) => <StudioDocCard key={d.id} doc={d} />)}
            </div>
          )}
        </div>
      </Card>
    </Shell>
  );
}
