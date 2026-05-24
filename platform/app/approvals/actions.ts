"use server";
import { approveApproval, rejectApproval } from "../../lib/gateway";
import { revalidatePath } from "next/cache";

// One server action for the Needs You queue: approve (optionally edited) or reject.
export async function decideApproval(fd: FormData) {
  const id = String(fd.get("id"));
  const decision = String(fd.get("decision") || "approve");
  if (decision === "reject") {
    await rejectApproval(id, { decidedBy: "Nur", note: String(fd.get("note") || "") || undefined });
  } else {
    const subject = String(fd.get("subject") || "");
    const body = String(fd.get("body") || "");
    await approveApproval(id, { edited: { subject, body }, decidedBy: "Nur" });
  }
  revalidatePath("/");
  revalidatePath("/inbox");
}
