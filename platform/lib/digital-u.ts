// Digital Nur meeting-bot driver for Nisria. Mirrors the Jensen-PA pattern
// (see jensen-pa/lib/digital-u.ts), wired into Nisria's own task schema,
// chokepoint, and persona. The meeting-bot is the engine; Nisria is one
// of multiple drivers. KT #230.
//
// Called by:
//   1. WhatsApp worker: Nur pastes a Zoom/Meet/Teams link → instant dispatch.
//   2. (Future) Calendar sync: scan upcoming events with meeting URLs.
//
// The meeting-bot POSTs notes back to /api/digital-u/ingest where the
// transcript becomes tasks (priority-mapped) + a WhatsApp summary in Sasa's
// voice via sendTextAndLog.

const MEET_RE = /(https?:\/\/(?:meet\.google\.com|[^\s]*\.zoom\.us|[^\s]*zoom\.us|teams\.(?:microsoft|live)\.com)\/[\w\-/?&=#.@]+)/i;

export function extractMeetingLink(text: string): string | null {
  const m = String(text || "").match(MEET_RE);
  if (!m) return null;
  return m[1].replace(/[).,;'"!?\]]+$/, "");
}

const CANCEL_RE = /^(?:(?:digital\s+nur\b)|(?:hey\s+(?:digital\s+nur|bot|sasa))\b)?\s*[,.:]?\s*(stop(?:\s+it)?|leave(?:\s+(?:the\s+)?(?:meeting|call|room))?|cancel|abort|get\s+out|kill\s+(?:it|the\s+bot)|quit|exit)\s*[.!]?\s*$/i;

export function isCancelIntent(text: string): boolean {
  const t = String(text || "").trim();
  if (!t || t.length > 80) return false;
  return CANCEL_RE.test(t);
}

function siteUrl(): string {
  const explicit = process.env.NISRIA_PUBLIC_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const v = process.env.VERCEL_URL;
  if (v) return `https://${v.replace(/\/$/, "")}`;
  return "https://command.nisria.co";
}

// Candidate notetaker endpoints, in priority order. MEETING_BOT_URLS is a
// comma-separated list (put a stable always-on node first, ephemeral tunnels
// after); MEETING_BOT_URL is the single-value fallback. De-duped, trailing-slash
// stripped. This is the "auto-find any active node" layer (KT #340): the
// dispatcher walks the list and uses the FIRST node that actually answers, so one
// dead tunnel or a node that went down (the operator's VPN dropping) no longer
// kills the notetaker — it moves to the next live node. A node is only dispatched
// to once a /api/health probe says it is up, so a 404/000 tunnel is skipped.
function meetingBotBases(): string[] {
  const list = (process.env.MEETING_BOT_URLS || process.env.MEETING_BOT_URL || "")
    .split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  return Array.from(new Set(list));
}

async function nodeHealthy(base: string): Promise<boolean> {
  // KT #346: the zanii-meetingbot engine serves GET /health (server.js), NOT
  // /api/health, and the digitalu.zanii.agency Vercel rewrite only forwards /health.
  // The first cut probed /api/health → 404 → every node read as dead → the failover
  // refused to dispatch at all. Probe /health (the real contract); fall back to
  // /api/health for any engine variant that uses the namespaced path.
  for (const p of ["/health", "/api/health"]) {
    try {
      const r = await fetch(`${base}${p}`, { method: "GET", signal: AbortSignal.timeout(5000) });
      if (r.ok) return true;
    } catch { /* try next path */ }
  }
  return false;
}

export async function dispatchMeetingBot(opts: {
  link: string;
  title?: string;
  scheduledAt?: string;
  displayName?: string;
}): Promise<{ ok: boolean; mode?: string; eventId?: string; botId?: string; error?: string; node?: string }> {
  const bases = meetingBotBases();
  const key = process.env.MEETING_BOT_API_KEY;
  if (!bases.length || !key) return { ok: false, error: "MEETING_BOT_URL(S) or MEETING_BOT_API_KEY not configured" };
  const ingestKey = process.env.INGEST_KEY;
  const callbackUrl = `${siteUrl()}/api/digital-u/ingest`;
  const payload = JSON.stringify({
    link: opts.link,
    title: opts.title || "",
    scheduledAt: opts.scheduledAt || undefined,
    callbackUrl,
    callbackKey: ingestKey || undefined,
    displayName: opts.displayName || "Digital Nur",
  });
  // Walk the nodes; the first HEALTHY one that accepts the dispatch wins. We only
  // POST to a node that passed its health probe, so a dead/404 tunnel is never
  // dispatched into, and we never fire two notetakers (we stop at first success).
  let lastErr = "no notetaker node is reachable right now";
  for (const base of bases) {
    if (!(await nodeHealthy(base))) { lastErr = `node ${base.replace(/^https?:\/\//, "").slice(0, 40)} is not responding`; continue; }
    try {
      const r = await fetch(`${base}/api/dispatch`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key },
        body: payload,
        signal: AbortSignal.timeout(20000),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { lastErr = body?.error || `${r.status} ${r.statusText}`; continue; }
      return { ok: true, mode: body?.mode, eventId: body?.eventId, botId: body?.botId, node: base };
    } catch (e: any) { lastErr = e?.message || String(e); continue; }
  }
  return { ok: false, error: lastErr };
}

export async function cancelActiveBot(): Promise<{ ok: boolean; title?: string; botId?: string; error?: string }> {
  const base = (process.env.MEETING_BOT_URL || "").replace(/\/$/, "");
  const key = process.env.MEETING_BOT_API_KEY;
  if (!base || !key) return { ok: false, error: "MEETING_BOT_URL or MEETING_BOT_API_KEY not configured" };
  try {
    const r = await fetch(`${base}/api/dispatch/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({}),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: body?.error || `${r.status} ${r.statusText}` };
    return { ok: true, title: body?.title, botId: body?.botId };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
