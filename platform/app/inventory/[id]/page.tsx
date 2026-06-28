import Shell from "../../../components/Shell";
import { Badge, statusTone } from "../../../components/ui";
import { Money, MoneyHideToggle } from "../../../components/Money";
import PreviewLink from "../../../components/PreviewLink";
import { admin, date } from "../../../lib/supabase-admin";
import { getCurrentUser } from "../../../lib/auth";
import {
  Package,
  Hash,
  Tag,
  Ruler,
  User,
  Layers,
  Boxes,
  Activity,
  ImageIcon,
  FileText,
  ShoppingBag,
} from "lucide-react";

export const dynamic = "force-dynamic";

// The lifecycle a finished Maisha piece moves through, in order. Mirrors the
// state machine enforced by smart-tools (upsert_end_product / advance_lifecycle)
// and the inventory_lifecycle_events ledger. Drives the inline progress rail.
const LIFECYCLE: string[] = [
  "production",
  "in_stock",
  "reserved",
  "sold",
  "shipped",
  "in_transit",
  "delivered",
  "returned",
  "restock",
];

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

const TYPE_LABEL: Record<string, string> = {
  end_product: "Finished piece",
  textile: "Textile",
  supply: "Supply",
};

// Lifecycle state to a badge tone. Green = healthy/sold-through, gold = mid-flight,
// red = a problem state (returned), gray = pre-stock. Reuses the Badge tone set.
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

// Dubai-aware short timeline stamp (full date via the shared date() helper).
const DOT_COLOR: Record<string, string> = {
  green: "var(--green)",
  gold: "var(--gold)",
  red: "var(--red)",
  teal: "var(--teal)",
  gray: "var(--muted)",
};

