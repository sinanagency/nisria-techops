import Link from "next/link";
import Shell from "../../components/Shell";
import { Card, Badge } from "../../components/ui";
import { admin, date } from "../../lib/supabase-admin";
import { Money } from "../../components/Money";
import PreviewLink from "../../components/PreviewLink";
import ReportNarrative from "../../components/ReportNarrative";
import ReportBuilder from "../../components/ReportBuilder";
import InvoiceBuilder from "../../components/InvoiceBuilder";
import ReportsTabs from "../../components/ReportsTabs";
import ReportArchive from "../../components/ReportArchive";
import PrintButton from "../../components/PrintButton";
import type { NarrativeInput } from "./actions";
import { listInvoices } from "../../lib/invoice";
import {
  ArrowDownLeft, ArrowUpRight, Wallet, Landmark, MapPin, ArrowRight,
  FileText, Building2, ReceiptText, Archive,
} from "lucide-react";

export const dynamic = "force-dynamic";

const CAT_LABEL: Record<string, string> = {
  subscription: "Subscriptions",
  salary: "Salaries",
  kenya: "Kenya field spend",
  vendor: "Vendors",
  payout: "Givebutter payouts",
  other: "Other",
};

export default async function Reports() {
  const db = admin();
  const now = new Date();
  const year = now.getFullYear();
  const yearStart = new Date(year, 0, 1).toISOString();

  const [donRes, payRes, invoices] = await Promise.all([
    db.from("donations").select("amount,status,currency,donated_at").limit(5000),
    // Maisha shop costs (source='maisha_inventory') are excluded from NGO report
    // figures (spec 004 Phase 3, SKEPTIC #16). The .or keeps NULL-source legacy rows.
    db.from("payments").select("*").or("source.is.null,source.neq.maisha_inventory").limit(5000),
    listInvoices(20),
  ]);
  const donations = (donRes.data || []) as any[];
  const payments = (payRes.data || []) as any[];

  const isUsd = (p: any) => (p.currency || "USD").toUpperCase() === "USD";
  const num = (n: any) => Number(n || 0);

  // ---- income (donations, USD-denominated) -------------------------------
  const succeeded = donations.filter((d) => (d.status || "").toLowerCase() === "succeeded");
  const incomeAll = succeeded.reduce((s, d) => s + num(d.amount), 0);
  const incomeYtd = succeeded
    .filter((d) => d.donated_at && new Date(d.donated_at).toISOString() >= yearStart)
    .reduce((s, d) => s + num(d.amount), 0);

  // ---- expenses (paid, USD) ----------------------------------------------
  const paidUsd = payments.filter((p) => p.status === "paid" && isUsd(p));
  const expenseAll = paidUsd.reduce((s, p) => s + num(p.amount), 0);
  const expenseYtd = paidUsd
    .filter((p) => p.paid_at && new Date(p.paid_at).toISOString() >= yearStart)
    .reduce((s, p) => s + num(p.amount), 0);

  const netAll = incomeAll - expenseAll;
  const netYtd = incomeYtd - expenseYtd;

  // ---- expenses by category (USD) ----------------------------------------
  const byCat: Record<string, number> = {};
  for (const p of paidUsd) {
    const c = CAT_LABEL[p.category] ? p.category : "other";
    byCat[c] = (byCat[c] || 0) + num(p.amount);
  }
  const catRows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  // ---- Givebutter -> Kenya flow ------------------------------------------
  const payoutRows = payments.filter((p) => p.category === "payout" || p.method === "givebutter");
  const withdrawnUsd = payoutRows.filter(isUsd).reduce((s, p) => s + num(p.amount), 0);
  const payoutCount = payoutRows.length;

  const kenyaRows = payments.filter(
    (p) => (p.category === "kenya" || p.method === "mpesa") && p.status === "paid",
  );
  const kenyaKes = kenyaRows
    .filter((p) => (p.currency || "KES").toUpperCase() === "KES")
    .reduce((s, p) => s + num(p.amount), 0);
  const kenyaUsd = kenyaRows
    .filter((p) => (p.currency || "").toUpperCase() === "USD")
    .reduce((s, p) => s + num(p.amount), 0);
  const kenyaCount = kenyaRows.length;

  // ---- largest recorded expenses (for the narrative + statement) ---------
  const topExpenses = [...payments]
    .filter((p) => p.status === "paid" && num(p.amount) > 0)
    .sort((a, b) => num(b.amount) - num(a.amount))
    .slice(0, 8)
    .map((p) => ({ label: p.payee || CAT_LABEL[p.category] || "Expense", amount: num(p.amount), currency: (p.currency || "USD").toUpperCase() }));

  const periodLabel = `Year to date ${year}`;
  const narrInputFunder: NarrativeInput = {
    periodLabel, moneyIn: incomeYtd, moneyOut: expenseYtd, net: netYtd,
    withdrawnUsd, kenyaKes, kenyaUsd,
    topExpenses: topExpenses.map((e) => ({ label: e.label, amount: e.amount, currency: e.currency })),
    audience: "funder",
  };
  const narrInputBoard: NarrativeInput = { ...narrInputFunder, audience: "board" };

  const printDate = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const figures = (
    <>
      {/* PRINT-ONLY letterhead */}
      <div className="report-letterhead print-only">
        <div className="flex" style={{ gap: 10 }}>
          <img src="/logo.png" alt="Nisria" style={{ height: 30 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>By Nisria Inc</div>
            <div style={{ fontSize: 11, color: "#555" }}>Financial report · generated {printDate}</div>
          </div>
        </div>
      </div>

      {/* 1) INCOME VS EXPENSE SUMMARY */}
      <section className="report-section">
        <Card
          title="Income vs expense summary"
          action={<Badge tone="gray">{year}</Badge>}
        >
          <div className="card-pad">
            <div className="grid cols-3" style={{ marginBottom: 16 }}>
              <div className="feature teal">
                <div className="ficon"><ArrowDownLeft size={20} /></div>
                <div className="ftitle"><Money amount={incomeYtd} /></div>
                <div className="fmeta">Income YTD · succeeded donations</div>
              </div>
              <div className="feature peri">
                <div className="ficon"><ArrowUpRight size={20} /></div>
                <div className="ftitle"><Money amount={expenseYtd} /></div>
                <div className="fmeta">Expenses YTD · paid in USD</div>
              </div>
              <div className="feature dark">
                <div className="ficon"><Wallet size={20} /></div>
                <div className="ftitle">{netYtd < 0 ? "−" : ""}<Money amount={Math.abs(netYtd)} /></div>
                <div className="fmeta">Net YTD · income − expense</div>
              </div>
            </div>

            <table className="report-table">
              <thead>
                <tr><th>Line</th><th style={{ textAlign: "right" }}>Year to date</th><th style={{ textAlign: "right" }}>All time</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>Income (donations)</td>
                  <td style={{ textAlign: "right" }}><Money amount={incomeYtd} /></td>
                  <td style={{ textAlign: "right" }}><Money amount={incomeAll} /></td>
                </tr>
                <tr>
                  <td>Expenses (paid, USD)</td>
                  <td style={{ textAlign: "right" }}><Money amount={expenseYtd} /></td>
                  <td style={{ textAlign: "right" }}><Money amount={expenseAll} /></td>
                </tr>
                <tr className="report-total">
                  <td>Net</td>
                  <td style={{ textAlign: "right" }}>{netYtd < 0 ? "−" : ""}<Money amount={Math.abs(netYtd)} /></td>
                  <td style={{ textAlign: "right" }}>{netAll < 0 ? "−" : ""}<Money amount={Math.abs(netAll)} /></td>
                </tr>
              </tbody>
            </table>

            <div style={{ marginTop: 18 }}>
              <div className="report-subhead">Expenses by category (all-time, USD)</div>
              {catRows.length === 0 ? (
                <div className="empty" style={{ padding: 24, fontSize: 12.5 }}>No USD expenses recorded yet.</div>
              ) : (
                <table className="report-table">
                  <tbody>
                    {catRows.map(([c, amt]) => (
                      <tr key={c}>
                        <td>{CAT_LABEL[c] || c}</td>
                        <td style={{ textAlign: "right" }}><Money amount={amt} /></td>
                        <td style={{ textAlign: "right", width: 70, color: "var(--muted)" }}>
                          {expenseAll > 0 ? Math.round((amt / expenseAll) * 100) : 0}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="faint report-note" style={{ fontSize: 11.5, marginTop: 12 }}>
              Donations are USD-denominated. Kenya ground spend is in KES and is reported separately in the flow
              statement below so no exchange rate is assumed.
            </div>
          </div>
        </Card>
      </section>

      {/* 2) GIVEBUTTER -> KENYA FLOW STATEMENT */}
      <section className="report-section" style={{ marginTop: 16 }}>
        <Card
          title="Givebutter → Kenya flow statement"
          action={
            <span className="flex" style={{ gap: 6 }}>
              <Badge tone="peri">{payoutCount} payouts</Badge>
              <Badge tone="green">{kenyaCount} Kenya payments</Badge>
            </span>
          }
        >
          <div className="card-pad">
            <div className="flex" style={{ gap: 16, flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ flex: "1 1 200px", minWidth: 180 }}>
                <div className="flex" style={{ gap: 9 }}>
                  <span className="aico peri" style={{ width: 30, height: 30, borderRadius: 9 }}><Landmark size={15} /></span>
                  <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13.5 }}>Withdrawn from Givebutter</span>
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, marginTop: 8 }}><Money amount={withdrawnUsd} /></div>
                <div className="faint" style={{ fontSize: 11.5 }}>Cash wired to the bank across {payoutCount} payout{payoutCount === 1 ? "" : "s"}</div>
              </div>
              <ArrowRight size={22} color="var(--faint)" />
              <div style={{ flex: "1 1 200px", minWidth: 180 }}>
                <div className="flex" style={{ gap: 9 }}>
                  <span className="aico green" style={{ width: 30, height: 30, borderRadius: 9 }}><MapPin size={15} /></span>
                  <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13.5 }}>Paid out in Kenya</span>
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, marginTop: 8 }}><Money amount={kenyaKes} currency="KES" /></div>
                <div className="faint" style={{ fontSize: 11.5 }}>
                  {kenyaCount} Kenya payment{kenyaCount === 1 ? "" : "s"} recorded{kenyaUsd > 0 ? <> · plus <Money amount={kenyaUsd} /> USD</> : null}
                </div>
              </div>
            </div>
            <div className="faint report-note" style={{ fontSize: 11.5, marginTop: 16, lineHeight: 1.5 }}>
              {kenyaKes === 0 && kenyaUsd === 0
                ? "Historical Kenya field records are still being captured, so the ground-spend side may understate actual spend. From here forward every receipt logged on Finance is reflected here."
                : "Older Kenya field spend may be incomplete. From here forward every receipt logged on Finance is captured in this statement."}
            </div>
          </div>
        </Card>
      </section>

      {/* 3) FUNDER REPORT PACKAGE */}
      <section id="reports-builder" className="report-section" style={{ marginTop: 16 }}>
        <Card
          title="Funder report package"
          action={<Badge tone="gold"><FileText size={11} /> cover narrative</Badge>}
        >
          <div className="card-pad">
            <div className="muted no-print" style={{ fontSize: 12.5, marginBottom: 14, lineHeight: 1.5 }}>
              A cover note for a grant funder reviewing your stewardship, grounded in your saved org history and the
              figures above. Pair it with the summary and flow statement for a complete package.
            </div>
            <ReportNarrative input={narrInputFunder} />
          </div>
        </Card>
      </section>

      {/* 4) BOARD REPORT PACKAGE */}
      <section className="report-section" style={{ marginTop: 16 }}>
        <Card
          title="Board report package"
          action={<Badge tone="peri"><Building2 size={11} /> quarterly review</Badge>}
        >
          <div className="card-pad">
            <div className="muted no-print" style={{ fontSize: 12.5, marginBottom: 14, lineHeight: 1.5 }}>
              A plainer cover note for your own board's quarterly review. Same figures, framed for internal governance.
            </div>
            <ReportNarrative input={narrInputBoard} />
          </div>
        </Card>
      </section>

      <div className="faint no-print" style={{ fontSize: 11.5, marginTop: 18, lineHeight: 1.5 }}>
        These reference figures stay live so you can sanity-check any report before you generate it. Generated reports
        export to a real PDF via the server (headless Chrome); the browser print here is the universal floor.
      </div>
    </>
  );

  const invoiceTab = (
    <>
      <InvoiceBuilder />
      <section className="report-section" style={{ marginTop: 16 }}>
        <Card
          title="Recent invoices"
          action={<Badge tone="gray">{invoices.length}</Badge>}
        >
          <div className="card-pad">
            {invoices.length === 0 ? (
              <div className="empty" style={{ padding: 20, fontSize: 12.5 }}>No invoices issued yet. Build one above to bill another company.</div>
            ) : (
              <table className="report-table">
                <thead>
                  <tr><th>Invoice</th><th>Company</th><th>Issued</th><th style={{ textAlign: "right" }}>Total</th><th></th></tr>
                </thead>
                <tbody>
                  {invoices.map((inv: any) => (
                    <tr key={inv.id}>
                      <td><span className="strong">{inv.invoice_number}</span></td>
                      <td>{inv.bill_to_company}</td>
                      <td>{date(inv.issue_date)}</td>
                      <td style={{ textAlign: "right" }}><Money amount={inv.total} currency={inv.currency} /></td>
                      <td style={{ textAlign: "right" }}>
                        {inv.doc_id && (
                          <PreviewLink href={`/api/studio/pdf?id=${inv.doc_id}`} kind="pdf" title="Invoice" className="pill" style={{ fontSize: 11 }}>
                            <ReceiptText size={11} /> PDF
                          </PreviewLink>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </section>
    </>
  );

  // The primary build tab leads with the report builder as the hero action, then
  // drops straight into the org's filed-report archive as a tidy classified list
  // (dates + type badges, self-populating). Same wiring, cleaner composition.
  const buildTab = (
    <div className="stack" style={{ gap: 18 }}>
      <ReportBuilder />
      <section className="report-section">
        <div className="between" style={{ marginBottom: 12, alignItems: "flex-end" }}>
          <div>
            <div className="report-subhead" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
              <Archive size={15} /> Past reports
            </div>
            <div className="faint" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>
              Every report ever filed, classified and dated. Open any one to read its full text here.
            </div>
          </div>
        </div>
        <ReportArchive />
      </section>
    </div>
  );

  return (
    <Shell
      title="Reports"
      sub="Build exactly the report you need, choose the type, window, sections, and letterhead, then preview, print, or export a PDF. Issue branded invoices to other companies from here too."
      action={
        <span className="flex" style={{ gap: 8 }}>
          <Link className="btn ghost sm no-print" href="/finance"><Wallet size={14} /> Finance</Link>
          <PrintButton label="Print full report" />
        </span>
      }
    >
      <ReportsTabs
        build={buildTab}
        invoice={invoiceTab}
        figures={figures}
        archive={<ReportArchive />}
      />
    </Shell>
  );
}
