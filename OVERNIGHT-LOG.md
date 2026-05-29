
## WHATSAPP ACTIVATION — 2026-05-29 ~01:30 (root-caused)
CORRECT credentials (everything earlier was wrong/stale):
- WABA: 966019139736588 ("Nisria")
- Phone: +1 727-222-0741, Phone Number ID: 1076945958842501 (NOT 1154152401110782, NOT 1140072532524812 — those are other WABAs)
- Token scoped (granular) to WABA 966019139736588 only; scopes whatsapp_business_messaging + whatsapp_business_management. User token for Oswald Teemak (36758875590366068), app Nisria Automation 1903581016868569. TEMPORARY token (refresh from API Setup "Generate access token").
Vercel env CORRECTED: WHATSAPP_PHONE_NUMBER_ID=1076945958842501, WHATSAPP_WABA_ID=966019139736588, WHATSAPP_TOKEN set. WHATSAPP_VERIFY_TOKEN=nisria-wa-e6cb4204b191d209. Still pending: WHATSAPP_APP_SECRET.

BUILT + DEPLOYED tonight (command.nisria.co):
- lib/whatsapp.ts (sendText/sendTemplate, reads PHONE_NUMBER_ID + TOKEN)
- webhook route now drafts a reply via lib/agents/comms draftReply (grounded via recall/groundingText), sends within 24h window, logs out + emits whatsapp.message_out/send_failed; escalate lane gets a holding reply. Typecheck clean.

THE ONE BLOCKER (user-side): phone status PENDING, ownership VERIFIED, but register fails 2388001
"Cannot Create Certificate / number registered to an existing WhatsApp account." deregister says
"not linked in Hosted System" => the holder is NOT our Cloud API. Either (a) consumer WhatsApp
account never fully deleted (removing the app != deleting the account; must do Settings>Account>Delete
my account on the number), or (b) number still attached to OLD WABA 3885764911733268. Fix: WhatsApp
Manager > check if 727 is under >1 WABA; remove from old, OR fully delete the consumer account; wait
~5 min; then re-run POST /1076945958842501/register {pin}. Pin to set on success: document it.
ALSO still required: subscribe webhook in dev console Configuration (callback /api/whatsapp/webhook,
verify token above, field 'messages') so inbound reaches the bot.

## WHATSAPP LIVE — 2026-05-29 ~02:05 ✅ (bidirectional proven)
RESOLVED: there were TWO duplicate "Nisria" WABAs. The 727 number is CONNECTED on
3885764911733268 (phone ID 1154152401110782), NOT 966019139736588 (empty duplicate, pending copy).
Earlier tokens were scoped to the empty 966 WABA -> every send failed. Fix: generate access token
selecting WABA ...733268. New token granular-scoped to 3885764911733268 (whatsapp_business_messaging
+ management). Vercel env CORRECTED: WHATSAPP_PHONE_NUMBER_ID=1154152401110782,
WHATSAPP_WABA_ID=3885764911733268, WHATSAPP_TOKEN=<3885-scoped, TEMP ~expires_at 1780009200>.
Subscribed app 1903581016868569 to WABA 3885764911733268 (POST /subscribed_apps -> success).
PROVEN: outbound text delivered to +971501168462; inbound "Hi" + "how much was donated this month"
both reached webhook + stored. Bot auto-drafts + replies (first reply FAILED only because it fired
pre-redeploy on stale phone ID 1076945958842501; corrected + redeployed).

NEXT (fresh session): the bot runs the EXTERNAL-donor comms brain (lib/agents/comms draftReply),
which ESCALATES money questions -> generic "team will follow up". For the INTERNAL team bot it must
ANSWER operationally from platform data (donations/finance/beneficiaries/tasks) via tool-use. Build a
team-bot brain (intent -> query Supabase -> humanized answer) instead of donor-reply.
STILL PENDING: WHATSAPP_APP_SECRET (signature verification), permanent system-user token for WABA
3885764911733268 (temp token expires), delete the empty duplicate WABA 966019139736588 to stop confusion.

## WHATSAPP TEAM-BOT BRAIN SHIPPED — 2026-05-29 ~02:30 ✅ (verified end-to-end)
The bot now answers operationally. Architecture (One-brain + field-nervous-system law):
- lib/agents/sasa.ts: extracted the /api/smart tool-use agent into runSasa({history,command,operatorName})
  -> {reply,actions}. /api/smart now calls it (web door). SAME brain on web + WhatsApp.
- Webhook is now fast-ack: dedupe inbound on external_id (wa_message_id), resolve/create contacts row,
  store inbound, enqueueJob('whatsapp.reply', contact_id, ...), triggerWorker('/api/whatsapp/worker'),
  return 200 immediately. No more inline brain on Meta's response path (was causing timeouts/retries).
- app/api/whatsapp/worker/route.ts: drains whatsapp.reply jobs. Rebuilds convo from contact's messages
  (threading). Routing: OPERATOR (team_members phone match OR WHATSAPP_OPERATORS allowlist) -> runSasa
  (live data + gated actions). Non-operator -> donor-comms draftReply, but only lane 'auto' sends verbatim;
  'approve'/'escalate' get a holding line (manage-by-exception, no donor-facing reply without Nur).
  Sends via lib/whatsapp sendText, logs outbound + emits.
- lib/whatsapp.ts: added phoneKey() (strips +/leading 00 so 00254... == 254...) + isOperator(db,waId).
- jobs.ts JobKind += 'whatsapp.reply'. Env: WHATSAPP_OPERATORS=971501168462(Taona),971501622716(Nur).
VERIFIED LIVE (simulated Meta inbound -> real WhatsApp out to 971501168462):
  "how much was donated this month?" -> "$1,791 so far this month, from 11 gifts." (sasa, real data)
  "how many open tasks?" -> "Zero open tasks right now." (sasa, threaded follow-up)
  stranger "can I sponsor a child?" -> warm comms reply (no ops data)
  stranger "$10k major gift?" -> holding line (gated, surfaced to Nur)
Jobs done, no errors. Typecheck clean, deployed to command.nisria.co.
STILL PENDING: WHATSAPP_APP_SECRET (set when Nur pastes it -> signature verification), PERMANENT
system-user token for WABA 3885 (current temp token expires ~2026-06), delete duplicate WABA 966.
CONSIDER: route bot-reply send through gateway.ts for idempotency+logging (currently direct sendText;
inbound dedupe already prevents double-reply). Broaden operator access (all team_members?) per Nur.
