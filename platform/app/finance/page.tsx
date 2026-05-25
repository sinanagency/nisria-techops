import Shell from "../../components/Shell";
import { Card, Badge } from "../../components/ui";
import { admin, money, date } from "../../lib/supabase-admin";
import { addPayment, markPaid, logMpesa } from "./actions";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Wallet,
  Plus,
  ReceiptText,
  UploadCloud,
  RefreshCw,
  AlarmClock,
  CreditCard,
  Users,
  MapPin,
  Building2,
  CircleDot,
  CheckCircle2,
} from "lucide-react";

export const dynamic = "force-dynamic";

const methodLabel: Record<string, string> = { mpesa: "M-Pesa", bank: "Bank", card: "Card" };

// Categories → label + icon + badge tone, in display order.
const CATEGORY_META: Record<string, { label: string; tone: any; icon: any }> = {
  subscription: { label: "Subscriptions", tone: "blue", icon: CreditCard },
  salary: { label: "Salaries", tone: "teal", icon: Users },
  kenya: { label: "Kenya", tone: "green", icon: MapPin },
  vendor: { label: "Vendors", tone: "gold", icon: Building2 },
  other: { label: "Other", tone: "gray", icon: CircleDot },
};
const CATEGORY_ORDER = ["subscription", "salary", "kenya", "vendor", "other"];
const catSingular: Record<string, string> = {
  subscription: "Subscription",
  salary: "Salary",
  kenya: "Kenya",
  vendor: "Vendor",
  other: "Other",
};

// Currency-aware money. USD → shared money() (clean $); anything else shows the
// code so KES never gets mislabelled as dollars.
function fmt(amount: any, currency?: string) {
  const cur = (currency || "USD").toUpperCase();
  if (cur === "USD") return money(amount);
  const n = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(amount || 0));
  return `${cur} ${n}`;
}

// Map a Badge tone to a valid .aico colour class (subset differs from badges).
function aicoClass(tone: string): string {
  return ["teal", "peri", "green", "gold", "red", "gray"].includes(tone) ? tone : "teal";
}

const DAY = 86_400_000;

