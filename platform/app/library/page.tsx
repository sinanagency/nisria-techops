import Shell from "../../components/Shell";
import { Badge } from "../../components/ui";
import { admin } from "../../lib/supabase-admin";
import { uploadAsset } from "./actions";
import { UploadCloud, FileText, Film, File as FileIcon, FolderOpen, ImageIcon, Search, ChevronRight, CheckCircle2 } from "lucide-react";

export const dynamic = "force-dynamic";

const fmtSize = (b: number) => b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
const typeIcon: any = { image: ImageIcon, pdf: FileText, document: FileText, video: Film, other: FileIcon };

export default async function Library({ searchParams }: { searchParams?: { [k: string]: string | string[] | undefined } }) {
  const sp = searchParams || {};
  const one = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined)) || "";
  const cat = one("cat");
  const q = one("q");

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

  // GROUP BY SHELF: ingest tags each asset with where it matches (finance,
  // programs, reports, ...). Show the Library organized by that shelf instead of
  // one flat pile, so a filed doc sits with its kind. Untagged/older assets fall
  // back to media (images) or general.
  const CATS: { key: string; label: string }[] = [
    { key: "finance", label: "Finance" },
    { key: "programs", label: "Programs" },
    { key: "events", label: "Events" },
    { key: "reports", label: "Reports" },
    { key: "branding", label: "Branding" },
    { key: "people", label: "People" },
    { key: "legal", label: "Legal" },
    { key: "media", label: "Media" },
    { key: "general", label: "General" },
  ];
  const catOf = (a: any): string => {
    const tags: string[] = Array.isArray(a.tags) ? a.tags : [];
    const hit = CATS.find((c) => tags.includes(c.key));
    if (hit) return hit.key;
    return a.type === "image" ? "media" : "general";
  };

  // apply the top-of-page search + category filter (uniform, URL-persisted) before grouping
  const needle = q.trim().toLowerCase();
  const visible = list.filter((a) => {
    if (cat && catOf(a) !== cat) return false;
    if (needle) {
      const hay = `${a.title || ""} ${a.description || ""} ${a.brand || ""} ${a.type || ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  const grouped = CATS
    .map((c) => ({ ...c, items: visible.filter((a) => catOf(a) === c.key) }))
    .filter((g) => g.items.length);
  // when searching or filtered to one shelf, auto-open every folder so results are
  // visible; otherwise folders start closed so the page reads as tidy shelves, not
  // one long pile. The first/biggest shelf opens by default for a useful landing.
  const libFiltered = !!(cat || needle);

  // counts per shelf off the full set, for the filter chips
  const catCount: Record<string, number> = {};
  for (const a of list) catCount[catOf(a)] = (catCount[catOf(a)] || 0) + 1;
  const activeCats = CATS.filter((c) => catCount[c.key]);

  const qs = (patch: Record<string, string | undefined>) => {
    const next: Record<string, string> = {};
    if (cat) next.cat = cat;
    if (q) next.q = q;
    for (const [k, v] of Object.entries(patch)) { if (!v) delete next[k]; else next[k] = v; }
    const s = new URLSearchParams(next).toString();
    return s ? `/library?${s}` : "/library";
  };

  return (
    <Shell title="Library" sub="Drop content here. Sasa files it, learns it, and reaches for it when writing." action={<Badge tone="teal">{list.length} assets</Badge>}>
      {/* upload + ingest zone (existing uploadAsset wiring preserved) */}
      <div className="grid" style={{ gridTemplateColumns: "1fr 320px", gap: 16, marginBottom: 16 }}>
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
            <div className="ftitle disp2">{list.length} files</div>
            <div className="fmeta">{fmtSize(totalSize)} stored · all private, RLS-gated</div>
          </div>
          {/* L-4: gate the badge on the REAL service-account env, not a hardcoded "connected".
              A misconfigured/rotated key must not show a green "connected · syncs daily" lie. */}
          <div className="card card-pad">
            <div className="flex" style={{ marginBottom: 6 }}><CheckCircle2 size={16} color={process.env.GOOGLE_SERVICE_ACCOUNT_B64 ? "var(--teal-700)" : "var(--faint)"} /><span style={{ fontWeight: 600, fontSize: 13.5 }}>Google Drive</span><span style={{ marginLeft: "auto" }}>{process.env.GOOGLE_SERVICE_ACCOUNT_B64 ? <Badge tone="green">connected</Badge> : <Badge tone="gray">not connected</Badge>}</span></div>
            <div className="muted" style={{ fontSize: 12 }}>{process.env.GOOGLE_SERVICE_ACCOUNT_B64 ? "Connected via service account. Drive files sync daily through the same ingestion and memory." : "Not connected. Set the service-account key (GOOGLE_SERVICE_ACCOUNT_B64) to enable the daily Drive sync."}</div>
          </div>
        </div>
      </div>

      {/* search + shelf filter on top of the grid */}
      {list.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <div className="stack" style={{ gap: 12 }}>
            <form method="GET" action="/library" className="flex" style={{ gap: 8 }}>
              {cat && <input type="hidden" name="cat" value={cat} />}
              <input name="q" defaultValue={q} placeholder="Search assets by name, caption, or brand…" style={{ maxWidth: 380 }} />
              <button className="btn ghost sm" type="submit"><Search size={14} /> Search</button>
              {q && <a className="pill" href={qs({ q: undefined })}>Clear</a>}
            </form>
            <div className="flex wrap" style={{ gap: 6 }}>
              <span className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", minWidth: 50 }}>Shelf</span>
              <a className={`pill ${!cat ? "on" : ""}`} href={qs({ cat: undefined })}>All <span className="faint" style={{ marginLeft: 4 }}>{list.length}</span></a>
              {activeCats.map((c) => (
                <a key={c.key} className={`pill ${cat === c.key ? "on" : ""}`} href={qs({ cat: c.key })}>
                  {c.label} <span className="faint" style={{ marginLeft: 4 }}>{catCount[c.key]}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* grouped by shelf */}
      {list.length === 0 && <div className="card"><div className="empty">Nothing yet. Drop a logo, a photo, or a brand doc above.</div></div>}
      {list.length > 0 && grouped.length === 0 && (
        <div className="card"><div className="empty"><Search size={20} color="var(--faint)" /><div style={{ marginTop: 8 }}>No assets match{q ? ` “${q}”` : ""}{cat ? ` in ${CATS.find((c) => c.key === cat)?.label || cat}` : ""}.</div></div></div>
      )}
      {grouped.map((g, i) => (
        <details key={g.key} className="lib-folder" open={i === 0 || libFiltered} style={{ marginBottom: 12 }}>
          <summary className="flex lib-folder-head" style={{ gap: 8, alignItems: "center", cursor: "pointer", padding: "9px 4px", userSelect: "none" }}>
            <ChevronRight className="lib-caret" size={15} color="var(--muted)" />
            <span style={{ fontWeight: 600, fontSize: 14 }}>{g.label}</span>
            <Badge tone="gray">{g.items.length}</Badge>
          </summary>
          <div className="grid cols-4" style={{ marginTop: 4 }}>
            {g.items.map((a) => {
              const I = typeIcon[a.type] || FileIcon;
              const url = signed[a.storage_path];
              return (
                <div key={a.id} className="card hover" style={{ overflow: "hidden" }}>
                  <div style={{ height: 130, background: "var(--canvas)", display: "grid", placeItems: "center", borderBottom: "1px solid var(--line)", position: "relative" }}>
                    {url ? <img src={url} alt={a.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <I size={30} color="var(--faint)" />}
                    <span style={{ position: "absolute", top: 8, left: 8 }}><Badge tone="gray">{a.type}</Badge></span>
                    {a.consent_required && <span style={{ position: "absolute", top: 8, right: 8 }}><Badge tone="red">Private</Badge></span>}
                  </div>
                  <div style={{ padding: 12 }}>
                    <div className="between">
                      <span style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
                      {a.brand && <span className={`chip ${a.brand}`}><span className="bdot" /> {a.brand}</span>}
                    </div>
                    {a.description && <div className="faint" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.4, maxHeight: 32, overflow: "hidden" }}>{a.description.replace(/^BENEFICIARY:\s*/i, "")}</div>}
                    {url && (
                      <a className="pill" href={url} target="_blank" rel="noreferrer" style={{ marginTop: 10, width: "100%", justifyContent: "center" }}>
                        <ImageIcon size={12} /> Open
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      ))}
    </Shell>
  );
}
