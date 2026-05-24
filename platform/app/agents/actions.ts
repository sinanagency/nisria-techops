"use server";
import { admin } from "../../lib/supabase-admin";
import { emit } from "../../lib/events";
import { revalidatePath } from "next/cache";

export async function setLane(fd: FormData) {
  const scope = String(fd.get("scope"));
  const lane = String(fd.get("lane"));
  await admin().from("autonomy_rules").update({ lane, updated_by: "Nur", updated_at: new Date().toISOString() }).eq("scope", scope);
  await emit({ type: "autonomy.changed", source: "nur", actor: "Nur", payload: { scope, lane } });
  revalidatePath("/agents");
}

export async function toggleConnector(fd: FormData) {
  const key = String(fd.get("key"));
  const enabled = String(fd.get("enabled")) === "true";
  await admin().from("connector_registry").update({ enabled: !enabled }).eq("key", key);
  await emit({ type: "connector.toggled", source: "nur", actor: "Nur", payload: { key, enabled: !enabled } });
  revalidatePath("/agents");
}
