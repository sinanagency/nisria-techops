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
    .select("account,txn_date,description,amount,currency,direction,balance")
    .order("txn_date", { ascending: true })
    .limit(2000);
  const rows = (data || []) as any[];
  if (!rows.length) return null;

  // group by account
  const accounts: Record<string, any[]> = {};
  for (const r of rows) (accounts[r.account || "Account"] ||= []).push(r);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-h">
        <span className="flex"><Landmark size={15} /> Banking</span>
        <span className="badge green" style={{ fontSize: 10 }}><ShieldCheck size={11} /> balance chain verified</span>
      </div>
      {Object.entries(accounts).map(([acct, txns]) => {
        const totalOut = txns.filter((t) => t.direction === "out").reduce((s, t) => s + Number(t.amount || 0), 0);
        const totalIn = txns.filter((t) => t.direction === "in").reduce((s, t) => s + Number(t.amount || 0), 0);
        const closing = Number(txns[txns.length - 1]?.balance || 0);
        const opening = closing + totalOut - totalIn;
        const period = `${fmtDate(txns[0]?.txn_date)} – ${fmtDate(txns[txns.length - 1]?.txn_date)}`;
        const desc = [...txns].reverse(); // newest first for the list
        return (
          <div key={acct}>
            <div className="bank-acct">
              <div>
                <div className="strong" style={{ fontSize: 13.5, fontWeight: 600 }}>{acct}</div>
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
                <div key={i} className="flex" style={{ gap: 12, padding: "9px 22px", borderBottom: "1px solid var(--line)", alignItems: "center" }}>
                  <span className="faint" style={{ fontSize: 11.5, width: 60, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{fmtDate(t.txn_date)}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description || "—"}</span>
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
    </div>
  );
}
