import Link from "next/link";
import Shell from "../../components/Shell";
import { Card, Stat, Badge } from "../../components/ui";
import { Money, MoneyHideToggle } from "../../components/Money";
import { admin } from "../../lib/supabase-admin";
import { getCurrentUser } from "../../lib/auth";
import { addItem, generateListing } from "./actions";
import {
  Package,
  Sparkles,
  BookOpen,
  Boxes,
  Layers,
  Scissors,
  ChevronRight,
  TrendingUp,
} from "lucide-react";

export const dynamic = "force-dynamic";

// The lifecycle a finished Maisha piece moves through, in order. Mirrors the
// state machine in smart-tools and the inventory_lifecycle_events ledger.
const LIFECYCLE_LABEL: Record<string, string> = {
  production: "In production",
  in_stock: "In stock",
  reserved: "Reserved",
  sold: "Sold",
  shipped: "Shipped",
  in_transit: "In transit",
  delivered: "Delivered",
  returned: "Returned",
  restock: "Restock",
};

// Lifecycle state to a Badge tone. Same mapping as the detail route.
function lifecycleTone(s?: string | null): "green" | "gold" | "red" | "gray" | "teal" {
  switch ((s || "").toLowerCase()) {
    case "in_stock":
    case "delivered":
      return "green";
    case "sold":
    case "shipped":
    case "in_transit":
    case "reserved":
      return "gold";
    case "returned":
      return "red";
    case "production":
    case "restock":
      return "teal";
    default:
      return "gray";
  }
}

