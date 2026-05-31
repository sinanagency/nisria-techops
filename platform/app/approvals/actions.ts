"use server";
import { approveApproval, rejectApproval } from "../../lib/gateway";
import { stripDashes } from "../../lib/humanize";
import { revalidatePath } from "next/cache";

// One server action for the Needs You queue: approve (optionally edited) or reject.
export async function decideApproval(fd: FormData) {
  const id = String(fd.get("id"));
  const decision = String(fd.get("decision") || "approve");
  if (decision === "reject") {
    await rejectApproval(id, { decidedBy: "Nur", note: String(fd.get("note") || "") || undefined });
  } else {
    // Only treat subject/body as edits when the form actually carried them (the
    // expanded editor). The COMPACT card approve has no subject/body fields, so
    // we must NOT pass empty strings: that would overwrite the stored draft with
    // blanks. Dash-clean any real edit; the send chokepoint cleans again anyway.
    const edited: Record<string, any> = {};
    if (fd.has("subject")) edited.subject = stripDashes(String(fd.get("subject") || ""));
    if (fd.has("body")) edited.body = stripDashes(String(fd.get("body") || ""));
    // attach_refs (a Studio doc / Library asset to include) is optional; when
    // present it flows through the intent params to the send connector.
    const attach_refs = String(fd.get("attach_refs") || "") || null;
    if (attach_refs) edited.attach_refs = attach_refs;
    await approveApproval(id, { edited: Object.keys(edited).length ? edited : undefined, decidedBy: "Nur" });
  }
  revalidatePath("/");
  revalidatePath("/inbox");
}

// useFormState-shaped sibling of decideApproval used by <ActionForm>. Returns
// the REAL outcome so the toast confirms what actually happened (Law 6 +
// honesty law): a send failure surfaces the connector error, never a fake
// "sent". No revalidatePath here — ActionForm calls router.refresh() on success
// AFTER the toast is queued, so the confirmation can't be lost when the card
// clears. An optional confirm_label (e.g. the recipient) personalises the toast.
export type DecideResult = { ok: boolean; message: string; ts: number };

export async function decideApprovalAction(
  _prev: DecideResult | null,
  fd: FormData,
): Promise<DecideResult> {
  const ts = Date.now();
  const label = String(fd.get("confirm_label") || "").trim();
  try {
    const id = String(fd.get("id"));
    const decision = String(fd.get("decision") || "approve");

    if (decision === "reject") {
      await rejectApproval(id, { decidedBy: "Nur", note: String(fd.get("note") || "") || undefined });
      return { ok: true, message: label ? `Declined reply to ${label}.` : "Draft declined.", ts };
    }

    const edited: Record<string, any> = {};
    if (fd.has("subject")) edited.subject = stripDashes(String(fd.get("subject") || ""));
    if (fd.has("body")) edited.body = stripDashes(String(fd.get("body") || ""));
    const attach_refs = String(fd.get("attach_refs") || "") || null;
    if (attach_refs) edited.attach_refs = attach_refs;

    const res: any = await approveApproval(id, {
      edited: Object.keys(edited).length ? edited : undefined,
      decidedBy: "Nur",
    });

    // executeIntent (via approveApproval) returns { ok:false, error } when the
    // connector fails. Surface it instead of claiming success.
    if (res && res.ok === false) {
      return { ok: false, message: `Couldn't send: ${res.error || "the action failed"}.`, ts };
    }
    if (res && res.already) {
      return { ok: true, message: "Already handled.", ts };
    }
    return { ok: true, message: label ? `Sent to ${label}.` : "Approved and sent.", ts };
  } catch (e: any) {
    return { ok: false, message: e?.message ? `Couldn't complete: ${e.message}.` : "Something went wrong.", ts };
  }
}
