import Shell from "../../components/Shell";
import { Card, Badge } from "../../components/ui";
import { admin } from "../../lib/supabase-admin";
import FileCard from "../../components/FileCard";
import DocReader from "../../components/DocReader";
import IngestDock from "../../components/IngestDock";
import { FolderOpen, Search, ChevronLeft, FileText, ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

const clean = (t: string) => (t || "").replace(/^\[NS\]\s*/, "").replace(/^Copy of\s*/i, "").replace(/\.(pdf|docx?|doc|xlsx?|csv|pptx?)$/i, "").trim();

const TYPE_LABEL: Record<string, string> = {
  bank_statement: "Bank statements", invoice: "Invoices", receipt: "Receipts",
  contract: "Contracts", budget: "Budgets", expenses: "Expenses", registration: "Registration",
  policy: "Policies", grant: "Grants", report: "Reports", database: "Databases",
  spreadsheet: "Spreadsheets", presentation: "Decks", document: "Documents",
};

function qs(base: Record<string, string>, patch: Record<string, string | undefined>) {
  const next = { ...base };
  for (const [k, v] of Object.entries(patch)) { if (!v) delete next[k]; else next[k] = v; }
  const s = new URLSearchParams(next).toString();
  return s ? `/filing?${s}` : "/filing";
}

export default async function Filing({ searchParams }: { searchParams?: { [k: string]: string | string[] | undefined } }) {
  const sp = searchParams || {};
  const one = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined)) || "";
  const folder = one("folder"), q = one("q"), type = one("type");

  const db = admin();
  // never pull extracted_text into a list (it can be 200k chars/row); only metadata
  const COLS = "id,title,folder,subfolder,doc_type,brand,mime,size_bytes,drive_url,drive_file_id,doc_date,modified_at,summary";
  const { data } = await db.from("documents").select(COLS).order("modified_at", { ascending: false }).limit(2000);
  const docs = (data || []) as any[];

  // counts per category off the full set (for the folder cards)
  const counts: Record<string, number> = {};
  for (const d of docs) counts[d.folder || "General"] = (counts[d.folder || "General"] || 0) + 1;

  // ---- global CONTENT search: query title + extracted text across every folder,
  // show a snippet around the hit, open the result natively in the reader ----
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    const { data: hits } = await db
      .from("documents")
      .select("id,title,folder,doc_type,drive_url,extracted_text")
      .or(`title.ilike.${like},extracted_text.ilike.${like}`)
      .limit(51); // L-5: fetch one past the display cap so we can honestly say "50+"
    const needle = q.toLowerCase();
    const allResults = (hits || []).map((d: any) => {
      const txt = d.extracted_text || "";
      const i = txt.toLowerCase().indexOf(needle);
      const snippet = i >= 0 ? (i > 60 ? "…" : "") + txt.slice(Math.max(0, i - 60), i + 140).replace(/\s+/g, " ").trim() + "…" : "";
      return { id: d.id, title: d.title, folder: d.folder, doc_type: d.doc_type, drive_url: d.drive_url, snippet, inBody: i >= 0 };
    });
    // L-5: the heading used to say "N documents match" off a hard limit(50), silently dropping
    // the rest once there were 50+ hits. Show "50+" and render the first 50.
    const capped = allResults.length > 50;
    const results = capped ? allResults.slice(0, 50) : allResults;
    return (
      <Shell title="Search" sub={`${capped ? "50+" : results.length} ${results.length === 1 ? "document matches" : "documents match"} “${q}”${capped ? " · showing the first 50, narrow your search to see more" : ""}`}>
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <form method="GET" action="/filing" className="flex" style={{ gap: 8 }}>
            <input name="q" defaultValue={q} placeholder="Search across every document…" style={{ maxWidth: 380 }} autoFocus />
            <button className="btn ghost sm" type="submit"><Search size={14} /> Search</button>
            <a className="pill" href="/filing">Clear</a>
          </form>
        </div>
        {results.length === 0 ? (
          <Card><div className="empty">Nothing matches “{q}”. The content backfill may still be running for some files.</div></Card>
        ) : (
          <Card title="Results">
            <div className="stack" style={{ gap: 0 }}>
              {results.map((r: any) => (
                <DocReader key={r.id} doc={{ id: r.id, title: clean(r.title), drive_url: r.drive_url, icon: "file" }} className="docrow">
                  <span style={{ display: "block", padding: "12px 22px", borderTop: "1px solid var(--line)" }}>
                    <span className="between">
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{clean(r.title)}</span>
                      <span className="flex" style={{ gap: 8, flexShrink: 0 }}>
                        <Badge tone="gray">{r.folder || "General"}</Badge>
                        {r.inBody && <Badge tone="teal">in text</Badge>}
                      </span>
                    </span>
                    {r.snippet && <span className="muted" style={{ display: "block", fontSize: 12, lineHeight: 1.55, marginTop: 4 }}>{r.snippet}</span>}
                  </span>
                </DocReader>
              ))}
            </div>
          </Card>
        )}
      </Shell>
    );
  }

  // ---- folder view: a card per Drive area ----
  if (!folder) {
    const cats = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    // dominant document types per folder, derived from already-fetched metadata
    const typesByFolder: Record<string, string[]> = {};
    for (const c of cats) {
      const tc: Record<string, number> = {};
      for (const d of docs) {
        if ((d.folder || "General") !== c || !d.doc_type) continue;
        tc[d.doc_type] = (tc[d.doc_type] || 0) + 1;
      }
      typesByFolder[c] = Object.keys(tc).sort((a, b) => tc[b] - tc[a]).slice(0, 3);
    }

    return (
      <Shell title="Filing" sub={`${docs.length} documents, filed from the Drive`}>
        {/* ingest affordance: the one pipeline to drop / speak / paste documents */}
        <div style={{ marginBottom: 18 }}>
          <IngestDock />
        </div>

        {/* search across every document */}
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <form method="GET" action="/filing" className="between" style={{ gap: 12 }}>
            <div className="flex" style={{ gap: 10, flex: 1, minWidth: 0 }}>
              <Search size={16} style={{ color: "var(--faint)", flexShrink: 0 }} />
              <input name="q" placeholder="Search across every document, by title or by content…" style={{ flex: 1, minWidth: 0, border: 0, background: "none", outline: "none", font: "inherit", fontSize: 14 }} />
            </div>
            <button className="btn ghost sm" type="submit" style={{ flexShrink: 0 }}><Search size={14} /> Search</button>
          </form>
        </div>

        {docs.length === 0 ? (
          <Card><div className="empty">No documents filed yet. They appear here as the Drive is extracted.</div></Card>
        ) : (
          <>
            <div className="between" style={{ marginBottom: 12 }}>
              <span className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>Folders</span>
              <span className="faint" style={{ fontSize: 12 }}>{cats.length} {cats.length === 1 ? "category" : "categories"}</span>
            </div>
            <div className="grid cols-3">
              {cats.map((c) => (
                <a key={c} className="card hover card-pad" href={qs({}, { folder: c })} style={{ textDecoration: "none" }}>
                  <div className="between" style={{ alignItems: "flex-start", gap: 11 }}>
                    <div className="flex" style={{ gap: 11, minWidth: 0 }}>
                      <span className="aico teal" style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0 }}><FolderOpen size={19} /></span>
                      <div style={{ minWidth: 0 }}>
                        <div className="strong" style={{ fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c}</div>
                        <div className="disp2 faint" style={{ fontSize: 12.5, marginTop: 2 }}>{counts[c]} {counts[c] === 1 ? "document" : "documents"}</div>
                      </div>
                    </div>
                    <ArrowRight size={15} className="faint" style={{ flexShrink: 0, marginTop: 2 }} />
                  </div>
                  {typesByFolder[c].length > 0 && (
                    <div className="flex wrap" style={{ gap: 6, marginTop: 12 }}>
                      {typesByFolder[c].map((t) => (
                        <Badge key={t} tone="gray">{TYPE_LABEL[t] || t}</Badge>
                      ))}
                    </div>
                  )}
                </a>
              ))}
            </div>
          </>
        )}
      </Shell>
    );
  }

  // ---- file view for the chosen folder ----
  const inFolder = docs.filter((d) => (d.folder || "General") === folder);
  const types = [...new Set(inFolder.map((d) => d.doc_type).filter(Boolean))] as string[];
  let rows = inFolder;
  if (type) rows = rows.filter((d) => d.doc_type === type);
  if (q) rows = rows.filter((d) => (d.title || "").toLowerCase().includes(q.toLowerCase()));

  const base: Record<string, string> = { folder };
  if (type) base.type = type;
  if (q) base.q = q;

  // group the visible rows by document type for a tidy, scannable surface
  const groups: { key: string; label: string; items: any[] }[] = [];
  const seen: Record<string, any[]> = {};
  for (const d of rows) {
    const k = d.doc_type || "_other";
    if (!seen[k]) { seen[k] = []; groups.push({ key: k, label: d.doc_type ? (TYPE_LABEL[d.doc_type] || d.doc_type) : "Other documents", items: seen[k] }); }
    seen[k].push(d);
  }
  groups.sort((a, b) => b.items.length - a.items.length);

  return (
    <Shell title={folder} sub={`${rows.length} ${rows.length === 1 ? "document" : "documents"} · Filing`}>
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="stack" style={{ gap: 12 }}>
          <a className="pill" href="/filing" style={{ alignSelf: "flex-start" }}><ChevronLeft size={13} /> All folders</a>
          <form method="GET" action="/filing" className="flex" style={{ gap: 8 }}>
            <input type="hidden" name="folder" value={folder} />
            {type && <input type="hidden" name="type" value={type} />}
            <input name="q" defaultValue={q} placeholder="Search documents…" style={{ maxWidth: 320 }} />
            <button className="btn ghost sm" type="submit"><Search size={14} /> Search</button>
            {q && <a className="pill" href={qs(base, { q: undefined })}>Clear</a>}
          </form>
          {types.length > 1 && (
            <div className="flex wrap" style={{ gap: 6 }}>
              <span className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", minWidth: 50 }}>Type</span>
              <a className={`pill ${!type ? "on" : ""}`} href={qs(base, { type: undefined })}>All</a>
              {types.map((t) => (
                <a key={t} className={`pill ${type === t ? "on" : ""}`} href={qs(base, { type: t })}>{TYPE_LABEL[t] || t}</a>
              ))}
            </div>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <Card><div className="empty"><FileText size={20} color="var(--faint)" /><div style={{ marginTop: 8 }}>No documents match.</div></div></Card>
      ) : (
        <div className="stack" style={{ gap: 24 }}>
          {groups.map((g) => (
            <div key={g.key}>
              <div className="between" style={{ marginBottom: 12 }}>
                <span className="flex" style={{ gap: 8 }}>
                  <span className="strong" style={{ fontSize: 14 }}>{g.label}</span>
                  <Badge tone="gray">{g.items.length}</Badge>
                </span>
              </div>
              <div className="grid cols-3">
                {g.items.map((d) => <FileCard key={d.id} doc={d} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}
