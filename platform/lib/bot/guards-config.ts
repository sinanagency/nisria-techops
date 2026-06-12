// Sasa's BotGuardsConfig — the wall Sasa never had.
//
// HISTORY: the doctrine and the fleet docs always described Sasa as banning
// "Jensen" / "Stephen" / "4Q" (the historical leak went Jensen → Sasa, where
// 4Q surfaced under a fictional "Stephen" inventor). Until 2026-06-12 that ban
// existed only in the shared lib's test mock; Sasa's live preSendSanitize
// checked one canned line and nothing else. This file makes the documented
// wall real. It is consumed by lib/whatsapp.ts at the send() primitive, so
// EVERY outbound (worker reply, reassurance line, group fanout, notify push,
// smart-tools send, media caption) passes it with no bypassable wrapper.
//
// "Jensen" as a banned word: Nisria has no Jensen on the roster or in the
// beneficiary base today. If one ever appears, the pre_send_caught event log
// will say so immediately and the entry comes out — that is the per bot
// config doing its job, not a bug.

import { defineBotConfig } from "../bot-guards/index.js";

export const SASA_BOT_GUARDS_CONFIG = defineBotConfig({
  botName: "Sasa",

  bannedPatterns: [
    // HONEST_NO_ACTION regression gate. The canned substitution was deleted
    // from sasa.ts on 2026-06-11 after 58 mis-fires in 7 days. If ANY commit
    // re-introduces it upstream, this drops it before a user ever sees it.
    {
      pattern: /i have not actually done that yet|so i won'?t say i did|i'?ll get it done now rather than keep talking about it/i,
      mode: "drop" as const,
      label: "honest_no_action_canned",
    },
  ],

  forbiddenBrands: [
    "Jensen",
    "Stephen",
    "4Q",
    "four quadrant",
    "four quadrants",
    "La Rencontre",
    "Cape Town Halaal",
    "Young at Heart",
    "Canada Made",
  ],

  intentEnum: [
    "task_create",
    "task_title_reply",
    "payment_record",
    "case_create",
    "confirm_yes",
    "confirm_no",
    "question_read",
    "meta_capability",
    "open_conversation",
  ],

  pendingKinds: ["record_payment", "bank_import", "task_collecting"],

  reaskPhrase: "Tell me a bit more so I can do that for you.",

  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
});
