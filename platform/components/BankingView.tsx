import { admin } from "../lib/supabase-admin";
import { Landmark, ArrowDownLeft, ArrowUpRight, ShieldCheck } from "lucide-react";

// Banking: the real bank account, reconstructed from the scanned statement and
// VERIFIED — the running balance chains unbroken from opening to closing, so every
// shilling is accounted for. Per account: a summary (period, opening->closing, in/out,
// reconciliation badge) over a scrollable transaction ledger. Read-only.
const KES = (n: number) => "KES " + Math.round(n).toLocaleString();
const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }) : "";

export default async function BankingView() {
  const db = admin();
  const { data } = await db
    .from("bank_transactions")
    .select("account,txn_date,description,amount,currency,direction,balance,confidence,signature")
    .limit(5000);
  const rows = (data || []) as any[];
  if (!rows.length) return null;

  // group by account, keep statement order (signature order = insertion order isn't
  // guaranteed by the API, so sort by balance-chain proxy: keep as stored then by date)
  const accounts: Record<string, any[]> = {};
  for (const r of rows) (accounts[r.account || "Account"] ||= []).push(r);

  // no outer card — a Collapsible wraps this in the page so the (older, scanned)
  // statement history stays tucked away until you open it.
  return (
    <>
      <div className="faint" style={{ fontSize: 11.5, padding: "12px 22px 0" }}>Scanned bank statements (Oct 2021 – Nov 2022). Historical reference; current spend lives in This-month spend above.</div>
      {Object.entries(accounts).map(([acct, txns]) => {
        const sigN = (s: string) => parseInt(String(s || "").split("#")[1] || "0", 10);
        txns.sort((a, b) => sigN(a.signature) - sigN(b.signature)); // statement order
        const totalOut = txns.filter((t) => t.direction === "out").reduce((s, t) => s + Number(t.amount || 0), 0);
        const totalIn = txns.filter((t) => t.direction === "in").reduce((s, t) => s + Number(t.amount || 0), 0);
        const closing = Number(txns[txns.length - 1]?.balance || 0);
        const opening = closing + totalOut - totalIn;
        const period = `${fmtDate(txns[0]?.txn_date)} – ${fmtDate(txns[txns.length - 1]?.txn_date)}`;
        const reconN = txns.filter((t) => t.confidence === "low").length;
        const desc = [...txns].reverse(); // newest first for the list
        return (
          <div key={acct}>
            <div className="bank-acct">
              <div>
                <div className="flex" style={{ gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{acct}</span>
                  {reconN === 0
                    ? <span className="badge green" style={{ fontSize: 9.5 }}><ShieldCheck size={10} /> chain verified</span>
                    : <span className="badge gold" style={{ fontSize: 9.5 }}>reconciled · {reconN} entry from balance</span>}
                </div>
                <div className="faint" style={{ fontSize: 11.5 }}>{period} · {txns.length} transactions</div>
              </div>
              <div className="bank-stats">
                <div><div className="faint bank-lbl">Opening</div><div className="money bank-num">{KES(opening)}</div></div>
                <div><div className="faint bank-lbl flex" style={{ gap: 4 }}><ArrowDownLeft size={11} color="var(--green)" /> In</div><div className="money bank-num" style={{ color: "var(--green)" }}>{KES(totalIn)}</div></div>
                <div><div className="faint bank-lbl flex" style={{ gap: 4 }}><ArrowUpRight size={11} color="var(--red)" /> Out</div><div className="money bank-num" style={{ color: "var(--red)" }}>{KES(totalOut)}</div></div>
                <div><div className="faint bank-lbl">Closing</div><div className="money bank-num strong">{KES(closing)}</div></div>
              </div>
            </div>
            <div style={{ maxHeight: "52vh", overflowY: "auto", borderTop: "1px solid var(--line)" }}>
              {desc.map((t, i) => (
                <div key={i} className="flex" style={{ gap: 12, padding: "9px 22px", borderBottom: "1px solid var(--line)", alignItems: "center", background: t.confidence === "low" ? "rgba(217,119,6,0.06)" : undefined }}>
                  <span className="faint" style={{ fontSize: 11.5, width: 60, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{fmtDate(t.txn_date)}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: t.confidence === "low" ? "normal" : "nowrap" }}>{t.confidence === "low" ? "⚠ " : ""}{t.description || "—"}</span>
                  <span className="money" style={{ fontSize: 12.5, fontWeight: 600, fontVariantNumeric: "tabular-nums", minWidth: 110, textAlign: "right", color: t.direction === "in" ? "var(--green)" : "var(--ink)" }}>
                    {t.direction === "in" ? "+" : "−"}{Math.round(Number(t.amount || 0)).toLocaleString()}
                  </span>
                  <span className="faint money" style={{ fontSize: 11.5, fontVariantNumeric: "tabular-nums", minWidth: 92, textAlign: "right" }}>{t.balance != null ? Math.round(Number(t.balance)).toLocaleString() : ""}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
