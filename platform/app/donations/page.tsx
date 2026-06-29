import Shell from "../../components/Shell";
import { Card, Table, Badge, Col, statusTone } from "../../components/ui";
import { admin, date } from "../../lib/supabase-admin";
import { Heart, Check, Clock, Repeat } from "lucide-react";
import { SubmitButton } from "../../components/SubmitButton";
import { draftThankYouFor, draftAllThankYous } from "./actions";
import DonationPeek from "../../components/DonationPeek";
import { Money, MoneyHideToggle } from "../../components/Money";
import FilterBar, { FilterField } from "../../components/FilterBar";

export const dynamic = "force-dynamic";

const STATUS_OPTS = ["succeeded", "pending", "refunded", "failed"];
const RANGE_OPTS: { v: string; label: string }[] = [
  { v: "30", label: "30 days" },
  { v: "90", label: "90 days" },
  { v: "365", label: "1 year" },
  { v: "all", label: "All time" },
];

export default async function Donations({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  // normalize incoming filters
  const sp = searchParams || {};
  const one = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined)) || "";
  const q = one("q").trim();
  const recurring = one("recurring"); // yes | no | ""
  const status = one("status"); // succeeded | pending | refunded | failed | ""
  const range = one("range") || "all"; // 30 | 90 | 365 | all

  const db = admin();
  const { data } = await db
    .from("donations")
    .select("*,donor:donors(full_name,email),campaign:campaigns(name)")
    .order("donated_at", { ascending: false })
    .limit(500);

  // Which gifts already have a thank-you queued/sent? The steward keys every
  // intent `thankyou:<donation_id>`, so one pull of those keys tells us the
  // thank-you state for the whole table without an N+1 of per-row lookups.
  const { data: tyIntents } = await db
    .from("action_intents")
    .select("idempotency_key,status")
    .like("idempotency_key", "thankyou:%")
    .limit(2000);
  const thanked = new Map<string, string>(); // donation_id → intent status
  for (const it of (tyIntents || []) as any[]) {
    const id = String(it.idempotency_key || "").slice("thankyou:".length);
    if (id) thanked.set(id, it.status);
  }

  // apply filters in-memory (small dataset, keeps the joined select intact)
  let rows = (data || []) as any[];
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((r: any) => (r.donor?.full_name || "Anonymous").toLowerCase().includes(needle));
  }
  if (recurring === "yes") rows = rows.filter((r: any) => !!r.is_recurring);
  if (recurring === "no") rows = rows.filter((r: any) => !r.is_recurring);
  if (status) rows = rows.filter((r: any) => (r.status || "").toLowerCase() === status);
  if (range !== "all") {
    const days = Number(range);
    if (!Number.isNaN(days)) {
      const cutoff = Date.now() - days * 86400000;
      rows = rows.filter((r: any) => r.donated_at && new Date(r.donated_at).getTime() >= cutoff);
    }
  }

  // Per-currency totals. KES and USD never blend (Currency law). A naive
  // cross-currency SUM would read 29 KES gifts as dollars and print ~$14.85M.
  const totalsByCur = rows.reduce((m: Record<string, number>, r: any) => {
    const c = (r.currency || "USD").toUpperCase();
    m[c] = (m[c] || 0) + Number(r.amount || 0);
    return m;
  }, {});
  const curEntries = Object.entries(totalsByCur);
  const isFiltered = !!(q || recurring || status || (range && range !== "all"));

  // Hero figures. Drawn from the FULL pulled set (not the filtered view) so the
  // headline reads the real fundraising picture regardless of active pills.
  // Only succeeded gifts count as money raised; KES and USD are kept on separate
  // lines and never summed (Currency law). A naive blended SUM would read KES
  // gifts as dollars and overstate the total.
  const allRows = (data || []) as any[];
  const succeeded = (r: any) => (r.status || "").toLowerCase() === "succeeded";
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const sumByCur = (filterFn: (r: any) => boolean) =>
    allRows.filter(filterFn).reduce((m: Record<string, number>, r: any) => {
      const c = (r.currency || "USD").toUpperCase();
      m[c] = (m[c] || 0) + Number(r.amount || 0);
      return m;
    }, {} as Record<string, number>);

  const raisedMonthByCur = sumByCur(
    (r) => succeeded(r) && !!r.donated_at && new Date(r.donated_at).getTime() >= monthStart
  );
  const raisedAllByCur = sumByCur(succeeded);
  const monthEntries = Object.entries(raisedMonthByCur).filter(([, v]) => v > 0);
  const allTimeEntries = Object.entries(raisedAllByCur).filter(([, v]) => v > 0);
  // Pick the lead currency for the giant headline number: the one with the most
  // money raised this month (fall back to all-time, then USD).
  const leadCur =
    (monthEntries.sort((a, b) => b[1] - a[1])[0] || allTimeEntries.sort((a, b) => b[1] - a[1])[0] || ["USD", 0])[0];
  const leadMonth = raisedMonthByCur[leadCur] || 0;
  const succeededCount = allRows.filter(succeeded).length;

  // thank-you state per row: queued/sent vs. a one-click "draft" button.
  // The button only makes sense for a gift that actually went through and has a
  // donor email; otherwise we show why it can't be thanked.
  const tyCell = (r: any) => {
    const st = thanked.get(r.id);
    if (st === "done") return <Badge tone="green"><Check size={11} /> Sent</Badge>;
    if (st) return <Badge tone="gold"><Clock size={11} /> Queued</Badge>;
    const hasEmail = !!r.donor?.email;
    const succeeded = (r.status || "").toLowerCase() === "succeeded";
    if (!succeeded) return <span className="faint">-</span>;
    if (!hasEmail) return <span className="faint">no email</span>;
    return (
      <form action={draftThankYouFor}>
        <input type="hidden" name="donation_id" value={r.id} />
        <button type="submit" className="btn ghost sm">
          <Heart size={13} /> Draft thank-you
        </button>
      </form>
    );
  };

  const cols: Col<any>[] = [
    { key: "donor", label: "Donor", render: (r: any) => <DonationPeek donation={r} /> },
    { key: "campaign", label: "Campaign", render: (r: any) => r.campaign?.name || "-" },
    { key: "channel", label: "Channel" },
    { key: "is_recurring", label: "Recurring", render: (r: any) => (r.is_recurring ? <Badge tone="blue"><Repeat size={11} /> monthly</Badge> : <span className="faint">-</span>) },
    { key: "status", label: "Status", render: (r: any) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    { key: "thankyou", label: "Thank-you", render: tyCell },
    { key: "donated_at", label: "Date", render: (r: any) => date(r.donated_at) },
    { key: "amount", label: "Amount", align: "right", render: (r: any) => <Money amount={r.amount} currency={r.currency} className="strong" style={{ whiteSpace: "nowrap" }} /> },
  ];

  // The matched-total carries .money (via <Money>) so the hide toggle blurs it
  // like every other amount; the rest stays plain text.
  const sub = (
    <>
      {rows.length} {rows.length === 1 ? "gift" : "gifts"}
      {isFiltered && curEntries.length > 0 ? (
        <> · {curEntries.map(([c, v], i) => (
          <span key={c}>{i > 0 ? " + " : ""}<Money amount={v} currency={c} /></span>
        ))} matched</>
      ) : ""}
    </>
  );

  // Modern filter omnibar config (Filtering v2). Fields map 1:1 to the
  // querystring params the server already filters on, so the chip builder is
  // fully functional with the existing data logic. Only real filterable params
  // are exposed: status, cadence (recurring), and period (range). No sort param
  // is read server-side, so no sort dropdown is offered.
  const filterFields: FilterField[] = [
    { key: "status", label: "Status", type: "select", options: STATUS_OPTS.map((s) => ({ v: s, label: s })) },
    { key: "recurring", label: "Cadence", type: "select", options: [{ v: "yes", label: "Monthly" }, { v: "no", label: "One-off" }] },
    { key: "range", label: "Period", type: "select", op: "within", options: RANGE_OPTS.filter((r) => r.v !== "all").map((r) => ({ v: r.v, label: r.label })) },
  ];
  const filterValues: Record<string, string> = {
    q,
    status,
    recurring,
    range: range === "all" ? "" : range,
  };

  return (
    <Shell
      title="Donations"
      sub={sub}
      action={
        <form action={draftAllThankYous}>
          {/* L-2 (Law 6): pending state so the batch-draft button gives feedback. */}
          <SubmitButton id="donations-thank-all" className="btn teal" pendingLabel="Drafting thank-yous…">
            <Heart size={14} /> Draft thank-yous for all un-thanked recent gifts
          </SubmitButton>
        </form>
      }
    >
      {/* drill-to-core hero: raised this month leads, all-time alongside.
          Per-currency lines, never blended (Currency law). */}
      <div className="metric-hero">
        <MoneyHideToggle style={{ position: "absolute", top: 16, right: 18, zIndex: 3 }} />
        <div className="mh-row">
          <div style={{ minWidth: 0 }}>
            <div className="mh-label">Raised this month{leadCur !== "USD" ? ` (${leadCur})` : ""}</div>
            <div className="mh-num disp2">
              <Money amount={leadMonth} currency={leadCur} />
            </div>
            <div className="mh-sub">
              {monthEntries.length > 1 ? (
                <>
                  {monthEntries
                    .filter(([c]) => c !== leadCur)
                    .map(([c, v], i) => (
                      <span key={c}>{i > 0 ? " · " : "+ "}<Money amount={v} currency={c} /></span>
                    ))}
                  {" also this month"}
                </>
              ) : monthEntries.length === 0 ? (
                "No gifts cleared yet this month"
              ) : (
                `${succeededCount} ${succeededCount === 1 ? "gift" : "gifts"} cleared all time`
              )}
            </div>
          </div>
          <div className="stack" style={{ gap: 6, minWidth: 200, flex: "1 1 220px", maxWidth: 360, position: "relative", zIndex: 2 }}>
            <div className="mh-label">Raised all time</div>
            {allTimeEntries.length === 0 ? (
              <div className="strong disp2" style={{ fontSize: 26, fontWeight: 700 }}>
                <Money amount={0} currency={leadCur} />
              </div>
            ) : (
              allTimeEntries
                .sort((a, b) => b[1] - a[1])
                .map(([c, v]) => (
                  <div key={c} className="strong disp2" style={{ fontSize: 26, fontWeight: 700 }}>
                    <Money amount={v} currency={c} />
                  </div>
                ))
            )}
          </div>
        </div>
      </div>

      {/* filters */}
      <FilterBar
        basePath="/donations"
        fields={filterFields}
        values={filterValues}
        count={rows.length}
        searchKey="q"
        searchPlaceholder="Search donor name…"
      />

      <Card title="All donations" scroll>
        <Table
          columns={cols}
          rows={rows}
          empty={isFiltered ? "No donations match these filters." : "No donations yet. They'll appear here as Givebutter syncs in."}
        />
      </Card>
    </Shell>
  );
}
