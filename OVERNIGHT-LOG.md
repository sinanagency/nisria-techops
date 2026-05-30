
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

## PERMANENT TOKEN IN — 2026-05-29 ~12:35 ✅
System user "nisria-whatsapp" (ID 61590561056682, Admin) created under By Nisria Inc business.
Given Full control on the Nisria Automation app (via Accounts>Apps>Add people, NOT the system-user
"Installed apps" tab which is a dead end) + WhatsApp account 3885764911733268. Generated token:
type SYSTEM_USER, expires_at 0 (NEVER), scopes whatsapp_business_messaging + management. Validated +
probe-send OK on phone 1154152401110782. Set as WHATSAPP_TOKEN in Vercel, deployed. Final prod test:
"paid Dorcas Njambi 10000 salary and 2500 cleaning supplies" -> "Logged 2 payments, KES 12,500"
DELIVERED. The temp-token expiry problem is permanently solved.
NOTE: same system user already has the 3 FB Pages (AHADI, Maisha, Nisria) + ad accounts assigned, so
the SAME app/system-user is the foundation for FB + IG posting later (needs page/IG scopes added:
pages_manage_posts, pages_read_engagement, pages_show_list, instagram_basic, instagram_content_publish).

## SOCIAL POSTING TOKEN PARKED — 2026-05-29 ~15:15
Generated a SECOND token from the same system user nisria-whatsapp (one robot, many keys; Meta caps
admin system users at 1, so reuse it, don't make new admin ones). SYSTEM_USER, expires 0 (never).
Scopes: pages_show_list, pages_manage_posts, pages_read_engagement, pages_messaging, publish_video,
instagram_basic, instagram_content_publish, instagram_manage_comments, instagram_manage_insights,
instagram_manage_messages, instagram_manage_contents, business_management.
Stored in Vercel as META_SOCIAL_TOKEN (production). NOT YET USED by any code, parked for the future
FB+IG social feature (draft -> approve in Needs You -> post). Page IDs: Nisria 1129284943925631,
Maisha By Nisria 112265004832438, AHADI By Nisria 108320923993373.
IG posting flow when built: get page token -> get linked IG business id -> POST /{ig}/media then
/media_publish. FB: POST /{page-id}/feed or /photos. Could add later if wanted: pages_manage_engagement
(reply to FB comments), read_insights (FB page analytics). ZANII ads = separate Business Manager, not here.

## PHASE 1 SHIPPED — 2026-05-29 ~17:30 (security + voice)
- WHATSAPP_APP_SECRET set (f898...). Webhook now HMAC-verifies x-hub-signature-256. Verified: signed
  call -> {received:true}, bad sig -> 401 "bad signature". Real Meta calls are signed so inbound works;
  if a real message ever goes silent, suspect a mistyped secret and check first.
- Voice notes: lib/transcribe.ts (OpenAI gpt-4o-transcribe, CLOUD not DGX per project rule). Worker
  audio branch now downloads + transcribes -> transcript becomes the command (logged onto the inbound
  row too). Round-trip proven: say->m4a->transcribe = "...paid Lucy Wanjiku 15,000 shillings for salary".
  Video/sheets still nudge. OPENAI_API_KEY already in env.
LIVE TEST NEEDED (real Meta-signed): Taona sends a real voice note + a real text to 727 to confirm
signature value matches Meta + transcription end-to-end.
NOTE: jobs.ts now has a 'group.send' JobKind + smart-tools has member aliases, appearing via parallel
edits (user/other session likely building the group bot). COORDINATE before I build group listener to
avoid collision.

## OVERNIGHT AUTONOMOUS RUN — 2026-05-30 (groups redesign + finance + voice + security)
SHIPPED + DEPLOYED to command.nisria.co (build green each time):
- VOICE NOTES: lib/transcribe.ts (OpenAI gpt-4o-transcribe, NOT DGX). Worker transcribes audio ->
  transcript becomes the command. Round-trip proven.
- APP SECRET set (f898...): webhook now HMAC-verifies signatures. Verified signed->200, bad->401.
- GROUPS REDESIGN (the big one):
  * app/api/groups/messages/route.ts (NEW): per-group feed, sender->contact name, mine flag
    (owner Nur/Sasa = right), system-message noise filtered out ("security code changed" etc).
  * components/GroupChat.tsx (NEW): WhatsApp-faithful. Owner right / others left + per-name colour,
    time stamps, date dividers (Today/Yesterday/date), dotted doodle backdrop (.wa-chat), in-chat
    search w/ highlight, inline images + Drive-link rendering + media-placeholder icons, client-side
    group switch (edge .wa-edge arrows + dropdown, no reload), MAXIMIZE -> FocusSheet (canonical
    overlay, same as Need You) with all groups as siblings so prev/next arrows step between groups.
  * app/groups/page.tsx: now server-loads the group LIST, renders <GroupChat> (hybrid). Old inline
    server chat removed.
  * components/GroupLink.tsx: compact pill (collapsed), slim "linked" line when connected,
    RED auto-return QR when status banned/logged_out. app/api/group/link adds `status` field.
  * globals.css: .wa-chat doodle + .wa-edge edge arrows.
  * Data: all 4 groups already imported (Admin 7191, Grants 410, Maisha Ops 1378, Social 348) with
    real timestamps + sender contacts. scripts/import-wa-groups.py written (idempotent; skipped, data present).
- FINANCE: Givebutter payouts EXCLUDED from "Reminders — due soon" (app/finance/page.tsx isPayout
  guard). Was 21 reminders (14 real + 7 payouts) -> now 14 real obligations (rent/utilities/etc).
  Per doctrine: payouts are the bridge, not a bill.

FLAGS / NOT mine (parallel group-listener track, or needs untestable access):
- "Act as Nur on tag" REPLY + live group capture = the Baileys group LISTENER (parallel track,
  waiting on the Kenyan number link). Groups page DISPLAYS; listener REPLIES. Not built here.
- Links -> Library INGESTION (fetch Drive link content + createBatch): display done, but ingestion
  needs SA Drive access + a real link to test. NOT built blind (no-proof rule). Flag for when testable.
- Exports were TEXT-ONLY (no media files), so no historical media to populate; live media handled by worker.
Scope guard held: did NOT touch group.send/listener backend, jobs.ts JobKind, or the parallel brain edits.
