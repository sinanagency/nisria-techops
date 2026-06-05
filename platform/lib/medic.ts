// SASA MEDIC. Post-send watchdog that catches embarrassing replies (the "I don't
// have visibility / I haven't been given access" pattern Nur hit on the Finances
// group), autonomously sends a corrective WhatsApp follow-up, and opens a draft
// GitHub PR with a proposed prompt or tool fix so the same hole closes for good.
//
// Architecture: this file is the LIGHT side (detector + dispatcher). It runs in
// the request hot path inside sendTextAndLog and MUST be fire-and-forget: a
// medic outage never blocks a Sasa send. The HEAVY side (re-investigation,
// correction generation, PR creation) lives in /api/medic/audit, hit async.
//
// Killswitch: set MEDIC_ENABLED=false in env to disable all detection without a
// code change. Default is OFF unless explicitly set to "true".
//
// Loop guard: the medic itself sends WhatsApp via sendTextAndLog with
// handled_by='sasa-medic'. The detector ignores any message whose handled_by is
// not 'sasa', so the medic never audits its own output.

const RED_FLAGS: { pattern: RegExp; signal: string }[] = [
  // FAMILY A: "no access / no visibility" — the original index case (Finances group).
  { pattern: /i don'?t have visibility/i,                signal: "no_visibility" },
  { pattern: /i haven'?t been given access/i,            signal: "no_access" },
  { pattern: /i can'?t see (the |its |their )?(past |recent )?messages/i, signal: "cant_see_messages" },
  { pattern: /i don'?t have access to (the |that )/i,    signal: "no_access_to" },
  { pattern: /haven'?t been (told|able to) (see|read|access)/i, signal: "havent_been_able_to" },
  { pattern: /i'?m not (set up|configured) to/i,         signal: "not_configured" },
  { pattern: /not been given (the )?(access|visibility|permission)/i, signal: "not_given_access" },
  { pattern: /i cannot (see|access|read) (the )?(past|previous|history)/i, signal: "cannot_see_history" },
  // FAMILY B: refusal-shaped hedges on simple writes — Sasa asks permission to do
  // something she can already do (e.g. update_payment for attribution). Detected
  // on the Kush General Store + Dorcas attribution incident 2026-06-05.
  { pattern: /would you like me to (note|add|tag|include|record) that (fact )?separately/i, signal: "deflect_note_separately" },
  { pattern: /is (?:just )?logging .* enough for now/i,  signal: "deflect_enough_for_now" },
  { pattern: /isn'?t in the (payment|task|record|case) (record|itself)/i, signal: "deflect_not_in_record" },
  // FAMILY C: loop-breaker fire as a refusal substitute. The LOOP_BREAK message
  // itself ("I'm going in circles", "I'm stuck") landing on the user is by
  // definition a moment Sasa failed to act and gave up. Surface to medic.
  { pattern: /i'?m going in circles/i,                   signal: "loop_break_fired" },
  { pattern: /i'?m stuck, not making progress/i,         signal: "stuck_no_progress" },
  // FAMILY D: money-shaped completion claim. Phrase looks like "Done. Logged
  // KES 3,625…" / "Recorded $241 to X". This may be true OR false; the medic's
  // job is to verify via DB query (was a matching payment row inserted within
  // ±5min of this send?). Detected on the Fargo Courier 13:11 incident 2026-06-05,
  // where Sasa claimed "Done. Logged KES 3,625 to Fargo Courier" with no
  // record_payment ok=true backing it — the row did not insert until 13:19:37.
  // The medic resolves true/false by reading the payments table at audit time.
  { pattern: /\b(?:done\.?\s+)?(?:logged|recorded|saved|created)\s+(?:[A-Z]{3}\s*[\d,\.]+|\$\s*[\d,\.]+|KSh\s*[\d,\.]+)/i, signal: "claimed_logged_money" },
  { pattern: /\bi(?:'?ve| have)\s+(?:logged|recorded|saved)\s+(?:the\s+)?(?:[A-Z]{3}\s*[\d,\.]+|\$\s*[\d,\.]+|payment)/i, signal: "claimed_logged_payment" },
  // FAMILY E: HONEST_NO_ACTION canned-line fire. "I have not actually done that
  // yet, so I won't say I did" is the deterministic backstop for
  // claims-completion-without-success. Whenever it actually lands on the user,
  // Sasa failed to act in a context where she should have (user forwarded an
  // M-Pesa receipt, or said yes with a typo like "Yas" / "yeah"). Detected on
  // Nur incidents 13:52:25 (HONEST_NO_ACTION on receipt forward) and 14:00:23
  // ("Yas" not recognised as yes) on 2026-06-05.
  { pattern: /i have not actually done that yet/i,       signal: "honest_no_action_fired" },
  { pattern: /so i won'?t say i did/i,                   signal: "honest_no_action_fragment" },
  // FAMILY F: vague catch-all offer. Sasa filed or parsed something the user
  // shared and asked a vague open question ("what would you like me to do with
  // them?") instead of inferring the obvious next step from conversation tempo
  // or proposing concrete options. Detected on Nur incidents 12:45 (after
  // filing Relay statements) and 12:50 (after parsing Eid receipts) on
  // 2026-06-05, where Sasa stalled the payment-logging tempo with vague offers.
  { pattern: /what would you like me to do with (them|these|those|it)\??/i, signal: "vague_offer_with_them" },
  { pattern: /\bor something else\??/i,                  signal: "vague_offer_or_else" },
];

export function detectFumble(body: string): string | null {
  if (!body) return null;
  for (const r of RED_FLAGS) if (r.pattern.test(body)) return r.signal;
  return null;
}

export function medicEnabled(): boolean {
  return String(process.env.MEDIC_ENABLED || "").toLowerCase() === "true";
}

function baseUrl(): string {
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return process.env.NEXT_PUBLIC_BASE_URL || "https://command.nisria.co";
}

// Fire-and-forget audit dispatch. Returns immediately. Errors are swallowed: a
// medic failure must never delay or block a real Sasa send.
export function dispatchMedicAudit(args: {
  messageId: string | null;
  contactId: string | null;
  body: string;
  handledBy: string;
}): void {
  try {
    if (!medicEnabled()) return;
    if (args.handledBy !== "sasa") return; // loop guard
    if (!args.messageId || !args.contactId) return;
    const signal = detectFumble(args.body);
    if (!signal) return;

    const url = `${baseUrl()}/api/medic/audit`;
    const secret = process.env.MEDIC_SECRET || process.env.GROUP_BOT_SECRET || "";
    // node fetch is fire-and-forget here; do not await
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-medic-secret": secret },
      body: JSON.stringify({
        messageId: args.messageId,
        contactId: args.contactId,
        body: args.body,
        signal,
      }),
      cache: "no-store",
    }).catch(() => {});
  } catch {
    // never throw from the detector
  }
}
