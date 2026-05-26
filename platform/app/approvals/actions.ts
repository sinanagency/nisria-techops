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
