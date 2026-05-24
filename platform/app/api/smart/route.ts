// Smart Mode brain: interprets a natural-language command, RETURNS an action card,
// and (for safe actions) executes it server-side. Money/PII never auto-fire.
import { NextRequest, NextResponse } from "next/server";
import { admin, money } from "../../../lib/supabase-admin";
import { claudeJSON } from "../../../lib/anthropic";
import { emit } from "../../../lib/events";
import { sendEmail } from "../../../lib/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { messages, command } = await req.json();
    const db = admin();
    const text = command || messages?.[messages.length - 1]?.content || "";

    const [{ data: team }, { data: don }, { data: donors }, { data: tasks }, { count: pending }, { count: newMsgs }] = await Promise.all([
      db.from("team_members").select("id,name,role,email").eq("status", "active"),
      db.from("donations").select("amount,status,donated_at,donor:donors(full_name,email)").order("donated_at", { ascending: false }).limit(20),
      db.from("donors").select("full_name").limit(60),
      db.from("tasks").select("title,status").neq("status", "done"),
      db.from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending"),
      db.from("messages").select("id", { count: "exact", head: true }).eq("direction", "in").eq("status", "new"),
    ]);
    const roster = (team || []).map((t: any) => `${t.name} (${t.role})`).join(", ") || "no team yet";
    const recentGifts = (don || []).filter((d: any) => d.status === "succeeded").slice(0, 6)
      .map((d: any) => `${d.donor?.full_name || "Anon"} ${money(d.amount)}`).join("; ");

    const system = `You are Sasa, Nisria's agentic operations AI. The founder Nur talks to you to RUN the portal. Reply briefly and conversationally, AND choose ONE action.

Live context:
- Team: ${roster}
- Recent gifts: ${recentGifts || "none"}
- ${pending || 0} approvals waiting, ${newMsgs || 0} new messages, ${(tasks || []).length} open tasks.

Available actions (pick the best fit):
- "create_task": Nur wants something done/assigned. Give title, assignee_name (match a team member or null), priority (low|medium|high).
- "navigate": send her to a screen. href is one of: /inbox, /mission (mission control), /donors, /donations, /finance, /content, /newsletter, /agents, /library, /grants, /tasks. Give a label.
- "draft_thankyou": she wants to thank a donor. Give donor_name.
- "answer": just answer, no action.

Money, payments, refunds, or anything sensitive → use "answer" and tell her to confirm on the relevant screen; never auto-execute those.

Return JSON: {"reply":"...", "action":{"type":"...", "title":"", "assignee_name":null, "priority":"medium", "href":"", "label":"", "donor_name":""}}`;

    const r = await claudeJSON<any>(system, text, 700);
    const action = r?.action || { type: "answer" };
    let result: any = null;

    // execute safe actions
    if (action.type === "create_task" && action.title) {
      const member = (team || []).find((t: any) => action.assignee_name && t.name.toLowerCase().includes(String(action.assignee_name).toLowerCase().split(" ")[0]));
      const { data: task } = await db.from("tasks").insert({
        title: action.title, assignee_id: member?.id || null,
        priority: ["low", "medium", "high"].includes(action.priority) ? action.priority : "medium",
        status: "todo", source: "smart",
      }).select("id,title,priority").single();
      if (member?.email) { try { await sendEmail(member.email, `New task: ${action.title}`, `Hi ${member.name},\n\nNur assigned you: "${action.title}" (${action.priority}).\n\nWarmly,\nNisria`); } catch {} }
      await emit({ type: "task.assigned", source: "smart", actor: "Nur", subject_type: "task", subject_id: task?.id, payload: { title: action.title, assignee: member?.name } });
      result = { ok: true, assignee: member?.name || "unassigned", task };
    }

    return NextResponse.json({ reply: r?.reply || "Done.", action, result });
  } catch (e: any) {
    return NextResponse.json({ reply: `⚠️ ${e?.message || "Smart Mode error"}`, action: { type: "answer" } }, { status: 200 });
  }
}
