// WhatsApp Cloud API send helpers (the bot's outbound voice, P-bot).
//
// Replies to an inbound message inside WhatsApp's 24-hour customer-service
// window can be free-form text (sendText). Outside that window WhatsApp only
// allows pre-approved templates (sendTemplate). Because the bot answers inbound
// messages, it is always inside the window, so sendText is the normal path.
//
// Credentials live in env (set in Vercel):
//   WHATSAPP_TOKEN            - access token with whatsapp_business_messaging
//   WHATSAPP_PHONE_NUMBER_ID  - the sending number's Phone Number ID (NOT the WABA id)
const GRAPH = "https://graph.facebook.com/v21.0";
const PHONE_ID = () => process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const TOKEN = () => process.env.WHATSAPP_TOKEN || "";

export function whatsappConfigured(): boolean {
  return Boolean(PHONE_ID() && TOKEN());
}

// MAINTENANCE LOCKDOWN — outbound gate. While MAINTENANCE_MODE=1, ONLY the
// phones in MAINTENANCE_ALLOWLIST (CSV of digits, no +) receive WhatsApp. Any
// other outbound — sasa replies, notify.ts pushes, group reposts — is suppressed
// at the HTTP layer with a synthetic maintenance_dropped result. Callers see
// {id:null, error:"maintenance_dropped"} which keeps best-effort code paths
// graceful. sendTextAndLog still logs the body to messages with
// status="maintenance_dropped" so the audit trail (and the harness) can read
// what would-have-shipped. Closes the lockdown leak where MAINTENANCE_MODE only
// gated inbound: a task assignment to Nur during maintenance still triggered a
// real heads-up to her phone. Fixed 2026-06-07 by Taona request.
function maintenanceDropTarget(payload: Record<string, any>): boolean {
  if (process.env.MAINTENANCE_MODE !== "1") return false;
  const to = String(payload?.to || "").replace(/^\+/, "").trim();
  if (!to) return false;
  const allow = String(process.env.MAINTENANCE_ALLOWLIST || "")
    .split(",")
    .map((s) => s.trim().replace(/^\+/, ""))
    .filter(Boolean);
  return !allow.includes(to);
}