export default async function Inventory() {
  const db = admin();
  const user = getCurrentUser();
  // Founder-only gate, identical mechanism to app/admin/transcripts/page.tsx
  // (getCurrentUser().role). Costs and revenue are founder-only; team/none never
  // see money on this surface.
  const isAdmin = user?.role === "founder";

  const { data } = await db.from("inventory").select("*").order("name").limit(1000);
  const items: any[] = data || [];

  // Pull the generated Folklore listings from the Library so we can show each
  // item's latest draft copy inline. Match on the asset title we wrote on save.
  const { data: listings } = await db
    .from("assets")
    .select("title,description,created_at")
    .eq("source", "inventory")
    .order("created_at", { ascending: false })
    .limit(1000);
  const latestFor = (name: string) =>
    (listings || []).find(
      (a: any) => a.title === `Folklore listing — ${name}` || a.title === `Folklore listing - ${name}`
    ) || null;

  // Group by item_type. Un-typed drafts (item_type NULL) fall into "other" so the
  // list never silently drops a captured-but-unenriched piece.
  const endProducts = items.filter((i) => i.item_type === "end_product");
  const textiles = items.filter((i) => i.item_type === "textile");
  const supplies = items.filter((i) => i.item_type === "supply");
  const untyped = items.filter(
    (i) => !["end_product", "textile", "supply"].includes(i.item_type || "")
  );

  // Lifecycle distribution across finished pieces, for the top stat.
  const inStock = endProducts.filter((i) => i.lifecycle_state === "in_stock").length;
  const sold = endProducts.filter((i) =>
    ["sold", "shipped", "in_transit", "delivered"].includes(i.lifecycle_state || "")
  ).length;

  // --- Sales / Finance (FOUNDER ONLY) -------------------------------------
  // Read inventory_sales per-currency, never blended. channel_fee netted within
  // the same currency only. Only fetched when the viewer is the founder so the
  // service-role read never feeds a non-admin render path.
  let salesView: {
    count: number;
    revenue: Record<string, number>;
    fees: Record<string, number>;
    paid: Record<string, number>;
    byStatus: Record<string, number>;
  } | null = null;
  if (isAdmin) {
    const { data: salesRows } = await db
      .from("inventory_sales")
      .select("price,currency,channel,payment_status,channel_fee")
      .limit(5000);
    const sales = (salesRows || []) as any[];
    const revenue: Record<string, number> = {};
    const fees: Record<string, number> = {};
    const paid: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const s of sales) {
      const ccy = String(s.currency || "").toUpperCase();
      if (!["KES", "USD", "AED"].includes(ccy)) continue; // refuse unknown currency, never blend
      const gross = Number(s.price || 0);
      const fee = Number(s.channel_fee || 0);
      const net = gross - fee;
      revenue[ccy] = (revenue[ccy] || 0) + net;
      fees[ccy] = (fees[ccy] || 0) + fee;
      const st = String(s.payment_status || "sold");
      byStatus[st] = (byStatus[st] || 0) + 1;
      if (st === "paid" || st === "settled") paid[ccy] = (paid[ccy] || 0) + net;
    }
    salesView = { count: sales.length, revenue, fees, paid, byStatus };
  }

  const empty = items.length === 0;

  return (
    <Shell title="Inventory" sub={`${items.length} tracked · Maisha → The Folklore`}>
      {empty ? (
        <Card title="Stock">
          <div className="empty">
            <div style={{ marginBottom: 14 }}>
              Nothing tracked yet. Add your first Maisha piece, or log items via the WhatsApp
              capture, to start tracking stock and the Folklore copy engine.
            </div>
          </div>
          <div className="card-pad" style={{ borderTop: "1px solid var(--line)" }}>
            <AddForm />
          </div>
        </Card>
      ) : (
        <>
          <div className="grid cols-3">
            <Stat
              label="Finished pieces"
              value={endProducts.length}
              delta={`${textiles.length} textiles · ${supplies.length} supplies`}
            />
            <Stat
              label="In stock"
              value={<span className="disp2">{inStock}</span>}
              delta={inStock ? "ready on The Folklore" : "nothing in stock"}
            />
            <Stat
              label="Sold through"
              value={<span className="disp2">{sold}</span>}
              delta={sold ? "sold / shipped / delivered" : "no sales yet"}
            />
          </div>

          {/* FINISHED PIECES (end_products) — lifecycle is the headline */}
          <Section
            icon={Package}
            title="Finished pieces"
            count={endProducts.length}
            empty="No finished pieces tracked yet."
          >
            <div className="grid cols-2">
              {endProducts.map((it: any) => {
                const listing = latestFor(it.name);
                return (
                  <div className="card card-pad" key={it.id}>
                    <Link
                      href={`/inventory/${it.id}`}
                      className="between"
                      style={{ textDecoration: "none", color: "inherit", alignItems: "flex-start" }}
                    >
                      <div className="flex" style={{ gap: 8, alignItems: "center", minWidth: 0 }}>
                        <Package size={16} />
                        <strong style={{ fontSize: 15 }}>{it.name || it.tracking_no || "Piece"}</strong>
                      </div>
                      <span className="flex" style={{ gap: 6, alignItems: "center", flexShrink: 0 }}>
                        {it.lifecycle_state && (
                          <Badge tone={lifecycleTone(it.lifecycle_state)}>
                            {LIFECYCLE_LABEL[it.lifecycle_state] || it.lifecycle_state}
                          </Badge>
                        )}
                        <ChevronRight size={15} color="var(--muted)" />
                      </span>
                    </Link>

                    <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
                      {[
                        it.tracking_no,
                        it.collection,
                        it.maker && `by ${it.maker}`,
                        it.size && `size ${it.size}`,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </div>

                    {/* price is founder-only; never render money to team/none */}
                    {isAdmin && it.unit_price != null && (
                      <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                        <Money amount={it.unit_price} currency={it.price_currency || "USD"} />
                      </div>
                    )}

                    <div style={{ marginTop: 8 }}>
                      {it.folklore_listed ? (
                        <Badge tone="green">listed on Folklore</Badge>
                      ) : (
                        <Badge tone="gray">not listed</Badge>
                      )}
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
                        <Sparkles size={14} />{" "}
                        {listing ? "Regenerate Folklore listing" : "Generate Folklore listing"}
                      </button>
                    </form>

                    {listing && (
                      <div
                        className="card-pad"
                        style={{ marginTop: 12, background: "var(--canvas)", borderRadius: 12 }}
                      >
                        <div
                          className="flex faint"
                          style={{
                            gap: 6,
                            alignItems: "center",
                            fontSize: 11.5,
                            fontWeight: 600,
                            marginBottom: 8,
                          }}
                        >
                          <BookOpen size={13} /> SAVED TO LIBRARY · MAISHA
                        </div>
                        <div style={{ fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
                          {listing.description}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>

          {/* TEXTILES — raw material by quantity + unit cost (founder only) */}
          <Section
            icon={Layers}
            title="Textiles"
            count={textiles.length}
            empty="No textiles tracked yet."
          >
            <SupplyGrid rows={textiles} isAdmin={isAdmin} />
          </Section>

          {/* SUPPLIES — consumable inputs by quantity + unit cost (founder only) */}
          <Section
            icon={Scissors}
            title="Supplies"
            count={supplies.length}
            empty="No supplies tracked yet."
          >
            <SupplyGrid rows={supplies} isAdmin={isAdmin} />
          </Section>

          {/* UN-TYPED drafts captured but not yet classified */}
          {untyped.length > 0 && (
            <Section
              icon={Boxes}
              title="Awaiting details"
              count={untyped.length}
              empty=""
            >
              <div className="grid cols-2">
                {untyped.map((it: any) => (
                  <Link
                    key={it.id}
                    href={`/inventory/${it.id}`}
                    className="card card-pad between"
                    style={{ textDecoration: "none", color: "inherit", alignItems: "center" }}
                  >
                    <span className="flex" style={{ gap: 8, alignItems: "center", minWidth: 0 }}>
                      <Boxes size={15} />
                      <strong style={{ fontSize: 14 }}>{it.name || it.tracking_no || "Draft item"}</strong>
                    </span>
                    <span className="flex" style={{ gap: 6, alignItems: "center" }}>
                      <Badge tone="gold">needs details</Badge>
                      <ChevronRight size={15} color="var(--muted)" />
                    </span>
                  </Link>
                ))}
              </div>
            </Section>
          )}

          {/* SALES / FINANCE — FOUNDER ONLY. Never rendered for team/none. */}
          {isAdmin && salesView && (
            <div style={{ marginTop: 26 }}>
              <Card
                title="Sales & revenue"
                action={<MoneyHideToggle />}
              >
                <div className="card-pad">
                  {salesView.count === 0 ? (
                    <div className="faint" style={{ fontSize: 13 }}>
                      No sales recorded yet. Logged sales (with channel, fees and payment status)
                      will surface here, bucketed per currency.
                    </div>
                  ) : (
                    <>
                      <div className="flex" style={{ gap: 7, marginBottom: 14, alignItems: "center" }}>
                        <TrendingUp size={15} color="var(--muted)" />
                        <span className="muted" style={{ fontSize: 13 }}>
                          {salesView.count} {salesView.count === 1 ? "sale" : "sales"} on record
                        </span>
                      </div>

                      {/* per-currency net revenue. NEVER summed across currencies. */}
                      <div className="grid cols-3">
                        {Object.keys(salesView.revenue).map((ccy) => (
                          <div className="card card-pad stat" key={ccy}>
                            <div className="label">Net revenue · {ccy}</div>
                            <div className="value">
                              <Money amount={salesView!.revenue[ccy]} currency={ccy} />
                            </div>
                            <div className="delta">
                              {salesView!.paid[ccy] != null ? (
                                <>
                                  paid: <Money amount={salesView!.paid[ccy]} currency={ccy} />
                                </>
                              ) : (
                                "none settled yet"
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* fees per currency + payment status mix */}
                      <div style={{ marginTop: 14 }}>
                        {Object.keys(salesView.fees).map((ccy) =>
                          salesView!.fees[ccy] > 0 ? (
                            <div
                              key={ccy}
                              className="between"
                              style={{ fontSize: 13, padding: "8px 0", borderTop: "1px solid var(--line)" }}
                            >
                              <span className="muted">Channel fees · {ccy}</span>
                              <span><Money amount={salesView!.fees[ccy]} currency={ccy} /></span>
                            </div>
                          ) : null
                        )}
                        <div
                          className="between"
                          style={{ fontSize: 13, padding: "8px 0", borderTop: "1px solid var(--line)" }}
                        >
                          <span className="muted">Payment status</span>
                          <span className="flex" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                            {Object.entries(salesView.byStatus).map(([st, n]) => (
                              <Badge key={st} tone="gray">
                                {st}: {n}
                              </Badge>
                            ))}
                          </span>
                        </div>
                      </div>

                      <div className="faint" style={{ fontSize: 11.5, marginTop: 12, lineHeight: 1.5 }}>
                        Revenue is net of channel fees, bucketed per currency. KES, USD and AED are
                        never blended. Founder-only.
                      </div>
                    </>
                  )}
                </div>
              </Card>
            </div>
          )}

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

// A titled section that hides itself when empty (calm by exception) unless it is
// one of the always-shown core groups (those pass a real empty string to show
// the empty note). We only render the wrapper when there are rows OR an empty msg.
function Section({
  icon: Icon,
  title,
  count,
  empty,
  children,
}: {
  icon: any;
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  if (count === 0 && !empty) return null;
  return (
    <div style={{ marginTop: 22 }}>
      <div className="between" style={{ marginBottom: 12 }}>
        <h3 className="flex" style={{ margin: 0, fontSize: 15, gap: 7, alignItems: "center" }}>
          <Icon size={15} /> {title}
        </h3>
        <span className="faint" style={{ fontSize: 12.5 }}>
          {count} {count === 1 ? "item" : "items"}
        </span>
      </div>
      {count === 0 ? <div className="empty" style={{ fontSize: 13 }}>{empty}</div> : children}
    </div>
  );
}

// Supplies + textiles render the same way: name, collection/style, quantity, and
// (founder-only) unit cost in its own currency. Each links to its detail page.
function SupplyGrid({ rows, isAdmin }: { rows: any[]; isAdmin: boolean }) {
  return (
    <div className="grid cols-2">
      {rows.map((it: any) => (
        <Link
          key={it.id}
          href={`/inventory/${it.id}`}
          className="card card-pad"
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <div className="between" style={{ alignItems: "flex-start" }}>
            <strong style={{ fontSize: 14.5 }}>{it.name || "Item"}</strong>
            <ChevronRight size={15} color="var(--muted)" />
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            {[it.collection, it.style].filter(Boolean).join(" · ") || "—"}
            {` · qty ${Number(it.quantity) || 0}`}
          </div>
          {isAdmin && it.unit_cost != null && (
            <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
              unit cost <Money amount={it.unit_cost} currency={it.cost_currency || "KES"} />
            </div>
          )}
        </Link>
      ))}
    </div>
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
        <input
          name="unit_price"
          placeholder="Price (USD)"
          type="number"
          min="0"
          step="0.01"
          style={{ flex: 1 }}
        />
      </div>
      <textarea
        name="story"
        placeholder="Optional: story / notes for the listing engine"
        rows={2}
        style={{ resize: "vertical" }}
      />
      <button className="btn" type="submit" style={{ alignSelf: "flex-start" }}>
        <Package size={15} /> Add item
      </button>
    </form>
  );
}
