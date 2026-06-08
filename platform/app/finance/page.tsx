import Link from "next/link";
import Shell from "../../components/Shell";
import { Card, Badge } from "../../components/ui";
import { admin, date } from "../../lib/supabase-admin";
import { Money, MoneyHideToggle } from "../../components/Money";
import { addPayment, markPaid, logMpesa, logPayout } from "./actions";
import ExpenseIntake from "../../components/ExpenseIntake";
import SubmitButton from "../../components/SubmitButton";
import Collapsible from "../../components/Collapsible";
import FinancePulse from "../../components/FinancePulse";
import Treasury from "../../components/Treasury";
import MoneyFlows from "../../components/MoneyFlows";
import FinanceLedger from "../../components/FinanceLedger";
import BankingView from "../../components/BankingView";
import KenyaReceiptUpload from "../../components/KenyaReceiptUpload";
import Countdown from "../../components/Countdown";
import ExpenseTrioHero from "../../components/ExpenseTrioHero";
import ExpenseList from "../../components/ExpenseList";
import { periodFor, dubaiToday } from "../../lib/period";
import { loadExpenses, sumByCurrency, loadRefunds } from "../../lib/expenses";
import { loadUpcoming } from "../../lib/upcoming";
import { getMonthlyGoal } from "../../lib/org-settings";
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
  Landmark,
  ArrowRight,
  ShoppingBag,
  Banknote,
  FileText,
} from "lucide-react";

export const dynamic = "force-dynamic";

const methodLabel: Record<string, string> = { mpesa: "M-Pesa", bank: "Bank", card: "Card", givebutter: "Givebutter" };

// Categories → label + icon + badge tone, in display order.
const CATEGORY_META: Record<string, { label: string; tone: any; icon: any }> = {
  payroll: { label: "Payroll", tone: "teal", icon: Users },
  salary: { label: "Salaries", tone: "teal", icon: Users },
  stipend: { label: "Stipends", tone: "peri", icon: Users },
  rent: { label: "Rent", tone: "gold", icon: Building2 },
  utilities: { label: "Utilities", tone: "blue", icon: Wallet },
  subscription: { label: "Subscriptions", tone: "blue", icon: CreditCard },
  "petty cash": { label: "Petty cash", tone: "gray", icon: Banknote },
  upkeep: { label: "Upkeep", tone: "green", icon: ShoppingBag },
  kenya: { label: "Kenya", tone: "green", icon: MapPin },
  vendor: { label: "Vendors", tone: "gold", icon: Building2 },
  payout: { label: "Givebutter payouts", tone: "peri", icon: Landmark },
  other: { label: "Other", tone: "gray", icon: CircleDot },
};
const CATEGORY_ORDER = ["payroll", "salary", "stipend", "rent", "utilities", "subscription", "petty cash", "upkeep", "kenya", "vendor", "payout", "other"];
const catSingular: Record<string, string> = {
  subscription: "Subscription",
  salary: "Salary",
  kenya: "Kenya",
  vendor: "Vendor",
  payout: "Payout",
  other: "Other",
};

// Map a Badge tone to a valid .aico colour class (subset differs from badges).
function aicoClass(tone: string): string {
  return ["teal", "peri", "green", "gold", "red", "gray"].includes(tone) ? tone : "teal";
}

const DAY = 86_400_000;

