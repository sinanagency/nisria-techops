import Shell from "../../components/Shell";
import { Card, Stat, Badge, statusTone } from "../../components/ui";
import { admin, money } from "../../lib/supabase-admin";
import { addItem, generateListing } from "./actions";
import { Package, Sparkles, BookOpen } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Inventory() {
  const db = admin();
  const { data } = await db.from("inventory").select("*").order("name").limit(500);

  // Pull the generated Folklore listings from the Library so we can show each
  // item's latest draft copy inline. Match on the asset title we wrote on save.
  const { data: listings } = await db
    .from("assets")
    .select("title,description,created_at")
    .eq("source", "inventory")
    .order("created_at", { ascending: false })
    .limit(500);
  const latestFor = (name: string) =>
    (listings || []).find((a: any) => a.title === `Folklore listing — ${name}`) || null;

  const items: any[] = data || [];

  // Drill-to-core summary: lead with the few counts that tell Nur whether stock
  // needs attention. Status drives this, with quantity as the fallback signal.
  const stockState = (it: any): "in_stock" | "low" | "out" => {
    const s = (it.status || "").toLowerCase();
    if (s === "out" || Number(it.quantity) <= 0) return "out";
    if (s === "low") return "low";
    return "in_stock";
  };
  const lowCount = items.filter((it) => stockState(it) === "low").length;
  const outCount = items.filter((it) => stockState(it) === "out").length;
  const stateMeta: Record<string, { tone: "green" | "gold" | "red"; label: string }> = {
    in_stock: { tone: "green", label: "in stock" },
    low: { tone: "gold", label: "low" },
    out: { tone: "red", label: "out" },
  };

  // Group the list by category so the grid reads as a catalogue, not a dump.
  const groups = new Map<string, any[]>();
  for (const it of items) {
    const key = it.category || it.collection || "Uncategorized";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(it);
  }
  const categories = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <Shell title="Inventory" sub={`${items.length} items · Maisha → The Folklore`}>
      {items.length === 0 ? (
        <Card title="Stock">
          <div className="empty">
            <div style={{ marginBottom: 14 }}>No inventory yet. Add your first Maisha piece to start the Folklore copy engine.</div>
          </div>
          <div className="card-pad" style={{ borderTop: "1px solid var(--line)" }}>
            <AddForm />
          </div>
        </Card>
      ) : (
        <>
          <div className="grid cols-3">
            <Stat label="Total items" value={items.length} delta={`${categories.length} categories`} />
            <Stat
              label="Low stock"
              value={<span className="disp2">{lowCount}</span>}
              delta={lowCount ? "needs a restock check" : "all healthy"}
            />
            <Stat
              label="Out of stock"
              value={<span className="disp2">{outCount}</span>}
              delta={outCount ? "unavailable on The Folklore" : "nothing out"}
            />
          </div>

          {categories.map(([category, rows]) => (
            <div key={category} style={{ marginTop: 22 }}>
              <div className="between" style={{ marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 15 }}>{category}</h3>
                <span className="faint" style={{ fontSize: 12.5 }}>{rows.length} {rows.length === 1 ? "item" : "items"}</span>
              </div>

              <div className="grid cols-2">
                {rows.map((it: any) => {
                  const listing = latestFor(it.name);
                  const meta = stateMeta[stockState(it)];
                  return (
                    <div className="card card-pad" key={it.id}>
                      <div className="between">
                        <div className="flex" style={{ gap: 8, alignItems: "center" }}>
                          <Package size={16} />
                          <strong style={{ fontSize: 15 }}>{it.name}</strong>
                        </div>
                        <Badge tone={statusTone(meta.label)}>{meta.label}</Badge>
                      </div>
                      <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                        {[it.collection, it.sku && `SKU ${it.sku}`].filter(Boolean).join(" · ") || "—"}
                        {it.unit_price ? ` · ${money(it.unit_price)}` : ""}
                        {` · qty ${Number(it.quantity) || 0}`}
                      </div>

                      <div style={{ marginTop: 6 }}>
                        {it.folklore_listed ? <Badge tone="green">listed on Folklore</Badge> : <Badge tone="gray">not listed</Badge>}
                      </div>

                      <form action={generateListing} className="stack" style={{ marginTop: 12 }}>
                        <input type="hidden" name="id" value={it.id} />
                        <textarea
                          name="story"
                          placeholder="Optional: maker story, materials, the community behind this piece..."
                          rows={2}
                          style={{ width: "100%", resize: "vertical" }}
                        />
                        <button className="btn teal sm" type="submit" style={{ alignSelf: "flex-start" }}>
                          <Sparkles size={14} /> {listing ? "Regenerate Folklore listing" : "Generate Folklore listing"}
                        </button>
                      </form>

                      {listing && (
                        <div className="card-pad" style={{ marginTop: 12, background: "var(--canvas)", borderRadius: 12 }}>
                          <div className="flex faint" style={{ gap: 6, alignItems: "center", fontSize: 11.5, fontWeight: 600, marginBottom: 8 }}>
                            <BookOpen size={13} /> SAVED TO LIBRARY · MAISHA
                          </div>
                          <div style={{ fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{listing.description}</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div style={{ marginTop: 22, maxWidth: 520 }}>
            <Card title="Add an item">
              <div className="card-pad">
                <AddForm />
              </div>
            </Card>
          </div>
        </>
      )}
    </Shell>
  );
}

function AddForm() {
  return (
    <form action={addItem} className="stack">
      <input name="name" placeholder="Product name" required />
      <input name="collection" placeholder="Collection (e.g. Maasai Beadwork)" />
      <input name="category" placeholder="Category (e.g. Jewelry, Home)" />
      <div className="flex" style={{ gap: 10 }}>
        <input name="quantity" placeholder="Qty" type="number" min="0" style={{ flex: 1 }} />
        <input name="unit_price" placeholder="Price (USD)" type="number" min="0" step="0.01" style={{ flex: 1 }} />
      </div>
      <textarea name="story" placeholder="Optional: story / notes for the listing engine" rows={2} style={{ resize: "vertical" }} />
      <button className="btn" type="submit" style={{ alignSelf: "flex-start" }}>
        <Package size={15} /> Add item
      </button>
    </form>
  );
}
