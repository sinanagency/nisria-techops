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

async function send(payload: Record<string, any>): Promise<{ id: string | null; error?: string }> {
  if (!whatsappConfigured()) return { id: null, error: "whatsapp not configured" };
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

// Template message (works outside the 24h window). Defaults to the hello_world test template.
export function sendTemplate(to: string, name = "hello_world", lang = "en_US") {
  return send({ to, type: "template", template: { name, language: { code: lang } } });
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
export async function operatorOf(db: any, waId: string): Promise<{ role: OperatorRole; name: string | null; rank: OperatorRank }> {
  const key = phoneKey(waId);
  if (!key) return { role: null, name: null, rank: null };
  const allow = (process.env.WHATSAPP_OPERATORS || "").split(",").map((x) => phoneKey(x)).filter(Boolean);
  const owners = (process.env.OWNER_WHATSAPP || "").split(",").map((x) => phoneKey(x)).filter(Boolean);
  const ownerName = process.env.OWNER_NAME || "Taona";
  const { data } = await db.from("team_members").select("name,phone,status").limit(400);
  const member = (data || []).find((t: any) => phoneKey(t.phone) === key);
  // Explicit owner override always wins.
  if (owners.includes(key)) return { role: "admin", name: member?.name || ownerName, rank: "owner" };
  if (allow.includes(key)) {
    // An allowlisted builder who is NOT on the team roster is the owner; an
    // allowlisted person who IS on the roster (Nur) is the founder.
    if (member) return { role: "admin", name: member.name, rank: "founder" };
    return { role: "admin", name: ownerName, rank: "owner" };
  }
  if (member && (member.status === "active" || !member.status)) return { role: "team", name: member.name, rank: "member" };
  return { role: null, name: null, rank: null };
}