async function send(payload: Record<string, any>): Promise<{ id: string | null; error?: string }> {
  if (!whatsappConfigured()) return { id: null, error: "whatsapp not configured" };
  if (maintenanceDropTarget(payload)) {
    return { id: null, error: "maintenance_dropped" };
  }
  // ── THE WALL (Architecture 2, 2026-06-12). sanitizeReply runs HERE, in the
  // primitive, not in a wrapper. Before this date the check lived only in
  // sendTextAndLog while the worker's main reply, the reassurance lines, the
  // group fanouts, and smart-tools all called sendText directly — fourteen
  // bypasses. Now there is no unsanitized door: every text body and every
  // media caption passes Sasa's BotGuardsConfig (brand wall + canned line
  // regression gate) before Meta sees it. Catches emit a P0 event,
  // fire-and-forget, so the alert never delays or blocks the send.
  try {
    const { sanitizeReply } = await import("./bot-guards/index.js");
    const { SASA_BOT_GUARDS_CONFIG } = await import("./bot/guards-config");
    let caught: any[] | null = null;
    if (payload?.text?.body) {
      const s = sanitizeReply(String(payload.text.body), SASA_BOT_GUARDS_CONFIG);
      if (s.caught.length) { payload = { ...payload, text: { ...payload.text, body: s.body } }; caught = s.caught; }
    } else if (payload?.image?.caption) {
      const s = sanitizeReply(String(payload.image.caption), SASA_BOT_GUARDS_CONFIG);
      if (s.caught.length) { payload = { ...payload, image: { ...payload.image, caption: s.body } }; caught = s.caught; }
    } else if (payload?.document?.caption) {
      const s = sanitizeReply(String(payload.document.caption), SASA_BOT_GUARDS_CONFIG);
      if (s.caught.length) { payload = { ...payload, document: { ...payload.document, caption: s.body } }; caught = s.caught; }
    }
    if (caught) {
      import("./events").then(({ emit }) => emit({
        type: "pre_send_caught",
        source: "lib:whatsapp.send",
        actor: "P-bot",
        subject_type: "contact",
        subject_id: null,
        payload: { to: String(payload?.to || ""), caught: caught!.map((c: any) => ({ kind: c.kind, pattern: c.pattern, mode: c.mode, original: String(c.original || "").slice(0, 400) })) },
      })).catch(() => {});
    }
  } catch {
    // The wall must never break delivery. A guards failure means the body
    // ships unfiltered this once; the import error will surface in logs.
  }
  const r = await fetch(`${GRAPH}/${PHONE_ID()}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { id: null, error: j?.error?.message || `WhatsApp send failed (${r.status})` };
  return { id: j?.messages?.[0]?.id ?? null };
}

// Free-form text reply (24h window). `to` is the recipient's wa_id (digits, no +).
export function sendText(to: string, body: string) {
  return send({ to, type: "text", text: { body: String(body).slice(0, 4096), preview_url: false } });
}

// Send a MEDIA message (24h window) BY LINK. WhatsApp fetches the URL itself, so
// the link MUST be publicly fetchable by Meta's servers: a Supabase signed URL
// works; the login-gated /api/asset does NOT (Meta cannot authenticate the
// session cookie). `to` is the recipient's wa_id. Use sendImage for photos and
// sendDocument for PDFs/files (filename is shown to the recipient).
export function sendImage(to: string, link: string, caption?: string) {
  return send({ to, type: "image", image: { link, ...(caption ? { caption: String(caption).slice(0, 1024) } : {}) } });
}
export function sendDocument(to: string, link: string, filename: string, caption?: string) {
  return send({ to, type: "document", document: { link, filename: String(filename || "file").slice(0, 240), ...(caption ? { caption: String(caption).slice(0, 1024) } : {}) } });
}

// Template message (works outside the 24h window, AND inside it). This is the
// ONLY reliable path for a PROACTIVE, unsolicited push (a task alert, a morning
// brief, an incident): free-form sendText silently fails outside the 24h window,
// a template never does. `params` fill the body variables ({{1}},{{2}},...) in
// order. WhatsApp rejects a body param containing a newline/tab, so callers pass
// short single-line strings. Defaults to hello_world (no params) for probes.
export async function sendTemplate(to: string, name = "hello_world", params: string[] = [], lang = "en_US") {
  // Template frames are Meta approved copy, but the PARAMS are live text and
  // can carry a leak ("task from Stephen"). Sanitize each param against the
  // wall; a brand inside a param drops THAT param to the reask phrase, never
  // the whole template. Best effort: a guards failure ships params as-is.
  let cleanParams = params;
  try {
    if (params.length) {
      const { sanitizeReply } = await import("./bot-guards/index.js");
      const { SASA_BOT_GUARDS_CONFIG } = await import("./bot/guards-config");
      cleanParams = params.map((p) => sanitizeReply(String(p), SASA_BOT_GUARDS_CONFIG).body);
    }
  } catch { /* wall must never break delivery */ }
  const components = cleanParams.length
    ? [{ type: "body", parameters: cleanParams.map((t) => ({ type: "text", text: String(t).replace(/\s+/g, " ").slice(0, 1000) })) }]
    : undefined;
  return send({ to, type: "template", template: { name, language: { code: lang }, ...(components ? { components } : {}) } });
}

// Show the native WhatsApp typing indicator (the three animated dots) on the
// sender's chat while the bot composes its reply. The Cloud API couples this
// with marking the inbound message as read: one call does both. The dots show
// for up to 25 seconds, or until the next outbound message is sent (sendText
// auto-dismisses them). `messageId` is the inbound message's wamid. This is a
// status update, NOT a message send, so it does not route through send() (which
// would inject recipient_type and to). Best-effort: never breaks the reply.
export async function sendTypingIndicator(messageId: string): Promise<void> {
  if (!messageId || !whatsappConfigured()) return;
  try {
    await fetch(`${GRAPH}/${PHONE_ID()}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
        typing_indicator: { type: "text" },
      }),
      cache: "no-store",
    });
  } catch {
    // ignore: the indicator is a nicety, the reply must still go out.
  }
}

