// THE CANONICAL PROACTIVE-SEND RECORD (2026-06-23, KT #373, class C1 state-spine).
// One source of truth for "what did Sasa actually SEND to a person" — read by EVERY honesty
// / recall / "did-I-message" decision, so none of them guess from this-turn tools or read the
// polluted messages table. The record already exists in the event log; this formalizes the
// read (the counts.ts pattern applied to sends).
//
// SOURCES (append-only events emitted at the real send seam, with the resolved recipient):
//   whatsapp.message_out  — message_person delivered a text/template (payload.to_name present).
//   sasa.relayed_colleague — a team relay was DELIVERED (payload.delivered !== false).
// EXCLUDED, by construction:
//   - the two operator-facing status pings on whatsapp.message_out (kind interim_wait /
//     empty_reply_reask) carry NO to_name → filtered (they are not sends).
//   - the bot's conversational REPLIES (sendTextAndLog) never emit message_out at all.
//   - QUEUED / held relays (delivered:false) — queued is not sent.
// Net: every row here is a DELIVERED proactive person-send with a known recipient. No replies,
// no pings, no queued. This is the clean+complete record the polluted messages table never was.

// Pure normalizer (testable with no DB).
export function normalizeProactiveSends(messageOutRows, relayRows) {
  const out = [];
  for (const e of messageOutRows || []) {
    const p = (e && e.payload) || {};
    if (!p.to_name) continue; // excludes interim_wait / empty_reply_reask pings (no recipient)
    out.push({ to_name: String(p.to_name), to_last4: String(p.to_last4 || ""), text: String(p.text || ""), via: p.via || "whatsapp", ts: e.created_at });
  }
  for (const e of relayRows || []) {
    const p = (e && e.payload) || {};
    if (!p.to_name || p.delivered === false) continue; // exclude queued/held relays (not delivered)
    out.push({ to_name: String(p.to_name), to_last4: String(p.to_last4 || ""), text: String(p.text || ""), via: "relay", ts: e.created_at });
  }
  return out;
}

// Thin DB fetch (the only impure part). Returns the normalized record since `sinceISO`.
export async function proactiveSendsSince(db, sinceISO) {
  try {
    const [mo, rc] = await Promise.all([
      db.from("events").select("created_at,payload").eq("type", "whatsapp.message_out").gte("created_at", sinceISO).limit(500),
      db.from("events").select("created_at,payload").eq("type", "sasa.relayed_colleague").gte("created_at", sinceISO).limit(300),
    ]);
    return normalizeProactiveSends((mo && mo.data) || [], (rc && rc.data) || []);
  } catch {
    return [];
  }
}
