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
      {/* The generation console leads, framed as the hero feature: this is the
          intake zone where you describe a document and the AI assembles it. */}
      <div className="feature teal" style={{ marginBottom: 18, padding: 18 }}>
        <div className="flex" style={{ gap: 10, marginBottom: 14 }}>
          <div className="ficon" style={{ background: "var(--teal)", color: "#fff", width: 36, height: 36, marginBottom: 0 }}><Wand2 size={18} /></div>
          <div>
            <div className="ftitle disp2" style={{ fontSize: 19 }}>Assemble a document</div>
            <div className="fmeta">Describe it, drop any inputs, and the Studio drafts a branded, printable result grounded in Nisria's history.</div>
          </div>
        </div>
        <StudioConsole />
      </div>

      {/* Everything generated lands below as a card grid: type badge, brand,
          date, and open / download on each. */}
      <Card title="Generated documents" action={<Badge tone="gray">{docs.length}</Badge>}>
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
