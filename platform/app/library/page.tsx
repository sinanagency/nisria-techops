import Shell from "../../components/Shell";
import { Badge } from "../../components/ui";
import { admin } from "../../lib/supabase-admin";
import { uploadAsset } from "./actions";
import { UploadCloud, FileText, Film, File as FileIcon, FolderOpen, ImageIcon } from "lucide-react";

export const dynamic = "force-dynamic";

const fmtSize = (b: number) => b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
const typeIcon: any = { image: ImageIcon, pdf: FileText, document: FileText, video: Film, other: FileIcon };

export default async function Library() {
  const db = admin();
  const { data: assets } = await db.from("assets").select("*").order("created_at", { ascending: false }).limit(60);
  const list = (assets || []) as any[];

  // signed thumbnails for images (private bucket)
  const imgs = list.filter((a) => a.type === "image" && a.storage_path);
  const signed: Record<string, string> = {};
  if (imgs.length) {
    const { data } = await db.storage.from("assets").createSignedUrls(imgs.map((a) => a.storage_path), 3600);
    (data || []).forEach((s: any, i: number) => { if (s?.signedUrl) signed[imgs[i].storage_path] = s.signedUrl; });
  }
  const totalSize = list.reduce((s, a) => s + Number(a.size_bytes || 0), 0);

  return (
    <Shell title="Library" sub="Drop content here. Sasa files it, learns it, and reaches for it when writing." action={<Badge tone="teal">{list.length} assets</Badge>}>
      <div className="grid" style={{ gridTemplateColumns: "1fr 320px", marginBottom: 16 }}>
        {/* drop zone */}
        <form action={uploadAsset} className="card" style={{ padding: 0, overflow: "hidden" }}>
          <label htmlFor="lib-file" style={{ display: "block", padding: 30, textAlign: "center", cursor: "pointer", border: "2px dashed var(--line-2)", borderRadius: "var(--radius)", margin: 12 }}>
            <div style={{ width: 50, height: 50, borderRadius: 14, background: "var(--teal-50)", color: "var(--teal-700)", display: "grid", placeItems: "center", margin: "0 auto 12px" }}><UploadCloud size={24} /></div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Drop files or click to upload</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>Photos, logos, PDFs, reports, past posts. Images get auto-captioned.</div>
          </label>
          <input id="lib-file" type="file" name="file" multiple style={{ display: "none" }} />
          <div className="flex" style={{ padding: "0 14px 14px", gap: 10 }}>
            <select name="brand" style={{ maxWidth: 160 }} defaultValue="nisria">
              <option value="nisria">Nisria</option>
              <option value="maisha">Maisha</option>
              <option value="ahadi">AHADI</option>
            </select>
            <button className="btn teal" type="submit"><UploadCloud size={15} /> Upload &amp; ingest</button>
          </div>
        </form>

        {/* storage stat + Drive */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="feature peri">
            <div className="ficon"><FolderOpen size={20} /></div>
            <div className="ftitle">{list.length} files</div>
            <div className="fmeta">{fmtSize(totalSize)} stored · all private, RLS-gated</div>
          </div>
          <div className="card card-pad">
            <div className="flex" style={{ marginBottom: 6 }}><FolderOpen size={16} color="var(--muted)" /><span style={{ fontWeight: 600, fontSize: 13.5 }}>Google Drive</span><span style={{ marginLeft: "auto" }}><Badge tone="gray">connect</Badge></span></div>
            <div className="muted" style={{ fontSize: 12 }}>Import a Drive folder; files flow through the same ingestion + memory. Wiring pending OAuth.</div>
          </div>
        </div>
      </div>

      {/* grid */}
      <div className="grid cols-4">
        {list.length === 0 && <div className="card" style={{ gridColumn: "1/-1" }}><div className="empty">Nothing yet. Drop a logo, a photo, or a brand doc above.</div></div>}
        {list.map((a) => {
          const I = typeIcon[a.type] || FileIcon;
          const url = signed[a.storage_path];
          return (
            <div key={a.id} className="card hover" style={{ overflow: "hidden" }}>
              <div style={{ height: 130, background: "var(--canvas)", display: "grid", placeItems: "center", borderBottom: "1px solid var(--line)" }}>
                {url ? <img src={url} alt={a.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <I size={30} color="var(--faint)" />}
              </div>
              <div style={{ padding: 12 }}>
                <div className="between">
                  <span style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
                  {a.consent_required && <Badge tone="red">Private</Badge>}
                </div>
                <div className="flex" style={{ marginTop: 6, gap: 6 }}>
                  <Badge tone="gray">{a.type}</Badge>
                  {a.brand && <span className={`chip ${a.brand}`}><span className="bdot" /> {a.brand}</span>}
                </div>
                {a.description && <div className="faint" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.4, maxHeight: 32, overflow: "hidden" }}>{a.description.replace(/^BENEFICIARY:\s*/i, "")}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
