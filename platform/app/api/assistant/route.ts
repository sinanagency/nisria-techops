// Sasa's brain. Gives the assistant READ access to the whole database via tools
// (Claude tool-use), so it can answer anything: donations by date range, any
// donor, finance, grants, tasks, inbox, campaigns — not just a summary snapshot.
import { NextRequest, NextResponse } from "next/server";
import { admin, money } from "../../../lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-5";
const KEY = () => process.env.ANTHROPIC_API_KEY || "";

const TOOLS = [
  { name: "query_donations", description: "Sum, count, and list donations. Use for ANY revenue/donations question including specific date ranges. Dates are YYYY-MM-DD.", input_schema: { type: "object", properties: { from: { type: "string", description: "start date inclusive YYYY-MM-DD" }, to: { type: "string", description: "end date inclusive YYYY-MM-DD" }, status: { type: "string", description: "succeeded (default), failed, refunded" }, recurring_only: { type: "boolean" } } } },
  { name: "lookup_donor", description: "Find a donor by name or email; returns their profile, lifetime value, and gift history.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "finance_summary", description: "Money in vs money out: donation totals, payments (upcoming/due/paid), this-month figures.", input_schema: { type: "object", properties: { month: { type: "string", description: "YYYY-MM, defaults to current" } } } },
  { name: "list_grants", description: "Grant opportunities found by the hunter, or grant applications in the pipeline.", input_schema: { type: "object", properties: { kind: { type: "string", enum: ["opportunities", "applications"] }, tier: { type: "string", description: "HIGH/MEDIUM/LOW for opportunities" } } } },
  { name: "list_tasks", description: "Open tasks across the team.", input_schema: { type: "object", properties: {} } },
  { name: "inbox_status", description: "Conversations needing a reply, per account, with who and subject.", input_schema: { type: "object", properties: {} } },
  { name: "list_campaigns", description: "Campaigns with raised vs goal.", input_schema: { type: "object", properties: {} } },
];

async function runTool(name: string, input: any) {
  const db = admin();
  try {
    if (name === "query_donations") {
      let q = db.from("donations").select("amount,donated_at,status,is_recurring,donor:donors(full_name),campaign:campaigns(name)").order("donated_at", { ascending: false });
      q = q.eq("status", input.status || "succeeded");
      if (input.from) q = q.gte("donated_at", input.from);
      if (input.to) q = q.lte("donated_at", input.to + "T23:59:59");
      if (input.recurring_only) q = q.eq("is_recurring", true);
      const { data } = await q.limit(500);
      const rows = data || [];
      const total = rows.reduce((s: number, d: any) => s + Number(d.amount), 0);
      return { count: rows.length, total: money(total), total_raw: total, range: { from: input.from || "all", to: input.to || "all" }, gifts: rows.slice(0, 40).map((d: any) => ({ date: d.donated_at?.slice(0, 10), amount: Number(d.amount), donor: d.donor?.full_name, campaign: d.campaign?.name, recurring: d.is_recurring })) };
    }
    if (name === "lookup_donor") {
      const { data: donors } = await db.from("donors").select("id,full_name,email,status,type,lifetime_value,first_gift_at,last_gift_at").or(`full_name.ilike.%${input.query}%,email.ilike.%${input.query}%`).limit(5);
      const out: any[] = [];
      for (const d of (donors || []) as any[]) {
        const { data: gifts } = await db.from("donations").select("amount,donated_at,status,campaign:campaigns(name)").eq("donor_id", d.id).order("donated_at", { ascending: false });
        out.push({ ...d, gifts: (gifts || []).map((g: any) => ({ date: g.donated_at?.slice(0, 10), amount: Number(g.amount), status: g.status, campaign: g.campaign?.name })) });
      }
      return { matches: out };
    }
    if (name === "finance_summary") {
      const m = input.month || new Date().toISOString().slice(0, 7);
      const [{ data: don }, { data: pays }] = await Promise.all([
        db.from("donations").select("amount,status,donated_at"),
        db.from("payments").select("amount,currency,status,direction,due_on,paid_at,payee,category"),
      ]);
      const succ = (don || []).filter((d: any) => d.status === "succeeded");
      const inMonth = succ.filter((d: any) => (d.donated_at || "").startsWith(m));
      const paid = (pays || []).filter((p: any) => p.status === "paid");
      const paidMonth = paid.filter((p: any) => (p.paid_at || "").startsWith(m));
      const upcoming = (pays || []).filter((p: any) => ["upcoming", "due", "overdue"].includes(p.status));
      return {
        money_in_all: money(succ.reduce((s: number, d: any) => s + Number(d.amount), 0)),
        money_in_month: money(inMonth.reduce((s: number, d: any) => s + Number(d.amount), 0)),
        money_out_month: money(paidMonth.reduce((s: number, p: any) => s + Number(p.amount || 0), 0)),
        upcoming_count: upcoming.length,
        upcoming: upcoming.slice(0, 20).map((p: any) => ({ payee: p.payee, amount: p.amount, currency: p.currency, due: p.due_on, category: p.category })),
      };
    }
    if (name === "list_grants") {
      if (input.kind === "applications") {
        const { data } = await db.from("grant_applications").select("funder,program,status,amount_requested,deadline").order("deadline", { ascending: true }).limit(50);
        return { applications: data || [] };
      }
      let q = db.from("grant_opportunities").select("title,funder,source,relevance_tier,relevance_score,close_date,amount_floor,amount_ceiling,url").eq("pursued", false).order("relevance_score", { ascending: false });
      if (input.tier) q = q.eq("relevance_tier", input.tier);
      const { data } = await q.limit(30);
      return { opportunities: data || [] };
    }
    if (name === "list_tasks") {
      const { data } = await db.from("tasks").select("title,status,priority,due_on,assignee:team_members(name)").neq("status", "done").limit(50);
      return { open_tasks: (data || []).map((t: any) => ({ title: t.title, priority: t.priority, due: t.due_on, assignee: t.assignee?.name })) };
    }
    if (name === "inbox_status") {
      const { data } = await db.from("messages").select("subject,account,created_at,contact:contacts(name,email)").eq("direction", "in").eq("status", "new").eq("sender_type", "individual").order("created_at", { ascending: false }).limit(40);
      return { needs_reply: (data || []).map((m: any) => ({ from: m.contact?.name, account: m.account, subject: m.subject, at: m.created_at?.slice(0, 10) })) };
    }
    if (name === "list_campaigns") {
      const { data } = await db.from("campaigns").select("name,goal_amount,raised_amount,status");
      return { campaigns: (data || []).map((c: any) => ({ name: c.name, raised: Number(c.raised_amount || 0), goal: Number(c.goal_amount || 0), status: c.status })) };
    }
    return { error: "unknown tool" };
  } catch (e: any) {
    return { error: e?.message || "tool failed" };
  }
}

async function callClaude(system: string, messages: any[]) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1200, system, tools: TOOLS, messages }),
    cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "Claude failed");
  return j;
}

