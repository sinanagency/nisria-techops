// Read-only mirror of every messages row into Chatwoot (Path B). Lives
// entirely outside Sasa's prod critical path: catches and swallows every
// error so a Chatwoot outage cannot ever block a Nur reply or a worker
// dispatch. Same instinct as Doctrine Law 11 (honesty) applied to
// telemetry, the watcher must never lie about its own availability by
// blocking the system it watches.

const URL = process.env.CHATWOOT_URL || "";
const INBOX_IDENTIFIER = process.env.CHATWOOT_SASA_INBOX_IDENTIFIER || "";

type Direction = "incoming" | "outgoing";

async function getOrCreateContactSourceId(phone: string): Promise<string | null> {
  const identifier = encodeURIComponent(phone);
  try {
    const res = await fetch(`${URL}/public/api/v1/inboxes/${INBOX_IDENTIFIER}/contacts/${identifier}`);
    if (res.ok) {
      const j: any = await res.json();
      return j?.source_id || identifier;
    }
  } catch { /* fall through */ }
  try {
    const res = await fetch(`${URL}/public/api/v1/inboxes/${INBOX_IDENTIFIER}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: phone, name: phone, phone_number: phone.startsWith("+") ? phone : `+${phone}` }),
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    return j?.source_id || identifier;
  } catch { return null; }
}

async function getOrCreateConversation(sourceId: string): Promise<string | null> {
  try {
    const res = await fetch(`${URL}/public/api/v1/inboxes/${INBOX_IDENTIFIER}/contacts/${sourceId}/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    return j?.id ? String(j.id) : null;
  } catch { return null; }
}

const conversationCache: Map<string, string> = new Map();

export async function mirrorToChatwoot(direction: Direction, phone: string, body: string): Promise<void> {
  if (!URL || !INBOX_IDENTIFIER || !phone || !body) return;
  try {
    const sourceId = await getOrCreateContactSourceId(phone);
    if (!sourceId) return;
    let convId = conversationCache.get(sourceId);
    if (!convId) {
      convId = (await getOrCreateConversation(sourceId)) || undefined;
      if (!convId) return;
      conversationCache.set(sourceId, convId);
    }
    await fetch(`${URL}/public/api/v1/inboxes/${INBOX_IDENTIFIER}/contacts/${sourceId}/conversations/${convId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: body, message_type: direction }),
    });
  } catch { /* never block */ }
}
