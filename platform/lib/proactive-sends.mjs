// THE CANONICAL PROACTIVE-SEND RECORD (2026-06-23, KT #373, class C1 state-spine). One source
// of truth for "what did Sasa actually SEND to a person" — read by EVERY honesty / recall /
// "did-I-message" decision, so none of them guess from this-turn tools or read the polluted
// messages table (which also held the bot's own replies-to-operator).
//
// SOURCES (append-only events emitted at the real send seam, every row a DELIVERED person-send
// with a known recipient NAME; replies, status-pings, and queued sends are excluded by
// construction):
//   whatsapp.message_out   — message_person delivered a text/template (payload.to_name).
//   sasa.relayed_colleague — a team relay was DELIVERED (payload.to_name, delivered !== false).
//   whatsapp.file_sent     — a filed doc/photo delivered (payload.to_name, KT #373 enriched).
//   task.alert_sent        — a task reminder/assignment delivered (payload.to_names[], enriched).
// EXCLUDED: the two operator-facing status pings on message_out (interim_wait / empty_reply_reask,
//   no to_name); the bot's conversational REPLIES (sendTextAndLog, no event at all); QUEUED/held
//   relays (delivered:false); calendar/approval pings (operator-self, out of the "did you message
//   <person>" scope — tracked as a smaller remaining gap, not pollution).

// Pure normalizer (testable with no DB). Takes one array per source type.
export function normalizeProactiveSends({ messageOut = [], relay = [], file = [], taskAlert = [] } = {}) {
  const out = [];
  for (const e of messageOut) {
    const p = (e && e.payload) || {};
    if (!p.to_name) continue; // excludes interim_wait / empty_reply_reask pings (no recipient)
    out.push({ to_name: String(p.to_name), to_last4: String(p.to_last4 || ""), text: String(p.text || ""), via: p.via || "whatsapp", ts: e.created_at });
  }
  for (const e of relay) {
    const p = (e && e.payload) || {};
    if (!p.to_name || p.delivered === false) continue; // exclude queued/held relays (not delivered)
    out.push({ to_name: String(p.to_name), to_last4: String(p.to_last4 || ""), text: String(p.text || ""), via: "relay", ts: e.created_at });
  }
  for (const e of file) {
    const p = (e && e.payload) || {};
    if (!p.to_name) continue;
    out.push({ to_name: String(p.to_name), to_last4: String(p.to_last4 || ""), text: String(p.title || ""), via: "file", ts: e.created_at });
  }
  for (const e of taskAlert) {
    const p = (e && e.payload) || {};
    for (const nm of Array.isArray(p.to_names) ? p.to_names : []) {
      if (!nm) continue;
      out.push({ to_name: String(nm), to_last4: "", text: String(p.title || ""), via: "task_alert", ts: e.created_at });
    }
  }
  return out;
}

// Thin DB fetch (the only impure part). Returns the normalized record since `sinceISO`.
export async function proactiveSendsSince(db, sinceISO) {
  try {
    const sel = (type, lim) => db.from("events").select("created_at,payload").eq("type", type).gte("created_at", sinceISO).limit(lim);
    const [mo, rc, fl, ta] = await Promise.all([
      sel("whatsapp.message_out", 500),
      sel("sasa.relayed_colleague", 300),
      sel("whatsapp.file_sent", 200),
      sel("task.alert_sent", 300),
    ]);
    return normalizeProactiveSends({
      messageOut: (mo && mo.data) || [],
      relay: (rc && rc.data) || [],
      file: (fl && fl.data) || [],
      taskAlert: (ta && ta.data) || [],
    });
  } catch {
    return [];
  }
}
