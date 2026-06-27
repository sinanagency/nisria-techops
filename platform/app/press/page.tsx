import Shell from "../../components/Shell";
import { Badge } from "../../components/ui";
import { admin, date } from "../../lib/supabase-admin";
import { addPressItem, deletePressItem } from "./actions";
import { Mic, Newspaper, Video, Radio, Headphones, Award, AtSign, Star, Plus, ExternalLink, Trash2 } from "lucide-react";

export const dynamic = "force-dynamic";

const TYPE_META: Record<string, { label: string; icon: any }> = {
  interview: { label: "Interview", icon: Mic },
  article: { label: "Article", icon: Newspaper },
  podcast: { label: "Podcast", icon: Headphones },
  video: { label: "Video", icon: Video },
  social: { label: "Social", icon: AtSign },
  feature: { label: "Feature", icon: Star },
  award: { label: "Award", icon: Award },
  mention: { label: "Mention", icon: Radio },
};
const BRANDS = [
  { key: "nisria", label: "Nisria" }, { key: "maisha", label: "Maisha" }, { key: "ahadi", label: "AHADI" },
  { key: "personal", label: "Nur (personal)" }, { key: "other", label: "Past projects" },
];

export default async function Press({ searchParams }: { searchParams?: { [k: string]: string | string[] | undefined } }) {
  const sp = searchParams || {};
  const one = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined)) || "";
  const q = one("q").trim().toLowerCase();
  const brand = one("brand");
  const type = one("type");

  let list: any[] = [];
  try {
    const { data } = await admin().from("press_items").select("*").order("published_on", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(500);
    list = (data || []) as any[];
  } catch { list = []; }

  const visible = list.filter((p) => {
    if (brand && (p.brand || "") !== brand) return false;
    if (type && (p.media_type || "") !== type) return false;
    if (q) {
      const hay = `${p.title || ""} ${p.outlet || ""} ${p.subject || ""} ${p.description || ""} ${(p.tags || []).join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const brandCount: Record<string, number> = {};
  for (const p of list) if (p.brand) brandCount[p.brand] = (brandCount[p.brand] || 0) + 1;

  const qs = (patch: Record<string, string | undefined>) => {
    const next: Record<string, string> = {};
    if (brand) next.brand = brand; if (type) next.type = type; if (q) next.q = q;
    for (const [k, v] of Object.entries(patch)) { if (!v) delete next[k]; else next[k] = v; }
    const s = new URLSearchParams(next).toString();
    return s ? `/press?${s}` : "/press";
  };

  return (
    <Shell title="Press & Media" sub="Every interview, feature and podcast in one place — tagged by brand." action={<Badge tone="peri">{list.length} features</Badge>}>
      {/* add form */}
      <details className="card" style={{ marginBottom: 16 }}>
        <summary className="flex" style={{ gap: 8, alignItems: "center", cursor: "pointer", padding: "14px 18px", userSelect: "none", fontWeight: 600, fontSize: 14 }}>
          <Plus size={15} color="var(--peri-700)" /> Add a press feature
        </summary>
        <form action={addPressItem} className="stack" style={{ gap: 10, padding: "4px 18px 18px" }}>
          <div className="grid" style={{ gridTemplateColumns: "2fr 1fr", gap: 10 }}>
            <input name="title" placeholder="Title (e.g. Nur on the Founders podcast)" required />
            <input name="outlet" placeholder="Outlet (Spotify, Guardian…)" />
          </div>
          <input name="url" placeholder="https://… link to the interview/article" />
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <select name="media_type" defaultValue="interview">
              {Object.entries(TYPE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
            <select name="brand" defaultValue="">
              <option value="">No brand</option>
              {BRANDS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
            <input name="published_on" placeholder="YYYY-MM-DD" />
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <input name="subject" placeholder="Featured: who/what (e.g. Maisha)" />
            <input name="tags" placeholder="tags, comma, separated" />
          </div>
          <textarea name="description" placeholder="Short description (optional)" rows={2} />
          <div><button className="btn teal" type="submit"><Plus size={15} /> Save feature</button></div>
        </form>
      </details>

      {/* filters */}
      {list.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <div className="stack" style={{ gap: 12 }}>
            <form method="GET" action="/press" className="flex" style={{ gap: 8 }}>
              {brand && <input type="hidden" name="brand" value={brand} />}
              {type && <input type="hidden" name="type" value={type} />}
              <input name="q" defaultValue={one("q")} placeholder="Search title, outlet, subject…" style={{ maxWidth: 380 }} />
              <button className="btn ghost sm" type="submit">Search</button>
              {q && <a className="pill" href={qs({ q: undefined })}>Clear</a>}
            </form>
            <div className="flex wrap" style={{ gap: 6 }}>
              <span className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", minWidth: 50 }}>Brand</span>
              <a className={`pill ${!brand ? "on" : ""}`} href={qs({ brand: undefined })}>All</a>
              {BRANDS.filter((b) => brandCount[b.key]).map((b) => (
                <a key={b.key} className={`pill ${brand === b.key ? "on" : ""}`} href={qs({ brand: b.key })}>{b.label} <span className="faint" style={{ marginLeft: 4 }}>{brandCount[b.key]}</span></a>
              ))}
            </div>
            <div className="flex wrap" style={{ gap: 6 }}>
              <span className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", minWidth: 50 }}>Type</span>
              <a className={`pill ${!type ? "on" : ""}`} href={qs({ type: undefined })}>All</a>
              {Object.entries(TYPE_META).filter(([k]) => list.some((p) => p.media_type === k)).map(([k, m]) => (
                <a key={k} className={`pill ${type === k ? "on" : ""}`} href={qs({ type: k })}>{m.label}</a>
              ))}
            </div>
          </div>
        </div>
      )}

      {list.length === 0 && (
        <div className="card"><div className="empty"><Newspaper size={20} color="var(--faint)" /><div style={{ marginTop: 8 }}>No press saved yet. Add a feature above, or send Sasa the link on WhatsApp (e.g. a Spotify interview) and she&rsquo;ll file it here, tagged by brand.</div></div></div>
      )}
      {list.length > 0 && visible.length === 0 && <div className="card"><div className="empty">No features match these filters.</div></div>}

      <div className="grid cols-3">
        {visible.map((p) => {
          const meta = TYPE_META[p.media_type] || TYPE_META.feature;
          const I = meta.icon;
          return (
            <div key={p.id} className="card hover" style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div style={{ height: 110, background: p.thumbnail_url ? "#000" : "var(--peri-grad)", display: "grid", placeItems: "center", borderBottom: "1px solid var(--line)", position: "relative" }}>
                {p.thumbnail_url ? <img src={p.thumbnail_url} alt={p.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <I size={28} color="var(--peri-700)" />}
                <span style={{ position: "absolute", top: 8, left: 8 }}><Badge tone="peri">{meta.label}</Badge></span>
              </div>
              <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                <div className="between">
                  <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>{p.title}</span>
                  {p.brand && p.brand !== "personal" && p.brand !== "other" && <span className={`chip ${p.brand}`}><span className="bdot" /> {p.brand}</span>}
                </div>
                <div className="faint" style={{ fontSize: 11.5 }}>{[p.outlet, p.published_on ? date(p.published_on) : null].filter(Boolean).join(" · ") || "—"}</div>
                {p.subject && <div className="faint" style={{ fontSize: 11.5 }}>Featuring {p.subject}</div>}
                {p.description && <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.4, maxHeight: 50, overflow: "hidden" }}>{p.description}</div>}
                {(p.tags || []).length > 0 && <div className="flex wrap" style={{ gap: 4 }}>{p.tags.slice(0, 5).map((t: string) => <span key={t} className="badge gray" style={{ fontSize: 10 }}>{t}</span>)}</div>}
                <div className="flex" style={{ gap: 6, marginTop: "auto", paddingTop: 8, alignItems: "center" }}>
                  {p.url && <a className="pill" href={p.url} target="_blank" rel="noreferrer" style={{ flex: 1, justifyContent: "center" }}><ExternalLink size={12} /> Open</a>}
                  <form action={deletePressItem}><input type="hidden" name="id" value={p.id} /><button className="btn ghost sm" type="submit" title="Delete" style={{ padding: "5px 7px" }}><Trash2 size={13} /></button></form>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
