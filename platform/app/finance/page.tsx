import Shell from "../../components/Shell";
import { Card, Table, Badge, Col, statusTone } from "../../components/ui";
import { admin, money, date } from "../../lib/supabase-admin";
import { addPayment, markPaid, logMpesa } from "./actions";
import { ArrowDownLeft, ArrowUpRight, CalendarClock, Plus, ReceiptText, UploadCloud } from "lucide-react";

export const dynamic = "force-dynamic";

const methodLabel: Record<string, string> = { mpesa: "M-Pesa", bank: "Bank", card: "Card" };
// upcoming/due before paid; within a group, soonest due first
const STATUS_RANK: Record<string, number> = { overdue: 0, due: 1, upcoming: 2, paid: 3 };

export default async function Finance() {
  const db = admin();

  // start of the current month (local) for "this month" sums
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [donRes, payRes] = await Promise.all([
    db.from("donations").select("amount,status,donated_at").gte("donated_at", monthStart).limit(2000),
    db.from("payments").select("*").limit(500),
  ]);

  const donations = (donRes.data || []) as any[];
  const payments = (payRes.data || []) as any[];

  // Money in: succeeded donations this month
  const moneyIn = donations
    .filter((d) => (d.status || "").toLowerCase() === "succeeded")
    .reduce((s, d) => s + Number(d.amount || 0), 0);

  // Money out: payments marked paid this month
  const moneyOut = payments
    .filter((p) => p.status === "paid" && p.paid_at && new Date(p.paid_at).toISOString() >= monthStart)
    .reduce((s, p) => s + Number(p.amount || 0), 0);

  // Upcoming: anything still owed (upcoming | due | overdue)
  const upcoming = payments
    .filter((p) => ["upcoming", "due", "overdue"].includes(p.status))
    .reduce((s, p) => s + Number(p.amount || 0), 0);

  // sort: unpaid first (by due date), paid last (by paid date desc)
  const sorted = [...payments].sort((a, b) => {
    const ra = STATUS_RANK[a.status] ?? 9;
    const rb = STATUS_RANK[b.status] ?? 9;
    if (ra !== rb) return ra - rb;
    if (a.status === "paid" && b.status === "paid") {
      return new Date(b.paid_at || 0).getTime() - new Date(a.paid_at || 0).getTime();
    }
    return new Date(a.due_on || "9999-12-31").getTime() - new Date(b.due_on || "9999-12-31").getTime();
  });

  const cols: Col<any>[] = [
    {
      key: "payee",
      label: "Payee",
      render: (r) => (
        <div>
          <span className="strong">{r.payee || "—"}</span>
          {r.purpose && <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>{r.purpose}</div>}
        </div>
      ),
    },
    { key: "method", label: "Method", render: (r) => <Badge tone="gray">{methodLabel[r.method] || r.method}</Badge> },
    { key: "status", label: "Status", render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    {
      key: "when",
      label: "Due / Paid",
      render: (r) =>
        r.status === "paid"
          ? <span className="muted">Paid {date(r.paid_at)}</span>
          : r.due_on
            ? <span className="muted">Due {date(r.due_on)}</span>
            : "—",
    },
    { key: "amount", label: "Amount", align: "right", render: (r) => <span className="strong">{money(r.amount)}</span> },
    {
      key: "act",
      label: "",
      align: "right",
      render: (r) =>
        r.status === "paid" ? (
          "—"
        ) : (
          <form action={markPaid} style={{ display: "inline" }}>
            <input type="hidden" name="id" value={r.id} />
            <button className="btn ghost sm" type="submit">Mark paid</button>
          </form>
        ),
    },
  ];

  return (
    <Shell title="Finance" sub="Money in, money out, and what's coming due. Logging records a payment — it never moves money.">
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
          <div className="fmeta">Money out · payments made this month</div>
        </div>
        <div className="feature dark">
          <div className="ficon"><CalendarClock size={20} /></div>
          <div className="ftitle">{money(upcoming)}</div>
          <div className="fmeta">Upcoming · due &amp; scheduled</div>
        </div>
      </div>

      {/* forms: add payment + M-Pesa upload */}
      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        {/* add payment */}
        <Card title="Add a payment">
          <form action={addPayment} className="card-pad stack" style={{ gap: 12 }}>
            <input type="hidden" name="direction" value="out" />
            <div>
              <label>Payee</label>
              <input name="payee" placeholder="e.g. Kenya field team" required style={{ marginTop: 5 }} />
            </div>
            <div>
              <label>Purpose</label>
              <input name="purpose" placeholder="e.g. March stipends" style={{ marginTop: 5 }} />
            </div>
            <div className="grid cols-2" style={{ gap: 12 }}>
              <div>
                <label>Amount (USD)</label>
                <input name="amount" type="number" min="0" step="0.01" placeholder="0" required style={{ marginTop: 5 }} />
              </div>
              <div>
                <label>Due date</label>
                <input name="due_on" type="date" style={{ marginTop: 5 }} />
              </div>
            </div>
            <div>
              <label>Method</label>
              <select name="method" defaultValue="mpesa" style={{ marginTop: 5 }}>
                <option value="mpesa">M-Pesa</option>
                <option value="bank">Bank</option>
                <option value="card">Card</option>
              </select>
            </div>
            <button className="btn teal full" type="submit"><Plus size={15} /> Record payment</button>
            <div className="faint" style={{ fontSize: 11 }}>Records an obligation as “upcoming”. Mark it paid when it clears.</div>
          </form>
        </Card>

        {/* M-Pesa screenshot */}
        <Card title="Log an M-Pesa receipt">
          <form action={logMpesa} className="card-pad stack" style={{ gap: 12 }}>
            <label htmlFor="mpesa-file" style={{ display: "block", padding: 24, textAlign: "center", cursor: "pointer", border: "2px dashed var(--line-2)", borderRadius: "var(--radius)" }}>
              <div style={{ width: 46, height: 46, borderRadius: 13, background: "var(--peri-50)", color: "var(--peri-700)", display: "grid", placeItems: "center", margin: "0 auto 10px" }}><ReceiptText size={22} /></div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Upload an M-Pesa confirmation</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Sasa reads the amount, date, payee &amp; ref, then logs it as paid.</div>
              <div className="faint" id="mpesa-filename" style={{ fontSize: 11.5, marginTop: 8 }} />
            </label>
            <input id="mpesa-file" type="file" name="file" accept="image/*" required style={{ display: "none" }} />
            <button className="btn full" type="submit"><UploadCloud size={15} /> Read &amp; log receipt</button>
            <div className="faint" style={{ fontSize: 11 }}>If the amount can’t be read, it’s still logged and flagged for review.</div>
          </form>
        </Card>
      </div>

      {/* payments list */}
      <Card title="Payments">
        <Table
          columns={cols}
          rows={sorted}
          empty="No payments yet. Record one above, or log an M-Pesa receipt."
        />
      </Card>
    </Shell>
  );
}
