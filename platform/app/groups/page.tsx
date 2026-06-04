import Shell from "../../components/Shell";
import { TabTitle } from "../../components/tabs-context";
import { admin } from "../../lib/supabase-admin";
import GroupLink from "../../components/GroupLink";
import GroupChat, { type GroupRef } from "../../components/GroupChat";

export const dynamic = "force-dynamic";

const t = (s: string) => new Date(s).getTime();

// Groups: the team WhatsApp groups, read like WhatsApp (owner right, others left
// with their own colour, time stamps, date dividers, search). The list + last
// activity load server-side; the chat itself is the client GroupChat, which
// switches groups smoothly (no reload) and maximizes into the FocusSheet, the
// same overlay as Need You, where the prev/next arrows step between groups.
export default async function Groups({ searchParams }: { searchParams: { g?: string } }) {
  const db = admin();

  const { data: recent } = await db
    .from("messages").select("account,created_at")
    .eq("channel", "whatsapp").eq("sender_type", "group")
    .order("created_at", { ascending: false }).limit(1500);
  const lastByGroup = new Map<string, string>();
  const countByGroup = new Map<string, number>();
  for (const m of (recent || []) as any[]) {
    const name = m.account || "Unknown group";
    if (!lastByGroup.has(name)) lastByGroup.set(name, m.created_at);
    countByGroup.set(name, (countByGroup.get(name) || 0) + 1);
  }
  const groups: GroupRef[] = [...lastByGroup.entries()]
    .sort((a, b) => t(b[1]) - t(a[1]))
    .map(([name, last]) => ({ name, last, count: countByGroup.get(name) || 0 }));
  const sampleSize = (recent || []).length;

  if (groups.length === 0) {
    return (
      <Shell title="Groups" sub="The team WhatsApp groups">
        <TabTitle title="Groups" />
        <GroupLink />
        <div className="card card-pad"><div className="empty">No group messages yet. Once the group number is linked and added to the team groups, conversations appear here.</div></div>
      </Shell>
    );
  }

  const selected = (searchParams.g && groups.find((g) => g.name === searchParams.g)?.name) || groups[0].name;
  const capped = sampleSize >= 1500;

  return (
    <Shell
      title="Groups"
      sub="Team WhatsApp groups, read and post here"
      action={
        <div className="flex" style={{ gap: 8, alignItems: "center" }}>
          <span className="badge teal">{groups.length} group{groups.length === 1 ? "" : "s"}</span>
          <span className="badge">
            {capped ? `${sampleSize.toLocaleString()}+` : sampleSize.toLocaleString()} recent message{sampleSize === 1 ? "" : "s"}
          </span>
        </div>
      }
    >
      <TabTitle title={selected} />
      <GroupLink />
      <GroupChat groups={groups} initial={selected} />
    </Shell>
  );
}
