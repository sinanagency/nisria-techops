// Calm-by-exception filter for the events table (NISRIA-DOCTRINE §11). The
// dashboard, workspace activity feed, and /agents stream all share the same
// events source. Health checks, internal pings, and unlabelled system noise
// MUST NOT crowd out human-relevant signal (donor reply, payment verified,
// task assigned, grant moved stage).
//
// Maintain the deny-list here so all three surfaces stay consistent. Anything
// not on the list is human-visible.
const NOISY_TYPES = new Set<string>([
  "bot.health_check",
  "bot:health_check",
  "group_bot_health_check",
  "system.incident_alert",
  "system_incident_alert",
  "vt.ping",
  "vt_ping",
  "vt_*",
  "agent.tick.ok",
  "agent.tick.noop",
  "heartbeat",
]);

// also drop any event whose type matches an obvious noise prefix
const NOISY_PREFIXES = ["bot.health", "system.incident", "agent.tick", "vt_", "vt.", "v1_", "v1."];

// substring match for the messy types that combine words inconsistently
// (e.g. "group_bot_health_check", "groupbot.health", "whatsapp_health_ping").
const NOISY_SUBSTRINGS = ["health_check", "healthcheck", "heartbeat", "_ping", ".ping", "incident_alert"];

function isNoisy(type: string): boolean {
  if (!type) return true; // unlabelled events are noise by default
  if (NOISY_TYPES.has(type)) return true;
  const t = type.toLowerCase();
  for (const p of NOISY_PREFIXES) if (t.startsWith(p)) return true;
  for (const s of NOISY_SUBSTRINGS) if (t.includes(s)) return true;
  return false;
}

export function filterHumanEvents<T extends { type: string }>(events: T[] | null | undefined): T[] {
  if (!events) return [];
  return events.filter((e) => !isNoisy(e.type));
}
