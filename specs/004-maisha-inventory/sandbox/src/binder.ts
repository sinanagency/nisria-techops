// Resolve incoming CONTEXT to the pending image it belongs to. Three modes:
//   1) quoted/swipe-reply  → bind via reply_to_external_id (deterministic)
//   2) caption-on-image    → handled at persist time (not here)
//   3) loose follow-up     → same sender + most-recent unenriched pending image
//                            in the same group within a time window; ambiguous
//                            (≥2 candidates) → ask once, never guess.
import { DB, one, q } from "./db.ts";

const FOLLOWUP_WINDOW_MS = 15 * 60 * 1000; // 15 min

export type BindResult =
  | { mode: "reply" | "followup"; inventoryId: string }
  | { mode: "none"; reason: string }
  | { mode: "ambiguous"; candidates: string[]; reason: string };

export async function bindContext(db: DB, ctx: {
  group: string; sender: string; text: string; replyToExternalId?: string | null; atIso: string;
}): Promise<BindResult> {
  // Mode 1: quoted reply — bind to the exact quoted message's pending record.
  if (ctx.replyToExternalId) {
    const row = await one<any>(
      db,
      `SELECT pe.inventory_id FROM messages m
       JOIN pending_enrichment pe ON pe.message_external_id = m.external_id
       WHERE m.external_id = $1 AND pe.status IN ('pending','nudged')`,
      [ctx.replyToExternalId]
    );
    if (row?.inventory_id) return { mode: "reply", inventoryId: row.inventory_id };
    // quoted an image we don't have a pending record for → fall through to none
    return { mode: "none", reason: `quoted ${ctx.replyToExternalId} but no pending record` };
  }

  // Mode 3: loose follow-up — most-recent pending image by THIS sender in THIS
  // group inside the window.
  const cutoff = new Date(Date.parse(ctx.atIso) - FOLLOWUP_WINDOW_MS).toISOString();
  const candidates = await q<any>(
    db,
    `SELECT pe.inventory_id, pe.created_at
     FROM pending_enrichment pe
     WHERE pe.group_name = $1 AND pe.sender_phone = $2 AND pe.status = 'pending'
       AND pe.created_at >= $3
     ORDER BY pe.created_at DESC`,
    [ctx.group, ctx.sender, cutoff]
  );
  if (candidates.length === 0) return { mode: "none", reason: "no recent pending image from this sender" };
  if (candidates.length === 1) return { mode: "followup", inventoryId: candidates[0].inventory_id };

  // Multiple pending images from the same sender → ambiguous. Ask once.
  // (Exception: if the text names a tracking# we can still disambiguate, but the
  // safe default is to confirm.)
  return {
    mode: "ambiguous",
    candidates: candidates.map((c) => c.inventory_id),
    reason: `${candidates.length} pending photos from this sender — which one?`,
  };
}