export async function POST(req: NextRequest) {
  try {
    const { messages, context } = await req.json();
    const pageHint = context?.page && context.page !== "/" ? `\nNur is currently on the "${context.page}" screen.` : "";
    const system = `You are Sasa, the operations AI inside Nur's private Nisria command center (By Nisria Inc — a US nonprofit helping children and families in Kenya; sister brands Maisha and AHADI; donations via Givebutter).

You have READ access to the entire database through tools. ALWAYS use a tool to answer questions about donations, donors, money/finance, grants, tasks, the inbox, or campaigns — never say you don't have the data. For date-range donation questions use query_donations with from/to. Be concise, warm, concrete, and cite the real numbers you retrieve. Today is ${new Date().toISOString().slice(0, 10)}.${pageHint}`;

    let convo: any[] = (messages || []).slice(-10).map((m: any) => ({ role: m.role, content: m.content }));
    for (let i = 0; i < 5; i++) {
      const resp = await callClaude(system, convo);
      if (resp.stop_reason !== "tool_use") {
        const text = (resp.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
        return NextResponse.json({ reply: text || "…" });
      }
      convo.push({ role: "assistant", content: resp.content });
      const results = [];
      for (const block of resp.content) {
        if (block.type === "tool_use") {
          const out = await runTool(block.name, block.input || {});
          results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out) });
        }
      }
      convo.push({ role: "user", content: results });
    }
    return NextResponse.json({ reply: "That took too many steps. Try narrowing the question." });
  } catch (e: any) {
    return NextResponse.json({ reply: `⚠️ ${e?.message || "Assistant error"}` }, { status: 200 });
  }
}
