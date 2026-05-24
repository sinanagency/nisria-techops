import Shell from "../../components/Shell";
import { Card, Badge } from "../../components/ui";
import { admin, date } from "../../lib/supabase-admin";
import { composePost, aiDraft, setPostStatus, generateGraphic } from "./actions";
import { Instagram, Facebook, Sparkles, ImagePlus, Wand2 } from "lucide-react";

export const dynamic = "force-dynamic";

// Social-first: Instagram + Facebook only.
const CHANNELS = [
  { key: "instagram", label: "Instagram", Icon: Instagram },
  { key: "facebook", label: "Facebook", Icon: Facebook },
];

export default async function Content() {
  const db = admin();
  const { data: brands } = await db.from("brands").select("id,name").order("name");
  const { data: posts } = await db
    .from("content_posts")
    .select("*,brand:brands(name)")
    .order("created_at", { ascending: false })
    .limit(100);
  const list = posts || [];

  // Media from Library: images only, newest first.
  const { data: imgAssets } = await db
    .from("assets")
    .select("id,title,storage_path,brand")
    .eq("type", "image")
    .not("storage_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(24);
  const mediaList = (imgAssets || []) as any[];

  // Signed thumbnails for the private bucket.
  const mediaSigned: Record<string, string> = {};
  if (mediaList.length) {
    const { data } = await db.storage
      .from("assets")
      .createSignedUrls(mediaList.map((a) => a.storage_path), 3600);
    (data || []).forEach((s: any, i: number) => {
      if (s?.signedUrl) mediaSigned[mediaList[i].storage_path] = s.signedUrl;
    });
  }

  // Signed previews for posts that already have an attached image.
  const postPaths = list.filter((p: any) => p.image_url).map((p: any) => p.image_url);
  const postSigned: Record<string, string> = {};
  if (postPaths.length) {
    const { data } = await db.storage.from("assets").createSignedUrls(postPaths, 3600);
    (data || []).forEach((s: any, i: number) => {
      if (s?.signedUrl) postSigned[postPaths[i]] = s.signedUrl;
    });
  }

  const cols = [
    { key: "scheduled", label: "Scheduled" },
    { key: "draft", label: "Drafts" },
    { key: "posted", label: "Posted" },
  ];

  return (
    <Shell title="Content" sub="Drop a post in, attach a photo from the Library, and the system queues it to Instagram and Facebook">
      <Card title="Compose">
        <form className="card-pad stack" style={{ gap: 14 }}>
          <div className="flex">
            <select name="brand_id" style={{ maxWidth: 200 }}>
              {(brands || []).map((b: any) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <input type="datetime-local" name="scheduled_for" style={{ maxWidth: 230 }} />
          </div>

          <div className="flex" style={{ flexWrap: "wrap", gap: 14 }}>
            {CHANNELS.map(({ key, label, Icon }) => (
              <label key={key} className="flex" style={{ gap: 6, fontWeight: 500 }}>
                <input type="checkbox" name="channels" value={key} style={{ width: "auto" }} defaultChecked />
                <Icon size={15} /> {label}
              </label>
            ))}
          </div>

          <textarea name="body" rows={3} placeholder="Write the post, or type a brief and hit 'Draft with AI'…" />

          {/* Media from Library — pick one image to attach */}
          <div>
            <div className="flex" style={{ marginBottom: 8 }}>
              <ImagePlus size={15} color="var(--teal-700)" />
              <span style={{ fontWeight: 600, fontSize: 13 }}>Attach media from Library</span>
              <span className="muted" style={{ fontSize: 11.5 }}>pick one image</span>
            </div>
            {mediaList.length === 0 ? (
              <div className="muted" style={{ fontSize: 12.5 }}>
                No images in the Library yet. Upload photos in <a href="/library">Library</a> and they'll show here.
              </div>
            ) : (
              <div className="flex" style={{ gap: 10, overflowX: "auto", paddingBottom: 4 }}>
                <label
                  className="flex"
                  style={{ flex: "0 0 auto", width: 92, height: 92, borderRadius: 12, border: "2px dashed var(--line-2)", justifyContent: "center", cursor: "pointer", color: "var(--muted)", fontSize: 11.5, textAlign: "center", gap: 5 }}
                >
                  <input type="radio" name="asset_path" value="" defaultChecked style={{ width: "auto" }} />
                  None
                </label>
                {mediaList.map((a) => {
                  const url = mediaSigned[a.storage_path];
                  return (
                    <label
                      key={a.id}
                      title={a.title}
                      style={{ flex: "0 0 auto", width: 92, height: 92, borderRadius: 12, overflow: "hidden", border: "1px solid var(--line)", cursor: "pointer", position: "relative" }}
                    >
                      {url ? (
                        <img src={url} alt={a.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <span style={{ display: "grid", placeItems: "center", height: "100%", fontSize: 10.5, color: "var(--faint)", padding: 4, textAlign: "center" }}>{a.title}</span>
                      )}
                      <input
                        type="radio"
                        name="asset_path"
                        value={a.storage_path}
                        style={{ position: "absolute", top: 6, left: 6, width: "auto", margin: 0, accentColor: "var(--teal)" }}
                      />
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex" style={{ flexWrap: "wrap" }}>
            <button className="btn teal" formAction={composePost} type="submit">Add to queue</button>
            <button className="btn ghost" formAction={aiDraft} type="submit"><Sparkles size={15} /> Draft with AI</button>
            <button className="btn ghost" formAction={generateGraphic} type="submit"><Wand2 size={15} /> Generate graphic</button>
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            Generate graphic uses Canva once connected. Until then it logs a "Canva connect pending" note (no error).
          </div>
        </form>
      </Card>

      <div className="grid cols-3" style={{ marginTop: 16 }}>
        {cols.map((col) => {
          const items = list.filter((p: any) => p.status === col.key);
          return (
            <div className="card" key={col.key}>
              <div className="card-h">{col.label}<Badge>{items.length}</Badge></div>
              <div className="card-pad stack">
                {items.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>Empty.</div>}
                {items.map((p: any) => {
                  const img = p.image_url ? postSigned[p.image_url] : null;
                  return (
                    <div key={p.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
                      <div className="between">
                        <Badge tone="purple">{p.brand?.name || "—"}</Badge>
                        <span className="muted" style={{ fontSize: 11.5 }}>{(p.channels || []).join(" · ")}</span>
                      </div>
                      {img && (
                        <img src={img} alt="" style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 8, marginTop: 8 }} />
                      )}
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
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        Auto-publishing to Instagram and Facebook runs through n8n once each platform's posting API is connected. Scheduling, drafting, and media attach work now. Every post you create is also filed into the Library.
      </div>
    </Shell>
  );
}
