import { NextRequest, NextResponse } from "next/server";
import { admin, money } from "../../../lib/supabase-admin";
import { askClaude } from "../../../lib/anthropic";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();
    const db = admin();

    const [{ data: don }, { data: donors }, { data: camps }, { data: tasks }, { data: team }, { data: msgs }, { data: grants }] =
      await Promise.all([
        db.from("donations").select("amount,status,is_recurring,donated_at"),
        db.from("donors").select("id,status"),
        db.from("campaigns").select("name,goal_amount,raised_amount,status"),
        db.from("tasks").select("title,status,priority,assignee:team_members(name)"),
        db.from("team_members").select("name,role,status"),
        db.from("messages").select("status,channel"),
        db.from("grant_applications").select("funder,status,deadline,amount_requested"),
      ]);

    const succ = (don || []).filter((d: any) => d.status === "succeeded");
    const now = new Date();
    const raisedMtd = succ.filter((d: any) => new Date(d.donated_at).getMonth() === now.getMonth()).reduce((s: number, d: any) => s + Number(d.amount), 0);
    const raisedAll = succ.reduce((s: number, d: any) => s + Number(d.amount), 0);

    const snapshot = {
      raised_this_month: money(raisedMtd),
      raised_all_time: money(raisedAll),
      donors: donors?.length || 0,
      recurring_gifts: succ.filter((d: any) => d.is_recurring).length,
      live_campaigns: (camps || []).filter((c: any) => c.status === "live").map((c: any) => `${c.name} (${money(c.raised_amount)}/${money(c.goal_amount)})`),
      open_tasks: (tasks || []).filter((t: any) => t.status !== "done").map((t: any) => `${t.title} [${t.priority}, ${t.assignee?.name || "unassigned"}]`),
      team: (team || []).map((t: any) => `${t.name} — ${t.role}`),
      new_messages: (msgs || []).filter((m: any) => m.status === "new").length,
      open_grants: (grants || []).filter((g: any) => ["researching", "drafting", "submitted"].includes(g.status)).map((g: any) => `${g.funder} (${g.status})`),
    };

    const system = `You are Nisria's operations AI assistant, inside the founder Nur's private command center.
Nisria (By Nisria Inc) is a nonprofit helping children/families in Kenya, with sister brands Maisha and AHADI.
You help Nur run the organization: answer questions about fundraising, donors, campaigns, tasks, team, grants, and content; draft messages/posts/emails when asked; and suggest next actions. Be concise, warm, and concrete. Use the live snapshot below. If asked to DO something that writes data (assign a task, schedule a post, send a newsletter), explain it can be done from the relevant page (Tasks, Content, Newsletter) and offer to draft it.

LIVE ORG SNAPSHOT (real-time):
${JSON.stringify(snapshot, null, 2)}`;

    const reply = await askClaude({ system, messages: messages.slice(-12), maxTokens: 900 });
    return NextResponse.json({ reply });
  } catch (e: any) {
    return NextResponse.json({ reply: `⚠️ ${e?.message || "Assistant error"}` }, { status: 200 });
  }
}