export default async function Finance() {
  const db = admin();

  const now = new Date();
  // Dubai-TZ consistency (Phase 2.6 Stage B): legacy sections previously used
  // server-UTC monthStart, which drifts ~4h from the new Phase 2.3 sections
  // that use periodFor("this_month") from lib/period.ts. Now both flows read
  // the same Dubai-local month boundary. The string is in ISO-Z form so the
  // existing `new Date(p.paid_at).toISOString() >= monthStart` comparisons
  // keep working without any other code change.
  const dubaiMonthStart = `${periodFor("this_month").from}T00:00:00.000Z`;
  const monthStart = dubaiMonthStart;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Dubai-TZ periods for the three-card hero + expense list
  const thisMonth = periodFor("this_month");
  const lastMonth = periodFor("last_month");
  const todayIso = dubaiToday();

  const [donRes, payRes, teamRes, expRows, upcomingRows, expLastMonth, monthlyGoal, refunds] = await Promise.all([
    db.from("donations").select("amount,currency,status,donated_at").gte("donated_at", thisMonth.from).limit(2000),
    db.from("payments").select("*").limit(1000),
    db.from("team_members").select("id,name").limit(500),
    loadExpenses(db, thisMonth),
    loadUpcoming(db),
    loadExpenses(db, lastMonth),
    getMonthlyGoal(db),
    loadRefunds(db, thisMonth),
  ]);

  const donations = (donRes.data || []) as any[];
  const payments = (payRes.data || []) as any[];
  const teamMembers = (teamRes.data || []) as any[];

  // Donations this month split by currency (Currency Law: never blend)
  const donationsThisMonth = donations.filter((d: any) => (d.status || "").toLowerCase() === "succeeded");
  const donationTotals: Record<string, number> = {};
  for (const d of donationsThisMonth) {
    const c = String(d.currency || "USD").toUpperCase();
    donationTotals[c] = (donationTotals[c] || 0) + Number(d.amount || 0);
  }

  // Money out this month: from the UNION query (already excludes Givebutter payouts + dedup)
  const outTotals = sumByCurrency(expRows);
  const outLastTotals = sumByCurrency(expLastMonth);
  const primaryCcy = outTotals.KES ? "KES" : outTotals.USD ? "USD" : "KES";
  const outNow = outTotals[primaryCcy] || 0;
  const outPrev = outLastTotals[primaryCcy] || 0;
  const outDeltaPct = outPrev > 0 ? Math.round(((outNow - outPrev) / outPrev) * 100) : null;

  // Resolve a payroll payee to a team member so a salary row links to the 360.
  // Payee spellings drift from member names in a few rows, so reconcile those.
  const normName = (s: any) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const NAME_ALIAS: Record<string, string> = {
    "julia mwaniki": "julia mwanki",
    "monicah wanjira": "monica wanjira",
    "elizabeth kariuki": "eliza kariuki",
    "michell nyambura": "mitchelle nyambura",
  };
  const memberByName = new Map(teamMembers.map((m) => [normName(m.name), m.id]));
  const memberIdFor = (payee: any) => memberByName.get(NAME_ALIAS[normName(payee)] || normName(payee)) || null;

  // ---- salaries this month: the recurring payroll obligations themselves ----
  // Payroll lives in `payments` (category payroll/salary, monthly). An unpaid
  // one ticks down to its payday; marking it paid runs through the SAME markPaid
  // as any obligation (so it counts as money out, lands in paid history, and
  // re-schedules next month). Unpaid first, then this month's confirmed.
  const SALARY_CATS = ["payroll", "salary"];
  const isSalary = (p: any) => SALARY_CATS.includes(p.category);
  const salaryPeriodLabel = now.toLocaleString("en-US", { month: "long", year: "numeric" });
  const dueTimeOf = (p: any) => new Date((p.due_on || "9999-12-31") + "T00:00:00").getTime();

  const salaryUnpaid = payments
    .filter((p: any) => isSalary(p) && ["scheduled", "upcoming", "due", "overdue"].includes(p.status))
    .sort((a: any, b: any) => dueTimeOf(a) - dueTimeOf(b));
  const salaryPaidMonth = payments
    .filter((p: any) => isSalary(p) && p.status === "paid" && p.paid_at && new Date(p.paid_at).toISOString() >= monthStart)
    .sort((a: any, b: any) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime());
  const salaryTotal = salaryUnpaid.length + salaryPaidMonth.length;
  const salaryOverdueCount = salaryUnpaid.filter((p: any) => p.due_on && dueTimeOf(p) < today.getTime()).length;
  // Honesty: "paid" is only trustworthy with proof. Count how many of this month's
  // marked-paid salaries actually carry a proof attachment (screenshot/receipt).
  const salaryWithProof = salaryPaidMonth.filter((p: any) => !!p.screenshot_path).length;

  const isUsd = (p: any) => (p.currency || "USD").toUpperCase() === "USD";
  const paidThisMonth = (p: any) =>
    p.status === "paid" && p.paid_at && new Date(p.paid_at).toISOString() >= monthStart;

  // ---- top metrics: a real in/out/net ledger ------------------------------
  // Money in: succeeded donations this month (donations are USD-denominated)
  const moneyIn = donations
    .filter((d: any) => (d.status || "").toLowerCase() === "succeeded")
    .reduce((s: number, d: any) => s + Number(d.amount || 0), 0);

  // Money out: everything paid this month in USD — obligations AND Givebutter
  // payouts (the payout is genuine cash leaving the Givebutter balance).
  const moneyOut = payments
    .filter((p: any) => paidThisMonth(p) && isUsd(p))
    .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);

  // Net for the month (USD). Donations in minus USD cash out.
  const netMonth = moneyIn - moneyOut;

  // Outstanding: everything still owed (USD obligations) — upcoming | due | overdue
  const outstandingUsd = payments
    .filter((p: any) => ["upcoming", "due", "overdue"].includes(p.status) && isUsd(p))
    .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);

  // ---- Givebutter → Kenya reconciliation (all-time) -----------------------
  // Withdrawn: total Givebutter payouts (cash pulled to the bank). Both the
  // synced rows (category=payout) and any method=givebutter count.
  const payoutRows = payments.filter(
    (p: any) => p.category === "payout" || p.method === "givebutter",
  );
  const withdrawnUsd = payoutRows
    .filter((p: any) => isUsd(p))
    .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const payoutCount = payoutRows.length;

  // Spent in Kenya: everything tagged category=kenya OR paid via M-Pesa.
  // These are KES-denominated, so we sum them in KES and keep them separate
  // from the USD withdrawn figure (no FX assumed — Nur reads both side by side).
  const kenyaRows = payments.filter(
    (p: any) => (p.category === "kenya" || p.method === "mpesa") && p.status === "paid",
  );
  const kenyaSpentKes = kenyaRows
    .filter((p: any) => (p.currency || "KES").toUpperCase() === "KES")
    .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const kenyaSpentUsd = kenyaRows
    .filter((p: any) => (p.currency || "").toUpperCase() === "USD")
    .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const kenyaCount = kenyaRows.length;

  // ---- reminders: due soon ------------------------------------------------
  // Everything still owed that isn't payroll (salaries get their own card).
  // "scheduled" recurring bills count too — they were invisible before, which
  // is why nothing showed even with obligations due in days.
  // EXCLUDE Givebutter payouts: per the finance doctrine they are the bridge
  // (USD donations -> Kenya cash), NOT an operating bill to be reminded about /
  // "marked paid". They have their own reconciliation, never a due-soon reminder.
  const isPayout = (p: any) => p.category === "payout" || p.method === "givebutter";
  const dueRows = payments
    .filter((p: any) => !isSalary(p) && !isPayout(p) && ["scheduled", "upcoming", "due", "overdue"].includes(p.status))
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
      sub="The books, reconciled. Money in against money out. Logging records a payment, it never moves money."
      action={
        <Link className="btn ghost sm" href="/reports">
          <FileText size={14} /> Reports
        </Link>
      }
    >
      {/* THREE-CARD HERO at the very top of /finance (Taona 2026-06-08): the
          three operator-asked cards (Donations this month / Money out this month
          / Upcoming payments) lead, EVERYTHING ELSE goes below — including the
          legacy net-cashflow hero, Payables, Treasury, and the archive drawer. */}
      <ExpenseTrioHero
        donationTotals={donationTotals}
        donationCount={donationsThisMonth.length}
        monthlyGoal={monthlyGoal}
        outTotals={outTotals}
        outCount={expRows.length}
        outDeltaPct={outDeltaPct}
        upcoming={upcomingRows}
        refunds={refunds}
      />

      {/* EXPENSE LIST (spec/002 v2): the queryable bank-statement-style ledger
          for "what flowed out and when." Time pills + search + date groups. */}
      <div id="expense-list" style={{ marginBottom: 18 }}>
        <ExpenseList rows={expRows} today={todayIso} />
      </div>

      {/* HERO (Drill-to-core, Law 5): lead with real cash movement this month, not the
          lifetime "raised to date" vanity total. Every figure here is queried in this file:
          moneyIn (succeeded donations this month), moneyOut (USD paid this month), netMonth,
          outstandingUsd (still owed). The in vs out split bar uses those same real amounts.
          A single live "cash on hand" plus runway is intentionally NOT printed here: no such
          figure is reliably computed and inventing one would violate the Honesty Law. The
          honest cash position (USD held, last reconciled bank balance) lives in Treasury,
          kept directly below as the authoritative A-to-Z read. */}
      {(() => {
        const flowTotal = moneyIn + moneyOut;
        const inPct = flowTotal > 0 ? Math.round((moneyIn / flowTotal) * 100) : 0;
        const outPct = flowTotal > 0 ? 100 - inPct : 0;
        return (
          <div className="metric-hero">
            <MoneyHideToggle style={{ position: "absolute", top: 16, right: 18, zIndex: 3 }} />
            <div className="mh-row">
              <div style={{ minWidth: 0 }}>
                <div className="mh-label">Net cash flow · this month (USD)</div>
                <div className="mh-num disp2">
                  {netMonth < 0 ? "−" : ""}<Money amount={Math.abs(netMonth)} />
                </div>
                <div className="mh-sub">
                  <Money amount={moneyIn} /> in against <Money amount={moneyOut} /> out
                  {outstandingUsd > 0 ? (
                    <>{" · "}<Money amount={outstandingUsd} /> still owed</>
                  ) : null}
                </div>
              </div>
              <div className="stack" style={{ gap: 8, minWidth: 200, flex: "1 1 220px", maxWidth: 360 }}>
                <div
                  aria-hidden
                  style={{
                    display: "flex",
                    height: 10,
                    borderRadius: 999,
                    overflow: "hidden",
                    background: "rgba(255,255,255,0.12)",
                  }}
                >
                  <span style={{ width: `${inPct}%`, background: "#39d9d4" }} />
                  <span style={{ width: `${outPct}%`, background: "rgba(255,255,255,0.28)" }} />
                </div>
                <div className="flex" style={{ justifyContent: "space-between", fontSize: 12, fontWeight: 700 }}>
                  <span style={{ color: "#7df3f1" }}>Money in {inPct}%</span>
                  <span style={{ color: "rgba(255,255,255,0.7)" }}>Money out {outPct}%</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* PAYABLES OWED (Law 5): total still owed plus aging chips, from data already fetched
          on this page (dueRows + salaryUnpaid). overdueCount / soonCount come from urgencyOf;
          outstandingUsd is the USD obligations total computed above; salaries are summarised by
          count and per-currency to avoid mixing KES and USD (Currency Law). */}
      {(() => {
        const salaryUnpaidUsd = salaryUnpaid
          .filter((p: any) => isUsd(p))
          .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
        const salaryUnpaidKes = salaryUnpaid
          .filter((p: any) => (p.currency || "KES").toUpperCase() === "KES")
          .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
        return (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-h">
              <span className="flex" style={{ gap: 7 }}><AlarmClock size={15} /> Payables owed</span>
              <span className="flex" style={{ gap: 6, alignItems: "center" }}>
                {overdueCount > 0 && <Badge tone="red"><AlarmClock size={11} /> {overdueCount} overdue</Badge>}
                {soonCount > 0 && <Badge tone="gold">{soonCount} due within 7 days</Badge>}
                {salaryUnpaid.length > 0 && <Badge tone="teal"><Users size={11} /> {salaryUnpaid.length} salaries unpaid</Badge>}
              </span>
            </div>
            <div className="card-pad">
              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
                <div>
                  <div className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 4 }}>Obligations owed (USD)</div>
                  <div className="strong disp2" style={{ fontSize: 26, fontWeight: 700 }}><Money amount={outstandingUsd} currency="USD" /></div>
                  <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>upcoming, due and overdue bills</div>
                </div>
                <div>
                  <div className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 4 }}>Salaries unpaid</div>
                  <div className="stack" style={{ gap: 2 }}>
                    {salaryUnpaidUsd > 0 && <div className="strong disp2" style={{ fontSize: 22, fontWeight: 700 }}><Money amount={salaryUnpaidUsd} currency="USD" /></div>}
                    {salaryUnpaidKes > 0 && <div className="strong disp2" style={{ fontSize: 22, fontWeight: 700 }}><Money amount={salaryUnpaidKes} currency="KES" /></div>}
                    {salaryUnpaidUsd === 0 && salaryUnpaidKes === 0 && <div className="strong disp2" style={{ fontSize: 22, fontWeight: 700 }}>All paid</div>}
                  </div>
                  <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>{salaryPeriodLabel}{salaryOverdueCount > 0 ? ` · ${salaryOverdueCount} overdue` : ""}</div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* TREASURY: the A-to-Z money summary (Law 7). Lifetime in/out per currency, blended
          USD with FX visible, honest cash position. Sits under the cash hero. */}
      <Treasury />

      {/* ARCHIVE WRAPPER (Phase 2.5): everything below this point is operator
          tooling + historical streams (salaries, reminders, ledger, banking,
          intake forms). Closed by default so /finance reads as the CFO view at
          the top, not a tool drawer. Open with one click. */}
      <Collapsible
        defaultOpen={false}
        title="Operator tools & historical streams"
        action={<Badge tone="gray">Salaries · Reminders · Ledger · Banking · Forms</Badge>}
      >
      <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 8 }}>

      {/* SALARIES — this month: recurring payroll, ticking to payday (dropdown) */}
      <Collapsible
        defaultOpen
        title="Salaries: this month"
        action={
            <span className="flex" style={{ gap: 6, alignItems: "center" }}>
              <Badge tone="gray">{salaryPeriodLabel}</Badge>
              {salaryOverdueCount > 0 && <Badge tone="red"><AlarmClock size={11} /> {salaryOverdueCount} overdue</Badge>}
              {salaryTotal > 0 && (
                <Badge tone={salaryUnpaid.length === 0 ? "green" : "teal"}>
                  {salaryPaidMonth.length}/{salaryTotal} marked paid
                </Badge>
              )}
              {salaryPaidMonth.length > 0 && (
                <Badge tone={salaryWithProof === salaryPaidMonth.length ? "green" : "gold"}>
                  {salaryWithProof}/{salaryPaidMonth.length} with proof
                </Badge>
              )}
            </span>
          }
        >
          {salaryTotal === 0 ? (
            <div className="empty">
              No monthly salaries set up yet. Add a payroll obligation below (category Salary, repeats Monthly) and it
              shows here every month, counting down to payday.
            </div>
          ) : (
            <div style={{ padding: "4px 0" }}>
              {/* unpaid: ticking down to payday */}
              {salaryUnpaid.map((p: any) => {
                const overdue = !!(p.due_on && dueTimeOf(p) < today.getTime());
                const soon = !!(p.due_on && !overdue && dueTimeOf(p) - today.getTime() <= 3 * DAY);
                const accent = overdue ? "var(--danger)" : soon ? "var(--warning)" : "transparent";
                const mid = memberIdFor(p.payee);
                return (
                  <div
                    key={p.id}
                    className="between"
                    style={{
                      padding: "13px 22px",
                      borderTop: "1px solid var(--line)",
                      boxShadow: accent === "transparent" ? "none" : `inset 3px 0 0 ${accent}`,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div className="flex" style={{ gap: 9, flexWrap: "wrap" }}>
                        {mid ? (
                          <Link href={`/team/${mid}`} className="strong linkbtn">{p.payee}</Link>
                        ) : (
                          <span className="strong">{p.payee || "—"}</span>
                        )}
                        <Badge tone="teal">Salary</Badge>
                        {overdue && <Badge tone="red">Overdue</Badge>}
                      </div>
                      <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>
                        {p.purpose ? `${p.purpose} · ` : ""}
                        {salaryPeriodLabel}
                        {p.due_on ? ` · due ${date(p.due_on)}` : ""}
                      </div>
                    </div>
                    <div className="flex" style={{ gap: 12, flexShrink: 0, alignItems: "center" }}>
                      {p.due_on && (
                        <span className="chip">
                          <Countdown to={`${p.due_on}T23:59:59Z`} fallback={`due ${date(p.due_on)}`} />
                        </span>
                      )}
                      <Money amount={p.amount} currency={p.currency} className="strong" style={{ whiteSpace: "nowrap" }} />
                      <form action={markPaid} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={p.id} />
                        <SubmitButton className="btn teal sm" pendingLabel="Marking…">Mark paid</SubmitButton>
                      </form>
                    </div>
                  </div>
                );
              })}
              {/* paid this month: confirmed */}
              {salaryPaidMonth.map((p: any) => {
                const mid = memberIdFor(p.payee);
                return (
                  <div key={p.id} className="between" style={{ padding: "13px 22px", borderTop: "1px solid var(--line)" }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="flex" style={{ gap: 9, flexWrap: "wrap" }}>
                        {mid ? (
                          <Link href={`/team/${mid}`} className="strong linkbtn">{p.payee}</Link>
                        ) : (
                          <span className="strong">{p.payee || "—"}</span>
                        )}
                        {p.screenshot_path ? (
                          <a href={`/api/asset?path=${encodeURIComponent(p.screenshot_path)}`} className="linkbtn" title="View the receipt">
                            <Badge tone="green"><CheckCircle2 size={11} /> Paid · proof</Badge>
                          </a>
                        ) : String(p.created_by || "").toLowerCase().startsWith("drive") ? (
                          <Badge tone="gray">Recorded · historical</Badge>
                        ) : (
                          <Badge tone="gold">Marked paid · no proof</Badge>
                        )}
                      </div>
                      <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>
                        {p.purpose ? `${p.purpose} · ` : ""}
                        {salaryPeriodLabel} · {p.screenshot_path ? "Paid" : "Marked"} {date(p.paid_at)}
                      </div>
                    </div>
                    <Money amount={p.amount} currency={p.currency} className="strong" style={{ whiteSpace: "nowrap", flexShrink: 0 }} />
                  </div>
                );
              })}
            </div>
          )}
      </Collapsible>

      {/* REMINDERS: due soon (dropdown, open) */}
      <Collapsible
        defaultOpen
        title="Reminders: due soon"
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
                  <div className="flex" style={{ gap: 12, flexShrink: 0, alignItems: "center" }}>
                    {r.due_on && (
                      <span className="chip">
                        <Countdown to={`${r.due_on}T23:59:59Z`} fallback={`due ${date(r.due_on)}`} />
                      </span>
                    )}
                    <Money amount={r.amount} currency={r.currency} className="strong" style={{ whiteSpace: "nowrap" }} />
                    <form action={markPaid} style={{ display: "inline" }}>
                      <input type="hidden" name="id" value={r.id} />
                      <SubmitButton className="btn teal sm" pendingLabel="Marking…">Mark paid</SubmitButton>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Collapsible>

      {/* LEDGER + TREND together: real this-month spend (queryable, scrolls back) then the
          Pulse trend. The 2026 plan (MoneyFlows) is demoted to its own section lower down. */}
      <div id="ledger" />
      <FinanceLedger />
      <FinancePulse />

      {/* RECURRING OBLIGATIONS grouped by category (dropdown, closed) */}
      <Collapsible
        title="Recurring obligations"
        action={<Badge tone="gray">{recurring.length} active</Badge>}
      >
          {recurring.length === 0 ? (
            <div className="empty">
              No recurring obligations yet. Add a subscription, salary or vendor payment below and set it to repeat monthly or yearly, it will refresh itself every cycle.
            </div>
          ) : (
            <details style={{ padding: "4px 22px 18px" }}>
              <summary className="rec-summary" style={{ cursor: "pointer", padding: "12px 2px", fontSize: 13, fontWeight: 600, color: "var(--ink-2)", userSelect: "none" }}>
                Show {recurring.length} recurring obligations
              </summary>
              <div style={{ paddingTop: 4 }}>
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
                          <Money amount={r.amount} currency={r.currency} className="strong" style={{ whiteSpace: "nowrap" }} />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
              </div>
            </details>
          )}
      </Collapsible>

      {/* 2026 PLAN, demoted to its own section below the live books (Drill-to-core). */}
      <div style={{ marginTop: 16 }}>
        <MoneyFlows />
      </div>

      {/* HISTORICAL (collapsed dropdowns): bank statements + the Givebutter/Kenya streams */}
      <Collapsible title={<span className="flex" style={{ gap: 7 }}><Landmark size={15} /> Banking</span>} action={<span className="faint" style={{ fontSize: 11.5 }}>scanned statements · 2021–22</span>}>
        <div id="banking" />
        <BankingView />
      </Collapsible>

      <Collapsible
        title="Givebutter & Kenya: two streams"
        action={
          <span className="flex" style={{ gap: 8, alignItems: "center" }}>
            <Badge tone={"peri" as any}>{payoutCount} payouts</Badge>
            <Badge tone="green">{kenyaCount} Kenya payments</Badge>
            <KenyaReceiptUpload />
          </span>
        }
      >
        <div className="card-pad">
          <div className="flex" style={{ gap: 16, alignItems: "stretch", flexWrap: "wrap", justifyContent: "space-between" }}>
            <div style={{ flex: "1 1 200px", minWidth: 180 }}>
              <div className="flex" style={{ gap: 9 }}><span className="aico peri" style={{ width: 30, height: 30, borderRadius: 9 }}><Landmark size={15} /></span><span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13.5 }}>Withdrawn from Givebutter</span></div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 26, letterSpacing: "-0.03em", marginTop: 10 }}><Money amount={withdrawnUsd} /></div>
              <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>Cash wired to the bank across {payoutCount} payout{payoutCount === 1 ? "" : "s"}</div>
            </div>
            <div style={{ flex: "1 1 200px", minWidth: 180 }}>
              <div className="flex" style={{ gap: 9 }}><span className="aico green" style={{ width: 30, height: 30, borderRadius: 9 }}><MapPin size={15} /></span><span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13.5 }}>Paid out in Kenya</span></div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 26, letterSpacing: "-0.03em", marginTop: 10 }}><Money amount={kenyaSpentKes} currency="KES" /></div>
              <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>{kenyaCount} Kenya payment{kenyaCount === 1 ? "" : "s"} (M-Pesa &amp; field spend){kenyaSpentUsd > 0 ? (<> · plus <Money amount={kenyaSpentUsd} /> in USD</>) : null}</div>
            </div>
          </div>
          <div className="faint" style={{ fontSize: 11.5, marginTop: 16, lineHeight: 1.5 }}>Two independent streams shown side by side, not a forced match. Kenya money also comes from grants and direct gifts outside Givebutter, so we never claim every shilling traces to a payout.</div>
        </div>
      </Collapsible>

      {/* TOOLS: log/record (data entry lives below the information) */}
      <div id="finance-expense-intake" style={{ marginTop: 16 }}>
        <ExpenseIntake />
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
            <SubmitButton className="btn teal full" pendingLabel="Saving…"><Plus size={15} /> Save obligation</SubmitButton>
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
            <SubmitButton className="btn full" pendingLabel="Reading…"><UploadCloud size={15} /> Read &amp; log receipt</SubmitButton>
            <div className="faint" style={{ fontSize: 11 }}>
              If the amount can’t be read, it’s still logged and flagged for review.
            </div>
          </form>
        </Card>
      </div>

      {/* money-in sources: manual Givebutter payout + Folklore placeholder */}
      <div className="grid cols-2" style={{ marginTop: 16 }}>
        {/* manual Givebutter payout */}
        <Card title="Log a Givebutter payout">
          <form action={logPayout} className="card-pad stack" style={{ gap: 12 }}>
            <div className="flex" style={{ gap: 9 }}>
              <span className="aico peri" style={{ width: 34, height: 34, borderRadius: 11 }}>
                <Landmark size={16} />
              </span>
              <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                Payouts normally sync from Givebutter automatically. Use this when a withdrawal hasn’t synced yet:
                it records the cash that left Givebutter and funds Kenya.
              </div>
            </div>
            <div className="grid cols-2" style={{ gap: 12 }}>
              <div>
                <label>Amount (USD)</label>
                <input name="amount" type="number" min="0" step="0.01" placeholder="0" required style={{ marginTop: 5 }} />
              </div>
              <div>
                <label>Payout date</label>
                <input name="paid_at" type="date" style={{ marginTop: 5 }} />
              </div>
            </div>
            <SubmitButton className="btn teal full" pendingLabel="Logging…"><Banknote size={15} /> Log payout</SubmitButton>
            <div className="faint" style={{ fontSize: 11 }}>
              Recorded as a paid, money-out Givebutter payout. It shows in the reconciliation above and in paid history.
            </div>
          </form>
        </Card>

        {/* Folklore sales: not a connected source yet. Demoted to a slim note so an
            inert "coming soon" button does not take prime real estate (Earn-your-place). */}
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, alignSelf: "center", padding: "8px 4px" }}>
          <span className="aico gold" style={{ width: 26, height: 26, borderRadius: 9, marginRight: 8, verticalAlign: "middle" }}>
            <ShoppingBag size={13} />
          </span>
          Folklore sales aren’t connected yet, so they’re not counted in money-in. Log proceeds as a manual income entry until the integration lands.
        </div>
      </div>

      {/* paid history: collapsed by default, expand on demand */}
      <div style={{ marginTop: 16 }}>
        <details className="card collapse">
          <summary className="collapse-head">
            <span className="flex" style={{ gap: 9 }}>
              <span className="collapse-chev"><ArrowRight size={14} /></span>
              Paid history
            </span>
            <Badge tone="gray">{paidHistory.length}</Badge>
          </summary>
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
                  <Money amount={r.amount} currency={r.currency} className="strong" style={{ whiteSpace: "nowrap", flexShrink: 0 }} />
                </div>
              ))}
            </div>
          )}
        </details>
      </div>

      </div>
      </Collapsible>
      {/* END ARCHIVE WRAPPER */}
    </Shell>
  );
}
