import Shell from "../../components/Shell";
import { Badge, Meter } from "../../components/ui";
import { Money } from "../../components/Money";
import { admin, date } from "../../lib/supabase-admin";
import DispatchBox from "../../components/DispatchBox";

export const dynamic = "force-dynamic";

// The wishlist: concrete needs a donor can fund. Managed here and by Sasa (the 727
// bot) via add_wishlist_item / fund_wishlist_item / list_wishlist. Grouped by how
// far each item is funded, open and partial first because those are the live asks.
const GROUPS: { key: string; label: string; sub: string; tone: "gold" | "blue" | "green" }[] = [
  { key: "open", label: "Open needs", sub: "nothing funded yet", tone: "gold" },
  { key: "partial", label: "Partially funded", sub: "some way there", tone: "blue" },
  { key: "fulfilled", label: "Fulfilled", sub: "fully covered", tone: "green" },
];

export default async function Wishlist() {
  const db = admin();
  const { data } = await db
    .from("wishlist_items")
    .select("*")
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(300);
  const items = (data || []) as any[];

  const openCount = items.filter((i) => i.status === "open" || i.status === "partial").length;
  const fulfilledCount = items.filter((i) => i.status === "fulfilled").length;

  return (
    <Shell title="Wishlist" sub="Concrete needs a donor can fund. Add one by just telling Sasa.">
      {/* Lead with the live ask count (Law 5). Everything below derives from the
          same fetch, no extra query. */}
      <div className="metric-hero">
        <div className="mh-row">
          <div style={{ minWidth: 0 }}>
            <div className="mh-label">Open needs · waiting to be funded</div>
            <div className="mh-num disp2">{openCount}</div>
            <div className="mh-sub">
              {openCount === 1 ? "one live ask" : `${openCount} live asks`}
              {fulfilledCount > 0 ? ` · ${fulfilledCount} already covered` : ""}
            </div>
          </div>
          <div className="stack" style={{ gap: 6, minWidth: 180, flex: "1 1 200px", maxWidth: 320, textAlign: "right" }}>
            <div className="mh-label">Fulfilled to date</div>
            <div className="disp2" style={{ fontSize: 40, fontWeight: 700, lineHeight: 0.95, letterSpacing: "-0.03em" }}>
              {fulfilledCount}
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#7df3f1" }}>
              {items.length} item{items.length === 1 ? "" : "s"} tracked
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <DispatchBox />
      </div>

      <div className="grid cols-3" style={{ marginTop: 16 }}>
        {GROUPS.map((g) => {
          const list = items.filter((i) => i.status === g.key);
          return (
            <div className="card" key={g.key}>
              <div className="card-h">{g.label}<Badge tone={g.tone}>{list.length}</Badge></div>
              <div className="card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {list.length === 0 && <div className="empty" style={{ padding: 28, fontSize: 12.5 }}>{g.sub}. Nothing here.</div>}
                {list.map((i) => {
                  const need = i.qty_needed || 1;
                  const funded = i.qty_funded || 0;
                  const pct = Math.round((funded / need) * 100);
                  return (
                    <div key={i.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
                      <div className="between" style={{ alignItems: "flex-start" }}>
                        <span className="strong" style={{ fontSize: 13.5, lineHeight: 1.35 }}>{i.title}</span>
                        {i.category && <Badge tone="blue">{i.category}</Badge>}
                      </div>
                      {i.description && <div className="muted" style={{ fontSize: 12.5, marginTop: 5, lineHeight: 1.45 }}>{i.description}</div>}
                      <div style={{ marginTop: 12 }}>
                        <Meter pct={pct} />
                        <div className="between" style={{ marginTop: 7 }}>
                          <span className="muted" style={{ fontSize: 12 }}>
                            {funded} of {need} funded
                            {i.unit_cost != null ? <> · <Money amount={i.unit_cost} currency={i.currency} /> each</> : null}
                          </span>
                          <span className="strong disp2" style={{ fontSize: 12.5 }}>{pct}%</span>
                        </div>
                      </div>
                      <div className="muted" style={{ fontSize: 11.5, marginTop: 9 }}>
                        added {date(i.created_at)}{i.created_by ? ` · ${i.created_by}` : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
