import Shell from "../../components/Shell";
import { admin } from "../../lib/supabase-admin";
import ApprovalCard from "../../components/ApprovalCard";
import TabbedPane, { type TabbedTab } from "../../components/TabbedPane";
import { cleanEmail } from "../../lib/email-render";

export const dynamic = "force-dynamic";

// The Needs-You queue as its own destination. The doctrine names <ApprovalCard>
// as a canonical primitive; this is the home for the queue it lives in. Pending
// approvals are the operator's first action surface; decided history sits in a
// sibling tab for audit. TabbedPane gives each tab its own scroll owner.

export default async function Approvals() {
  const db = admin();
  const [{ data: pending }, { data: recent }] = await Promise.all([
    db.from("approvals").select("*").eq("status", "pending").order("created_at", { ascending: false }).limit(60),
    db.from("approvals").select("*").neq("status", "pending").order("decided_at", { ascending: false }).limit(60),
  ]);
  const pendingRows = (pending || []) as any[];
  const recentRows = (recent || []) as any[];

  // fetch original inbound messages so the FocusSheet preview can quote them
  const allIds = [...pendingRows, ...recentRows].map((a: any) => a.context?.message_id).filter(Boolean);
  const origMap: Record<string, any> = {};
  if (allIds.length) {
    const { data: origs } = await db.from("messages").select("id,subject,body,contact:contacts(name)").in("id", allIds);
    for (const o of (origs || []) as any[]) {
      origMap[o.id] = { subject: o.subject, body: cleanEmail(o.body || ""), from: o.contact?.name };
    }
  }
  const origFor = (a: any) =>
    origMap[a.context?.message_id] ||
    (a.context?.original ? { subject: a.context.subject, body: cleanEmail(a.context.original), from: a.context.from } : null);

  // siblings (compact set per tab) so prev/next steps through the tab's queue
  const pendingSibs = pendingRows.map((a: any) => ({ a, original: origFor(a) }));
  const recentSibs = recentRows.map((a: any) => ({ a, original: origFor(a) }));

  // group pending by channel (email / whatsapp / social) for at-a-glance breakdown
  const channelCount = pendingRows.reduce((acc: Record<string, number>, a: any) => {
    const c = a.kind || a.context?.channel || "other";
    acc[c] = (acc[c] || 0) + 1;
    return acc;
  }, {});

  const tabs: TabbedTab[] = [
    {
      id: "pending",
      label: "Needs you",
      count: pendingRows.length,
      hint: Object.entries(channelCount).map(([c, n]) => `${n} ${c}`).join(" · ") || undefined,
      body: pendingRows.length === 0 ? (
        <div className="empty">All caught up. Nothing needs you right now.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {pendingRows.map((a: any) => (
            <ApprovalCard key={a.id} a={a} original={origFor(a)} siblings={pendingSibs} />
          ))}
        </div>
      ),
    },
    {
      id: "recent",
      label: "Recently decided",
      count: recentRows.length,
      hint: "audit trail",
      body: recentRows.length === 0 ? (
        <div className="empty">No decisions logged yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {recentRows.map((a: any) => (
            <ApprovalCard key={a.id} a={a} original={origFor(a)} siblings={recentSibs} />
          ))}
        </div>
      ),
    },
  ];

  const sub = pendingRows.length > 0
    ? `${pendingRows.length} waiting on you · ${recentRows.length} decided in the last batch`
    : `0 waiting · ${recentRows.length} decided in the last batch`;

  return (
    <Shell title="Approvals" sub={sub}>
      <TabbedPane tabs={tabs} initialId="pending" emptyHint="No approvals on file." />
    </Shell>
  );
}