export default async function InventoryItem({ params }: { params: { id: string } }) {
  const db = admin();
  const id = params.id;
  const user = getCurrentUser();
  // Same role gate as the finance-admin surfaces (app/admin/transcripts uses the
  // identical getCurrentUser().role check). Cost/price internals are founder-only.
  const isAdmin = user?.role === "founder";

  const { data: row } = await db.from("inventory").select("*").eq("id", id).single();
  const it: any = row || {};

  const display = it.name || it.tracking_no || "Item";
  const itemType: string = it.item_type || "";
  const isEndProduct = itemType === "end_product";

  // The lifecycle ledger for THIS piece. Single source of "what happened" to the
  // item, ordered oldest-first so the rail reads as a journey. Service-role only.
  const { data: evRows } = await db
    .from("inventory_lifecycle_events")
    .select("from_state,to_state,evidence,created_at")
    .eq("inventory_id", id)
    .order("created_at", { ascending: true })
    .limit(100);
  const events = (evRows || []) as any[];

  // Photos: asset_ids -> signed URLs from the private assets bucket (1h). Never
  // world-readable, scoped to the operator's session (mirrors beneficiaries).
  const assetIds: string[] = Array.isArray(it.asset_ids) ? it.asset_ids : [];
  let photos: { url: string }[] = [];
  if (assetIds.length) {
    const { data: assets } = await db
      .from("assets")
      .select("id,storage_path")
      .in("id", assetIds);
    for (const a of assets || []) {
      if (!a.storage_path) continue;
      const { data: signed } = await db.storage.from("assets").createSignedUrl(a.storage_path, 3600);
      if (signed?.signedUrl) photos.push({ url: signed.signedUrl });
    }
  }

  const currentStateIdx = LIFECYCLE.indexOf((it.lifecycle_state || "").toLowerCase());

  const Row = ({
    icon: Icon,
    label,
    children,
  }: {
    icon: any;
    label: string;
    children: React.ReactNode;
  }) => (
    <div
      className="between"
      style={{ fontSize: 13, padding: "9px 0", borderTop: "1px solid var(--line)" }}
    >
      <span className="muted flex" style={{ gap: 7 }}>
        <Icon size={13} /> {label}
      </span>
      <span style={{ textAlign: "right" }}>{children || "—"}</span>
    </div>
  );

  return (
    <Shell
      title={display}
      sub={it.tracking_no || TYPE_LABEL[itemType] || "Inventory"}
      action={
        <span className="flex" style={{ gap: 6 }}>
          {itemType && <Badge tone="gray">{TYPE_LABEL[itemType] || itemType}</Badge>}
          {isEndProduct && it.lifecycle_state && (
            <Badge tone={lifecycleTone(it.lifecycle_state)}>
              {LIFECYCLE_LABEL[it.lifecycle_state] || it.lifecycle_state}
            </Badge>
          )}
          {it.folklore_listed && <Badge tone="green">listed on Folklore</Badge>}
        </span>
      }
    >
      {/* identity banner */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div
          className="between"
          style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 14 }}
        >
          <div className="flex" style={{ gap: 16 }}>
            {photos[0] ? (
              <PreviewLink href={photos[0].url} kind="image" title={display} style={{ flexShrink: 0, display: "block" }}>
                <img
                  src={photos[0].url}
                  alt={display}
                  style={{
                    width: 76,
                    height: 76,
                    borderRadius: 16,
                    objectFit: "cover",
                    boxShadow: "var(--shadow-sm)",
                    border: "1px solid var(--line)",
                    cursor: "pointer",
                  }}
                />
              </PreviewLink>
            ) : (
              <div className="avatar" style={{ width: 76, height: 76, fontSize: 28, flexShrink: 0 }}>
                <Package size={30} />
              </div>
            )}
            <div>
              <div className="disp2" style={{ fontWeight: 700, fontSize: 26, lineHeight: 1.05 }}>
                {display}
              </div>
              <div
                className="muted flex"
                style={{ fontSize: 13, gap: 8, marginTop: 6, flexWrap: "wrap" }}
              >
                {it.tracking_no && <span>{it.tracking_no}</span>}
                {it.collection && (
                  <>
                    {it.tracking_no && <span>·</span>}
                    <span>{it.collection}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <span className="flex" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {it.status && <Badge tone={statusTone(it.status)}>{it.status}</Badge>}
            {it.source === "maisha_inventory" && <Badge tone="gray">Maisha</Badge>}
          </span>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "0.9fr 1.5fr", alignItems: "start" }}>
        {/* LEFT: details rail */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card card-pad">
            <div className="flex" style={{ marginBottom: 10, gap: 7 }}>
              <FileText size={15} color="var(--muted)" />
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>Details</span>
            </div>
            <div className="stack" style={{ gap: 0 }}>
              {itemType && (
                <Row icon={Boxes} label="Type">
                  <Badge tone="peri">{TYPE_LABEL[itemType] || itemType}</Badge>
                </Row>
              )}
              {it.tracking_no && (
                <Row icon={Hash} label="Tracking #">{it.tracking_no}</Row>
              )}
              {it.collection && <Row icon={Layers} label="Collection">{it.collection}</Row>}
              {it.style && <Row icon={Tag} label="Style">{it.style}</Row>}
              {it.maker && <Row icon={User} label="Maker">{it.maker}</Row>}
              {it.size && <Row icon={Ruler} label="Size">{it.size}</Row>}
              {it.quantity != null && (
                <Row icon={Boxes} label="Quantity">{it.quantity}</Row>
              )}
            </div>
          </div>

          {/* cost / price — founder only. Same gate as finance-admin surfaces. */}
          {isAdmin ? (
            <div className="card card-pad">
              <div className="between" style={{ marginBottom: 10 }}>
                <span className="flex" style={{ fontWeight: 600, fontSize: 13.5, gap: 7 }}>
                  <ShoppingBag size={15} color="var(--muted)" /> Cost &amp; price
                </span>
                <MoneyHideToggle />
              </div>
              <div className="stack" style={{ gap: 0 }}>
                <Row icon={ShoppingBag} label="Unit cost">
                  {it.unit_cost != null ? (
                    <Money amount={it.unit_cost} currency={it.cost_currency || "KES"} />
                  ) : null}
                </Row>
                <Row icon={ShoppingBag} label="Unit price">
                  {it.unit_price != null ? (
                    <Money amount={it.unit_price} currency={it.price_currency || "USD"} />
                  ) : null}
                </Row>
              </div>
              <div className="faint" style={{ fontSize: 11.5, marginTop: 10, lineHeight: 1.5 }}>
                Cost and price are founder-only. Currencies are never blended.
              </div>
            </div>
          ) : null}
        </div>

        {/* RIGHT: lifecycle is the hero (for finished pieces) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {isEndProduct && (
            <div className="card">
              <div className="card-h">
                <span className="flex" style={{ gap: 7 }}>
                  <Activity size={14} /> Lifecycle
                </span>
                {it.lifecycle_state && (
                  <Badge tone={lifecycleTone(it.lifecycle_state)}>
                    {LIFECYCLE_LABEL[it.lifecycle_state] || it.lifecycle_state}
                  </Badge>
                )}
              </div>
              <div style={{ padding: "16px 18px" }}>
                {/* the canonical state rail: where this piece sits in the journey */}
                {currentStateIdx >= 0 && (
                  <div className="flex wrap" style={{ gap: 6, marginBottom: 16 }}>
                    {LIFECYCLE.map((s, i) => (
                      <span
                        key={s}
                        className="chip"
                        style={{
                          fontSize: 11,
                          opacity: i <= currentStateIdx ? 1 : 0.4,
                          fontWeight: i === currentStateIdx ? 700 : 500,
                          borderColor: i === currentStateIdx ? "var(--teal)" : undefined,
                        }}
                      >
                        {LIFECYCLE_LABEL[s] || s}
                      </span>
                    ))}
                  </div>
                )}

                {events.length === 0 ? (
                  <div className="faint" style={{ fontSize: 13 }}>
                    No lifecycle changes recorded yet. State transitions will appear here as the
                    piece moves through production, stock and sale.
                  </div>
                ) : (
                  <div style={{ position: "relative", paddingLeft: 22 }}>
                    <span
                      style={{
                        position: "absolute",
                        left: 5,
                        top: 4,
                        bottom: 4,
                        width: 2,
                        background: "var(--line)",
                      }}
                    />
                    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                      {/* newest first for reading; ledger is fetched oldest-first */}
                      {[...events].reverse().map((e, i) => {
                        const tone = lifecycleTone(e.to_state);
                        return (
                          <div key={i} style={{ position: "relative" }}>
                            <span
                              style={{
                                position: "absolute",
                                left: -22,
                                top: 3,
                                width: 12,
                                height: 12,
                                borderRadius: "50%",
                                background: DOT_COLOR[tone] || "var(--muted)",
                                boxShadow: "0 0 0 3px var(--surface)",
                              }}
                            />
                            <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>
                              {e.from_state
                                ? `${LIFECYCLE_LABEL[e.from_state] || e.from_state} → ${LIFECYCLE_LABEL[e.to_state] || e.to_state}`
                                : LIFECYCLE_LABEL[e.to_state] || e.to_state || "State change"}
                            </div>
                            <div
                              className="muted flex"
                              style={{ fontSize: 12, gap: 7, marginTop: 2, flexWrap: "wrap" }}
                            >
                              <span>{date(e.created_at)}</span>
                              {e.evidence && (
                                <>
                                  <span>·</span>
                                  <span>{e.evidence}</span>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* photos */}
          <div className="card">
            <div className="card-h">
              <span className="flex" style={{ gap: 7 }}>
                <ImageIcon size={14} /> Photos
              </span>
              <Badge tone="gray">
                {photos.length} {photos.length === 1 ? "photo" : "photos"}
              </Badge>
            </div>
            <div style={{ padding: "14px 18px" }}>
              {photos.length === 0 ? (
                <div className="faint" style={{ fontSize: 13 }}>
                  No photos attached to this item yet.
                </div>
              ) : (
                <div
                  className="grid"
                  style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 }}
                >
                  {photos.map((p, i) => (
                    <PreviewLink key={i} href={p.url} kind="image" title={display} style={{ display: "block" }}>
                      <img
                        src={p.url}
                        alt={`${display} photo ${i + 1}`}
                        style={{
                          width: "100%",
                          aspectRatio: "1 / 1",
                          objectFit: "cover",
                          borderRadius: 12,
                          border: "1px solid var(--line)",
                          cursor: "pointer",
                        }}
                      />
                    </PreviewLink>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
