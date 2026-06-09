// GROUP-BOT KEEP-ALIVE (Sasa 727 v1). Every 15 minutes during Nairobi waking
// hours (06:00..23:00 EAT), check that the group bot is reachable. Two signals:
//   1. bot_status.key='group_membership'.updated_at is within 30 min
//   2. MAX(messages.created_at) WHERE sender_type='group' is within 45 min
// If either trips, fire a system_alert template to OWNER_WHATSAPP via the
// existing pushIncident chokepoint. Best-effort; never throws.
// Gated by GROUP_BOT_HEALTH_CRON_ENABLED so we can mute during deploys.

import { NextRequest, NextResponse } from "next/server";
import { admin } from "../../../../lib/supabase-admin";
import { emit } from "../../../../lib/events";
import { pushIncident } from "../../../../lib/notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authed(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") || "";
  const cron = process.env.CRON_SECRET, agent = process.env.AGENT_TICK_SECRET;
  const qs = new URL(req.url).searchParams.get("key");
  if (cron && auth === `Bearer ${cron}`) return true;
  if (agent && (req.headers.get("x-agent-secret") === agent || qs === agent)) return true;
  return false;
}

// Nairobi local hour from UTC. 06:00..22:59 EAT is waking; outside we log only.
function nairobiHour(): number {
  const now = new Date();
  return (now.getUTCHours() + 3) % 24;
}

async function check() {
  if (process.env.GROUP_BOT_HEALTH_CRON_ENABLED !== "1") {
    return { ok: true, skipped: "flag_off" };
  }
  const db = admin();
  const hour = nairobiHour();
  const inWakingWindow = hour >= 6 && hour < 23;

  const membershipMax = 30 * 60 * 1000;   // 30 min
  const groupMsgMax = 45 * 60 * 1000;     // 45 min
  const nowMs = Date.now();

  // Signal 1: bot_status.group_membership updated_at
  const { data: bs } = await db.from("bot_status").select("key,updated_at,value").eq("key", "group_membership").maybeSingle();
  const membershipUpdatedAt = bs?.updated_at ? new Date(bs.updated_at).getTime() : 0;
  const membershipStaleMs = nowMs - membershipUpdatedAt;

  // Signal 2: most recent group message
  const { data: lastGroupMsg } = await db
    .from("messages")
    .select("created_at")
    .eq("sender_type", "group")
    .order("created_at", { ascending: false })
    .limit(1);
  const lastMsgAt = lastGroupMsg?.[0]?.created_at ? new Date(lastGroupMsg[0].created_at).getTime() : 0;
  const msgStaleMs = nowMs - lastMsgAt;

  const membershipStale = membershipUpdatedAt === 0 || membershipStaleMs > membershipMax;
  const messagesStale = lastMsgAt === 0 || msgStaleMs > groupMsgMax;
  // 2026-06-09: was (membership || messages) — message-staleness alone would
  // trip on a legitimately-quiet hour (Sunday evening Kenya time fired this
  // straight to Nur 25 min after a clean group-bot restart, with membership
  // fresh at 17 min). Membership is the bot-health signal; messages depend on
  // outside actors. Require membership-stale as the primary; messages can
  // CONFIRM but cannot trip alone.
  const tripped = membershipStale && inWakingWindow;

  await emit({
    type: "group_bot.health_check",
    source: "cron:group-bot-health",
    actor: "system",
    subject_type: "incident",
    subject_id: null,
    payload: {
      hour_nbo: hour,
      in_waking_window: inWakingWindow,
      membership_stale_min: membershipUpdatedAt === 0 ? null : Math.round(membershipStaleMs / 60000),
      msg_stale_min: lastMsgAt === 0 ? null : Math.round(msgStaleMs / 60000),
      tripped,
    },
  });

  if (tripped) {
    const detailParts: string[] = [];
    if (membershipStale) detailParts.push(`membership ${membershipUpdatedAt === 0 ? "never seen" : `${Math.round(membershipStaleMs / 60000)} min stale`}`);
    if (messagesStale) detailParts.push(`last group message ${lastMsgAt === 0 ? "never seen" : `${Math.round(msgStaleMs / 60000)} min stale`}`);
    await pushIncident("Group bot keep-alive", `Group bot looks dead: ${detailParts.join("; ")}. Restart the userbot on Railway.`);
  }

  return { ok: true, tripped, in_waking_window: inWakingWindow };
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await check();
  return NextResponse.json(r);
}
export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await check();
  return NextResponse.json(r);
}
