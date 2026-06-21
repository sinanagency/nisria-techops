// Simulated group ingest — replaces /api/group/ingest. Mirrors the LIVE order of
// operations the audit documented, including the critical property: CAPTURE runs
// fully UPSTREAM of the listen-only reply suppression. So in silent mode the store
// + brain still run; only the in-group reply is withheld.
//
// A GroupMessage is what the Baileys userbot would POST. The harness drives these.
import { DB, now as clockNow } from "./db.ts";
import { bindContext } from "./binder.ts";
import { persistPendingImage, enrichRecord, transitionState } from "./tools.ts";
import { honestyRewrite, groundingFor } from "./guard.ts";

export type GroupMessage = {
  externalId: string;
  group: string;
  sender: string;
  senderName?: string;
  role?: "admin" | "team" | "customer";
  text?: string | null;
  replyToExternalId?: string | null;
  image?: { wamid: string; mediaPath: string; mime?: string } | null;
  isSystem?: boolean; // "security code changed", "X joined", ...
};

// Read-side SYSTEM filter, moved to ingest as an intent gate (audit gap #6).
const SYSTEM = /(security code (with .+ )?changed|Messages and calls are end-to-end encrypted|created (this )?group|joined using|left|was added|was removed|changed the (subject|group))/i;

export type IngestOutcome = {
  externalId: string;
  captured: boolean;       // did we store/persist anything
  reply: string;           // what Sasa WOULD say
  spoken: boolean;         // did it actually go to the group (false under listen-only)
  action?: string;         // tool summary
  needs?: string;          // an "ask once" prompt
};

export type IngestEnv = { listenOnly: boolean };

export async function ingest(db: DB, msg: GroupMessage, env: IngestEnv): Promise<IngestOutcome> {
  const out: IngestOutcome = { externalId: msg.externalId, captured: false, reply: "", spoken: false };

  // 0. intent gate: never treat a system line as an intake.
  if (msg.isSystem || (msg.text && SYSTEM.test(msg.text))) {
    return out; // stored elsewhere in prod, but no capture, no reply
  }

  let toolName = "";
  let toolOk = false;
  let rowExists = false;
  let claim = "";

  // 1. image arrival → persist pending (mode 2 caption handled inside)
  if (msg.image) {
    const r = await persistPendingImage(db, {
      externalId: msg.externalId, wamid: msg.image.wamid, group: msg.group,
      sender: msg.sender, senderName: msg.senderName, role: msg.role ?? "team",
      mediaPath: msg.image.mediaPath, mime: msg.image.mime, caption: msg.text ?? null,
    });
    out.captured = true;
    out.action = r.summary;
    toolName = "persist_pending_image"; toolOk = r.ok; rowExists = !!r.detail?.inventory_id || !!r.detail?.deduped;
    claim = r.detail?.pending ? "Logged the photo, send me the details when ready." : `Logged: ${r.summary}.`;
  }
  // 2. text-only → it's context for a prior image (reply or follow-up) OR a query
  else if (msg.text && msg.text.trim()) {
    const bind = await bindContext(db, {
      group: msg.group, sender: msg.sender, text: msg.text,
      replyToExternalId: msg.replyToExternalId, atIso: clockNow(),
    });
    if (bind.mode === "reply" || bind.mode === "followup") {
      const r = await enrichRecord(db, { inventoryId: bind.inventoryId, text: msg.text, sourceExternalId: msg.externalId, by: msg.senderName });
      out.captured = true;
      out.action = r.summary;
      out.needs = r.needs;
      toolName = "classify_and_enrich"; toolOk = r.ok; rowExists = r.ok && !!r.detail?.inventory_id;
      claim = r.ok ? `Done — ${r.summary} (via ${bind.mode}).` : (r.needs ?? "I need a bit more detail.");
    } else if (bind.mode === "ambiguous") {
      out.needs = bind.reason;
      claim = bind.reason;
    } else {
      // no binding → treat as a query/no-op in the sandbox
      out.reply = "";
      return out;
    }
  } else {
    return out;
  }

  // 3. honesty guard: a claim word only stands if a registered completion tool
  //    actually persisted a row.
  const guarded = honestyRewrite({ toolName, toolOk, rowExists, claim });
  out.reply = guarded.reply;

  // 4. LISTEN-ONLY chokepoint — consulted ONLY here, after capture+brain.
  if (env.listenOnly) {
    out.spoken = false; // captured silently
  } else {
    out.spoken = true;  // chime-in enabled
  }
  return out;
}
