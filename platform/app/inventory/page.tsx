import Shell from "../../components/Shell";
import { Card, Table, Badge, Col, statusTone } from "../../components/ui";
import { admin, money, num } from "../../lib/supabase-admin";
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

  const cols: Col<any>[] = [
    { key: "sku", label: "SKU", render: (r) => <span className="strong">{r.sku || "—"}</span> },
    { key: "name", label: "Product" },
    { key: "collection", label: "Collection", render: (r) => r.collection || "—" },
    { key: "quantity", label: "Qty", align: "right", render: (r) => num(r.quantity) },
    { key: "unit_price", label: "Price", align: "right", render: (r) => money(r.unit_price) },
    { key: "status", label: "Status", render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    { key: "folklore_listed", label: "Folklore", render: (r) => (r.folklore_listed ? <Badge tone="green">listed</Badge> : <Badge tone="gray">not listed</Badge>) },
  ];

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
          <Card title="Stock">
            <Table columns={cols} rows={items} empty="No inventory yet." />
          </Card>

          <div style={{ marginTop: 16 }} className="grid cols-2">
            {items.map((it: any) => {
              const listing = latestFor(it.name);
              return (
                <div className="card card-pad" key={it.id}>
                  <div className="between">
                    <div className="flex" style={{ gap: 8, alignItems: "center" }}>
                      <Package size={16} />
                      <strong style={{ fontSize: 15 }}>{it.name}</strong>
                    </div>
                    {it.folklore_listed ? <Badge tone="green">listed</Badge> : <Badge tone="gray">draft</Badge>}
                  </div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                    {[it.collection, it.category].filter(Boolean).join(" · ") || "—"}
                    {it.unit_price ? ` · ${money(it.unit_price)}` : ""}
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

          <div style={{ marginTop: 16, maxWidth: 520 }}>
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
