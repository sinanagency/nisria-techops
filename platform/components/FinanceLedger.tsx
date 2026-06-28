import { admin } from "../lib/supabase-admin";
import Collapsible from "./Collapsible";
import LedgerList from "./LedgerList";

// The ledger: every outflow, searchable + month-grouped, inside a collapsed
// dropdown (rows only render when opened, so the page stays fast). Server fetches
// the rows once; the client list handles search + grouping.
export default async function FinanceLedger() {
  const db = admin();
  const { data } = await db
    .from("payments")
    .select("payee,purpose,category,amount,currency,status,paid_at,due_on,created_at,direction,screenshot_path,source_message_id,source")
    // Maisha shop costs (source='maisha_inventory') are SEPARATE from the NGO ledger.
    .or("source.is.null,source.neq.maisha_inventory")
    .eq("direction", "out")
    .limit(5000);
  const rows = (data || []) as any[];
  if (!rows.length) return null;
  rows.sort((a, b) => {
    const da = a.paid_at || a.due_on || a.created_at || "";
    const dbb = b.paid_at || b.due_on || b.created_at || "";
    return da < dbb ? 1 : da > dbb ? -1 : 0;
  });

  return (
    <Collapsible title={<span className="flex" style={{ gap: 7 }}>Ledger</span>} action={<span className="faint" style={{ fontSize: 12 }}>{rows.length} entries · searchable</span>}>
      <LedgerList rows={rows} />
    </Collapsible>
  );
}