export default async function Finance() {
  const db = admin();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [donRes, payRes] = await Promise.all([
    db.from("donations").select("amount,status,donated_at").gte("donated_at", monthStart).limit(2000),
    db.from("payments").select("*").limit(1000),
  ]);

  const donations = (donRes.data || []) as any[];
  const payments = (payRes.data || []) as any[];

  // ---- top metrics --------------------------------------------------------
  // Money in: succeeded donations this month (donations are USD-denominated)
  const moneyIn = donations
    .filter((d: any) => (d.status || "").toLowerCase() === "succeeded")
    .reduce((s: number, d: any) => s + Number(d.amount || 0), 0);

  // Money out: payments marked paid this month (USD obligations only for the headline sum)
  const moneyOut = payments
    .filter((p: any) => p.status === "paid" && p.paid_at && new Date(p.paid_at).toISOString() >= monthStart && (p.currency || "USD").toUpperCase() === "USD")
    .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);

  // Outstanding: everything still owed (USD obligations) — upcoming | due | overdue
  const outstandingUsd = payments
    .filter((p: any) => ["upcoming", "due", "overdue"].includes(p.status) && (p.currency || "USD").toUpperCase() === "USD")
    .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);

  // ---- reminders: due soon ------------------------------------------------
  const dueRows = payments
    .filter((p: any) => ["upcoming", "due", "overdue"].includes(p.status))
    .sort((a: any, b: any) => new Date(a.due_on || "9999-12-31").getTime() - new Date(b.due_on || "9999-12-31").getTime());

  // urgency flag per row: overdue (red) / due within 7 days (gold) / scheduled
  const urgencyOf = (r: any): "overdue" | "soon" | "scheduled" => {
    if (r.status === "overdue") return "overdue";
    if (!r.due_on) return "scheduled";
    const d = new Date(r.due_on + "T00:00:00");
    const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = (dd.getTime() - today.getTime()) / DAY;
    if (diff < 0) return "overdue";
    if (diff <= 7) return "soon";
    return "scheduled";
  };

  const overdueCount = dueRows.filter((r: any) => urgencyOf(r) === "overdue").length;
  const soonCount = dueRows.filter((r: any) => urgencyOf(r) === "soon").length;

  // ---- recurring obligations grouped by category -------------------------
  const recurring = payments.filter((p: any) => p.recurrence && p.recurrence !== "none");
  const recurringByCat: Record<string, any[]> = {};
  for (const r of recurring) {
    const c = CATEGORY_META[r.category] ? r.category : "other";
    (recurringByCat[c] ||= []).push(r);
  }
  for (const c of Object.keys(recurringByCat)) {
    recurringByCat[c].sort((a: any, b: any) => new Date(a.due_on || "9999-12-31").getTime() - new Date(b.due_on || "9999-12-31").getTime());
  }

  // ---- paid history -------------------------------------------------------
  const paidHistory = payments
    .filter((p: any) => p.status === "paid")
    .sort((a: any, b: any) => new Date(b.paid_at || 0).getTime() - new Date(a.paid_at || 0).getTime())
    .slice(0, 40);

  // small inline helpers ----------------------------------------------------
  const RecurrenceBadge = ({ r }: { r: string }) =>
    r && r !== "none" ? (
      <Badge tone={"peri" as any}><RefreshCw size={11} /> {r === "monthly" ? "Monthly" : "Yearly"}</Badge>
    ) : null;

  const CategoryBadge = ({ c }: { c: string }) => {
    const meta = CATEGORY_META[c] || CATEGORY_META.other;
    return <Badge tone={meta.tone}>{catSingular[c] || "Other"}</Badge>;
  };

  return (
    <Shell
      title="Finance"
      sub="Your obligations in one place. Submit recurring bills, salaries and vendor payments — the system tracks them and reminds you. Logging records a payment; it never moves money."
    >
      {/* top: three feature cards */}
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="feature teal">
          <div className="ficon"><ArrowDownLeft size={20} /></div>
          <div className="ftitle">{money(moneyIn)}</div>
          <div className="fmeta">Money in · succeeded donations this month</div>
        </div>
        <div className="feature peri">
          <div className="ficon"><ArrowUpRight size={20} /></div>
          <div className="ftitle">{money(moneyOut)}</div>
          <div className="fmeta">Money out · paid this month</div>
        </div>
        <div className="feature dark">
          <div className="ficon"><Wallet size={20} /></div>
          <div className="ftitle">{money(outstandingUsd)}</div>
          <div className="fmeta">Outstanding · upcoming, due &amp; overdue</div>
        </div>
      </div>

      {/* REMINDERS — due soon (first & prominent) */}
      <Card
        title="Reminders — due soon"
        action={
          <span className="flex" style={{ gap: 6 }}>
            {overdueCount > 0 && <Badge tone="red"><AlarmClock size={11} /> {overdueCount} overdue</Badge>}
            {soonCount > 0 && <Badge tone="gold">{soonCount} due within 7 days</Badge>}
            {overdueCount === 0 && soonCount === 0 && dueRows.length > 0 && <Badge tone="gray">{dueRows.length} scheduled</Badge>}
          </span>
        }
      >
        {dueRows.length === 0 ? (
          <div className="empty">
            Nothing due. When you add an obligation below, it shows up here as the due date approaches.
          </div>
        ) : (
          <div style={{ padding: "4px 0" }}>
            {dueRows.map((r: any) => {
              const u = urgencyOf(r);
              const accent = u === "overdue" ? "var(--danger)" : u === "soon" ? "var(--warning)" : "transparent";
              return (
                <div
                  key={r.id}
                  className="between"
                  style={{
                    padding: "13px 22px",
                    borderTop: "1px solid var(--line)",
                    boxShadow: accent === "transparent" ? "none" : `inset 3px 0 0 ${accent}`,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div className="flex" style={{ gap: 9, flexWrap: "wrap" }}>
                      <span className="strong">{r.payee || "—"}</span>
                      <CategoryBadge c={r.category} />
                      <RecurrenceBadge r={r.recurrence} />
                      {u === "overdue" && <Badge tone="red">Overdue</Badge>}
                      {u === "soon" && <Badge tone="gold">Due soon</Badge>}
                    </div>
                    <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>
                      {r.purpose ? `${r.purpose} · ` : ""}
                      {r.due_on ? `Due ${date(r.due_on)}` : "No due date"}
                      {r.vendor_country ? ` · ${r.vendor_country}` : ""}
                      {` · ${methodLabel[r.method] || r.method}`}
                    </div>
                  </div>
                  <div className="flex" style={{ gap: 12, flexShrink: 0 }}>
                    <span className="strong" style={{ whiteSpace: "nowrap" }}>{fmt(r.amount, r.currency)}</span>
                    <form action={markPaid} style={{ display: "inline" }}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="btn teal sm" type="submit">Mark paid</button>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* RECURRING OBLIGATIONS grouped by category */}
      <div style={{ marginTop: 16 }}>
        <Card
          title="Recurring obligations"
          action={<Badge tone="gray">{recurring.length} active</Badge>}
        >
          {recurring.length === 0 ? (
            <div className="empty">
              No recurring obligations yet. Add a subscription, salary or vendor payment below and set it to repeat monthly or yearly — it will refresh itself every cycle.
            </div>
          ) : (
            <div style={{ padding: "8px 22px 18px" }}>
              {CATEGORY_ORDER.filter((c) => recurringByCat[c]?.length).map((c) => {
                const meta = CATEGORY_META[c];
                const Icon = meta.icon;
                return (
                  <div key={c} style={{ marginTop: 14 }}>
                    <div className="flex" style={{ gap: 8, marginBottom: 8 }}>
                      <span className={`aico ${aicoClass(meta.tone)}`} style={{ width: 26, height: 26, borderRadius: 8 }}>
                        <Icon size={14} />
                      </span>
                      <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13.5 }}>{meta.label}</span>
                      <Badge tone="gray">{recurringByCat[c].length}</Badge>
                    </div>
                    {recurringByCat[c].map((r: any, i: number) => (
                      <div
                        key={r.id}
                        className="between"
                        style={{ padding: "9px 0", borderTop: i ? "1px solid var(--line)" : "none", fontSize: 13 }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <span className="strong">{r.payee || "—"}</span>
                          {r.purpose && <span className="muted"> · {r.purpose}</span>}
                          <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>
                            {r.recurrence === "monthly" ? "Every month" : "Every year"}
                            {r.due_on ? ` · next ${date(r.due_on)}` : ""}
                            {r.vendor_country ? ` · ${r.vendor_country}` : ""}
                          </div>
                        </div>
                        <div className="flex" style={{ gap: 10, flexShrink: 0 }}>
                          <RecurrenceBadge r={r.recurrence} />
                          <span className="strong" style={{ whiteSpace: "nowrap" }}>{fmt(r.amount, r.currency)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* forms: add obligation + M-Pesa upload */}
      <div className="grid cols-2" style={{ marginTop: 16 }}>
        {/* add a payment / obligation */}
        <Card title="Add a payment / obligation">
          <form action={addPayment} className="card-pad stack" style={{ gap: 12 }}>
            <div>
              <label>Category</label>
              <select name="category" defaultValue="subscription" style={{ marginTop: 5 }}>
                <option value="subscription">Subscription</option>
                <option value="salary">Salary</option>
                <option value="vendor">Vendor</option>
                <option value="kenya">Kenya</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label>Payee</label>
              <input name="payee" placeholder="e.g. Canva, Kenya field team, ISP" required style={{ marginTop: 5 }} />
            </div>
            <div>
              <label>Purpose</label>
              <input name="purpose" placeholder="e.g. Annual plan, March stipends" style={{ marginTop: 5 }} />
            </div>
            <div className="grid cols-2" style={{ gap: 12 }}>
              <div>
                <label>Amount</label>
                <input name="amount" type="number" min="0" step="0.01" placeholder="0" required style={{ marginTop: 5 }} />
              </div>
              <div>
                <label>Currency</label>
                <select name="currency" defaultValue="USD" style={{ marginTop: 5 }}>
                  <option value="USD">USD</option>
                  <option value="KES">KES</option>
                </select>
              </div>
            </div>
            <div className="grid cols-2" style={{ gap: 12 }}>
              <div>
                <label>Method</label>
                <select name="method" defaultValue="bank" style={{ marginTop: 5 }}>
                  <option value="bank">Bank</option>
                  <option value="card">Card</option>
                  <option value="mpesa">M-Pesa</option>
                </select>
              </div>
              <div>
                <label>Due date</label>
                <input name="due_on" type="date" style={{ marginTop: 5 }} />
              </div>
            </div>
            <div className="grid cols-2" style={{ gap: 12 }}>
              <div>
                <label>Repeats</label>
                <select name="recurrence" defaultValue="none" style={{ marginTop: 5 }}>
                  <option value="none">One-off</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              <div>
                <label>Vendor country (optional)</label>
                <input name="vendor_country" placeholder="e.g. Kenya" style={{ marginTop: 5 }} />
              </div>
            </div>
            <button className="btn teal full" type="submit"><Plus size={15} /> Save obligation</button>
            <div className="faint" style={{ fontSize: 11 }}>
              Saved as “upcoming”. Recurring items re-schedule themselves the moment you mark them paid.
            </div>
          </form>
        </Card>

        {/* M-Pesa screenshot */}
        <Card title="Log an M-Pesa receipt">
          <form action={logMpesa} className="card-pad stack" style={{ gap: 12 }}>
            <label
              htmlFor="mpesa-file"
              style={{ display: "block", padding: 24, textAlign: "center", cursor: "pointer", border: "2px dashed var(--line-2)", borderRadius: "var(--radius)" }}
            >
              <div style={{ width: 46, height: 46, borderRadius: 13, background: "var(--peri-50)", color: "var(--peri-700)", display: "grid", placeItems: "center", margin: "0 auto 10px" }}>
                <ReceiptText size={22} />
              </div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Upload an M-Pesa confirmation</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Sasa reads the amount, date, payee &amp; ref, then logs it as a paid KES payment.
              </div>
              <div className="faint" id="mpesa-filename" style={{ fontSize: 11.5, marginTop: 8 }} />
            </label>
            <input id="mpesa-file" type="file" name="file" accept="image/*" required style={{ display: "none" }} />
            <button className="btn full" type="submit"><UploadCloud size={15} /> Read &amp; log receipt</button>
            <div className="faint" style={{ fontSize: 11 }}>
              If the amount can’t be read, it’s still logged and flagged for review.
            </div>
          </form>
        </Card>
      </div>

      {/* paid history */}
      <div style={{ marginTop: 16 }}>
        <Card title="Paid history" action={<Badge tone="gray">{paidHistory.length}</Badge>}>
          {paidHistory.length === 0 ? (
            <div className="empty">No payments recorded yet. Mark a reminder paid above, or log an M-Pesa receipt.</div>
          ) : (
            <div style={{ padding: "4px 0" }}>
              {paidHistory.map((r: any, i: number) => (
                <div
                  key={r.id}
                  className="between"
                  style={{ padding: "12px 22px", borderTop: i ? "1px solid var(--line)" : "none" }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div className="flex" style={{ gap: 9, flexWrap: "wrap" }}>
                      <span className="aico green" style={{ width: 26, height: 26, borderRadius: 8 }}><CheckCircle2 size={14} /></span>
                      <span className="strong">{r.payee || "—"}</span>
                      {r.category && <CategoryBadge c={r.category} />}
                      <Badge tone="gray">{methodLabel[r.method] || r.method}</Badge>
                    </div>
                    <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>
                      {r.purpose ? `${r.purpose} · ` : ""}
                      Paid {date(r.paid_at)}
                      {r.ref ? ` · ref ${r.ref}` : ""}
                    </div>
                  </div>
                  <span className="strong" style={{ whiteSpace: "nowrap", flexShrink: 0 }}>{fmt(r.amount, r.currency)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </Shell>
  );
}