// Download an inbound media object (image / document / audio) by its WhatsApp
// media id. Two hops: resolve the short-lived URL, then fetch the bytes with the
// token. Returns base64 + mime, or null on failure (caller degrades gracefully).
export async function downloadMedia(mediaId: string): Promise<{ base64: string; mime: string } | null> {
  if (!mediaId || !TOKEN()) return null;
  try {
    const meta = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${TOKEN()}` }, cache: "no-store" });
    const mj = await meta.json();
    if (!meta.ok || !mj?.url) return null;
    const bin = await fetch(mj.url, { headers: { Authorization: `Bearer ${TOKEN()}` }, cache: "no-store" });
    if (!bin.ok) return null;
    const buf = Buffer.from(await bin.arrayBuffer());
    return { base64: buf.toString("base64"), mime: mj.mime_type || "application/octet-stream" };
  } catch {
    return null;
  }
}

// --- identity helpers -------------------------------------------------------
// Reduce any phone string to a comparable digits key: drop +, spaces, and a
// leading "00" international prefix. Team phones are stored as "00254..." while a
// WhatsApp wa_id arrives as "254...", so both normalise to the same key.
export function phoneKey(s: string): string {
  let d = (s || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  return d;
}

// Law 12 (test-mode). Taona is the standing developer of the bot fleet — every
// bot we ship recognises him as the developer identity, and test traffic must
// reroute to him and never persist. Override via DEV_PHONE env. Default falls
// back to Taona's hardcoded number so dev-mode never silently spams Nur.
const DEV_PHONE_FALLBACK = "971501168462";
export function devPhone(): string {
  return phoneKey(process.env.DEV_PHONE || DEV_PHONE_FALLBACK);
}
export function isDeveloperPhone(waId: string): boolean {
  return phoneKey(waId) === devPhone();
}

// Who is this WhatsApp sender, and what may the bot do for them?
//   'admin' — Nur or the WHATSAPP_OPERATORS allowlist (e.g. the builder). Full
//             Sasa: every read + action.
//   'team'  — anyone whose number is on an active team_members profile. A SAFE
//             subset: log tasks / beneficiary intakes / inventory, check their
//             tasks. NO donor or financial data. Decisions route to Nur.
//   null    — everyone else. The bot stays SILENT (this is an internal line).
// The allowlist is matched first, so Nur (also a team member) is treated as admin.
//
// rank refines an admin into the authority the bot should recognise:
//   'owner'   — Taona, the builder/developer of this system, final say on everything.
//               Detected by OWNER_WHATSAPP env, or as the allowlisted number that is
//               NOT on the team roster (the builder is not a Nisria staff member).
//   'founder' — Nur, who runs Nisria day to day (on the team roster as Founder).
//   'member'  — a team operator (rare); plain admins without a rank otherwise.
export type OperatorRole = "admin" | "team" | null;
export type OperatorRank = "owner" | "founder" | "member" | null;
export async function operatorOf(db: any, waId: string): Promise<{ role: OperatorRole; name: string | null; rank: OperatorRank; botAccess?: boolean }> {
  const key = phoneKey(waId);
  if (!key) return { role: null, name: null, rank: null };
  const allow = (process.env.WHATSAPP_OPERATORS || "").split(",").map((x) => phoneKey(x)).filter(Boolean);
  const owners = (process.env.OWNER_WHATSAPP || "").split(",").map((x) => phoneKey(x)).filter(Boolean);
  const ownerName = process.env.OWNER_NAME || "Taona";
  const { data } = await db.from("team_members").select("name,phone,status,bot_access").limit(400);
  const member = (data || []).find((t: any) => phoneKey(t.phone) === key);
  // Explicit owner override always wins.
  if (owners.includes(key)) return { role: "admin", name: member?.name || ownerName, rank: "owner", botAccess: true };
  if (allow.includes(key)) {
    // An allowlisted builder who is NOT on the team roster is the owner; an
    // allowlisted person who IS on the roster (Nur) is the founder.
    if (member) return { role: "admin", name: member.name, rank: "founder", botAccess: true };
    return { role: "admin", name: ownerName, rank: "owner", botAccess: true };
  }
  // A roster member is "team" tier. botAccess (the bot_access flag) decides whether
  // the 727 worker actually ANSWERS them: the tier is the same walled team subset,
  // but only flagged members get a private 727 line (the rest work via the group bot).
  if (member && (member.status === "active" || !member.status)) return { role: "team", name: member.name, rank: "member", botAccess: member.bot_access === true };
  return { role: null, name: null, rank: null };
}

// Resolve a wa_id to its contacts.id, creating the contact on first contact.
// Moved here from the webhook (was a private copy) so EVERY send path resolves
// the SAME conversation thread the brain replays. `phone` is computed the exact
// way the webhook stored it (bare digits) so it matches existing contact rows.
// (One-brain law: one resolver, one thread.)
export async function resolveContact(db: any, waId: string, name?: string | null): Promise<string | null> {
  const phone = (waId || "").replace(/\D/g, "");
  if (!phone) return null;
  const { data: found } = await db.from("contacts").select("id").eq("phone", phone).eq("channel", "whatsapp").limit(1);
  if (found && found.length) return found[0].id;
  const { data: made } = await db
    .from("contacts")
    .insert({ name: name || phone, phone, channel: "whatsapp" })
    .select("id")
    .single();
  return made?.id ?? null;
}

// THE OUTBOUND CHOKEPOINT (Field-nervous-system + One-brain laws). Send free
// form text AND persist it to `messages` in one call, so the bot's own proactive
// voice (notifications, reminders, the bank summary) lands in historyFor()'s
// short-term window. Before this, only the live reply path logged, so the agent
// had no memory of anything it pushed and would contradict itself the moment the
// user referenced it. The message log IS the agent's reality: nothing may speak
// to a user without leaving a trace here. Logging is best-effort relative to the
// send: a log failure must never swallow the actual delivery.
// Pre-send deterministic checker. Architecture 2 (2026-06-11). If a Sasa-handled
// outbound body matches a banned pattern (regressed canned line, leaked
// implementation detail), rewrite to a short neutral re-ask BEFORE delivery.
// The defense is in code so a future commit that re-introduces the substitution
// upstream still cannot land at a user. Logs both the original (pre_send_caught)
// and the rewritten body so audits stay honest.
// Pre-send deterministic checker — Architecture 2 (2026-06-11), rebuilt
// 2026-06-12 on the shared @sinanagency/bot-guards lib. The PRIMITIVE send()
// above is the actual wall (brand leaks + banned patterns, every outbound).
// This wrapper runs the SAME sanitizeReply first only so that (a) the
// messages-table transcript records exactly what shipped, never diverging
// from the wire, and (b) the P0 event carries the resolved contactId. The
// second pass inside send() is then a no-op on the already-clean body.
async function preSendSanitize(body: string, handledBy: string): Promise<{ body: string; caught: { pattern: string; original: string } | null }> {
  if (handledBy !== "sasa") return { body, caught: null };
  try {
    const { sanitizeReply } = await import("./bot-guards/index.js");
    const { SASA_BOT_GUARDS_CONFIG } = await import("./bot/guards-config");
    const s = sanitizeReply(body, SASA_BOT_GUARDS_CONFIG);
    if (s.caught.length) {
      const first = s.caught[0];
      return { body: s.body, caught: { pattern: `${first.kind}:${first.pattern}`, original: String(first.original || "").slice(0, 600) } };
    }
    return { body: s.body, caught: null };
  } catch {
    return { body, caught: null };
  }
}
const PRE_SEND_REASK = "Tell me a bit more so I can do that for you.";

export async function sendTextAndLog(
  db: any,
  to: string,
  body: string,
  opts?: { contactId?: string | null; handledBy?: string; dev?: boolean },
): Promise<{ id: string | null; error?: string }> {
  const handledBy = opts?.handledBy || "sasa";
  const sanitized = await preSendSanitize(body, handledBy);
  const sendBody = sanitized.body;
  // Law 12 (test-mode). Reroute to the developer phone, skip the messages
  // insert, skip medic + pre-send alarm. Single chokepoint preserved; dev
  // branch documented and explicit per call. Test traffic never lands on Nur
  // and never pollutes Sasa's transcript or audit log.
  if (opts?.dev) {
    const devRes = await sendText(devPhone(), `[DEV] ${sendBody}`);
    return devRes;
  }
  const res = await sendText(to, sendBody);
  let insertedId: string | null = null;
  let contactIdResolved: string | null = null;
  const status = res.id ? "sent" : (res.error === "maintenance_dropped" ? "maintenance_dropped" : "failed");
  try {
    contactIdResolved = opts?.contactId ?? (await resolveContact(db, to));
    const { data } = await db.from("messages").insert({
      channel: "whatsapp", direction: "out", body: sendBody, handled_by: handledBy,
      status, account: "whatsapp",
      external_id: res.id || null, contact_id: contactIdResolved, sender_type: "individual",
    }).select("id").single();
    insertedId = (data as any)?.id ?? null;
  } catch (err) {
    console.error("sendTextAndLog: message log failed (send still happened)", err);
  }
  // Pre-send regression alarm: a Sasa outbound matched a banned pattern. Fire
  // a P0 event so the team is paged and the upstream commit can be reverted.
  if (sanitized.caught) {
    try {
      const { emit } = await import("./events");
      await emit({
        type: "pre_send_caught_canned_line",
        source: "lib:whatsapp.sendTextAndLog",
        actor: "P-bot",
        subject_type: "contact",
        subject_id: contactIdResolved,
        payload: { pattern: sanitized.caught.pattern, original: sanitized.caught.original, rewritten_to: PRE_SEND_REASK, message_id: insertedId },
      });
    } catch (err) {
      console.error("pre-send alarm emit failed", err);
    }
  }
  // SASA MEDIC. Fire-and-forget audit of any Sasa outbound that looks like an
  // "I can't see / no access" fumble. Never blocks the send, never throws. The
  // medic loop-guards itself by ignoring handledBy !== 'sasa'.
  try {
    if (res.id) {
      const { dispatchMedicAudit } = await import("./medic");
      dispatchMedicAudit({
        messageId: insertedId,
        contactId: contactIdResolved,
        body,
        handledBy,
      });
    }
  } catch {
    // medic must never break the send
  }
  return res;
}

// Template variant of the chokepoint. WhatsApp renders the approved template, so
// the caller passes `logBody`, the human readable line the recipient actually
// sees, for the brain log (separate from the template `params`). Same best
// effort logging contract as sendTextAndLog.
export async function sendTemplateAndLog(
  db: any,
  to: string,
  name: string,
  params: string[],
  logBody: string,
  opts?: { contactId?: string | null; lang?: string },
): Promise<{ id: string | null; error?: string }> {
  const res = await sendTemplate(to, name, params, opts?.lang || "en_US");
  const status = res.id ? "sent" : (res.error === "maintenance_dropped" ? "maintenance_dropped" : "failed");
  try {
    const contactId = opts?.contactId ?? (await resolveContact(db, to));
    await db.from("messages").insert({
      channel: "whatsapp", direction: "out", body: logBody, handled_by: "sasa",
      status, account: "whatsapp",
      external_id: res.id || null, contact_id: contactId, sender_type: "individual",
    });
  } catch (err) {
    console.error("sendTemplateAndLog: message log failed (send still happened)", err);
  }
  return res;
}
