// DAILY GROUP DIGEST. Once a day, per team group, post ONE batched reminder of
// the tasks due today or overdue, @mentioning the assignees. Batched on purpose:
// one post per group beats a nag per task. It queues group.send jobs (the group
// bot delivers them), the same one-way path as every other portal->group action.
//
// Triggered by Vercel cron (GET, Authorization: Bearer CRON_SECRET). Also
// runnable manually with x-agent-secret / ?key= / x-group-secret. Idempotent per
// day: a group already digested today is skipped, so a re-run never double-posts.
import { NextRequest, NextResponse } from "next/server";
import { admin } from "../../../../lib/supabase-admin";
import { emit } from "../../../../lib/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authed(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") || "";
  const cron = process.env.CRON_SECRET;
  const agent = process.env.AGENT_TICK_SECRET;
  const group = process.env.GROUP_BOT_SECRET;
  const qs = new URL(req.url).searchParams.get("key");
  if (cron && auth === `Bearer ${cron}`) return true;
  if (agent && (req.headers.get("x-agent-secret") === agent || qs === agent)) return true;
  if (group && req.headers.get("x-group-secret") === group) return true;
  return false;
}

const firstName = (n?: string | null) => (n ? String(n).split(/\s+/)[0] : null);

async function runDigest() {
  const db = admin();
  // "today" in Nairobi (UTC+3), so a 4am-UTC cron lands as the team's morning
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);

  const { data: rows } = await db
    .from("tasks")
    .select("id,title,due_on,source_group,assignee:team_members(name)")
    .neq("status", "done")
    .not("source_group", "is", null)
    .not("due_on", "is", null)
    .lte("due_on", today);
  const tasks = (rows || []) as any[];

  // group -> { dueToday[], overdue[] }
  const byGroup = new Map<string, { dueToday: any[]; overdue: any[] }>();
  for (const t of tasks) {
    const g = t.source_group as string;
    if (!byGroup.has(g)) byGroup.set(g, { dueToday: [], overdue: [] });
    const a = Array.isArray(t.assignee) ? t.assignee[0] : t.assignee;
    const item = { title: t.title, due_on: t.due_on, who: firstName(a?.name) };
    if (t.due_on === today) byGroup.get(g)!.dueToday.push(item);
    else byGroup.get(g)!.overdue.push(item);
  }

  let queued = 0;
  const skipped: string[] = [];
  for (const [group, { dueToday, overdue }] of byGroup) {
    if (!dueToday.length && !overdue.length) continue;

    // idempotent: one digest per group per day
    const { data: already } = await db
      .from("jobs").select("id")
      .eq("kind", "group.send")
      .eq("payload->>digest_date", today)
      .eq("payload->>group", group)
      .limit(1);
    if (already?.[0]) { skipped.push(group); continue; }

    const fmt = (i: any) => `${i.who ? `@${i.who} ` : ""}${i.title}`;
    const lines: string[] = [];
    if (dueToday.length) lines.push(`Due today: ${dueToday.map(fmt).join("; ")}.`);
    if (overdue.length) lines.push(`Overdue: ${overdue.map((i) => `${fmt(i)} (was due ${i.due_on})`).join("; ")}.`);
    const text = `Good morning team. Here is where ${group} stands:\n${lines.join("\n")}\nReply done when something is complete.`;

    await db.from("jobs").insert({ kind: "group.send", payload: { group, text, digest_date: today, kind: "digest" }, status: "queued" });
    queued++;
  }
  await emit({ type: "group.digest_run", source: "cron", actor: "system", subject_type: "job", subject_id: null, payload: { date: today, groups: byGroup.size, queued, skipped } });
  return { ok: true, date: today, groups_with_due: byGroup.size, queued, skipped };
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runDigest());
}
export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runDigest());
}
