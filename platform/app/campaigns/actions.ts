"use server";
// Create / edit a campaign by hand (img 210: "campaigns has no way to add info").
// Givebutter-synced campaigns carry a givebutter_id; ones created here do not, so
// a future sync never clobbers a hand-made campaign. Figures the founder types are
// her own; nothing is invented.
import { admin } from "../../lib/supabase-admin";
import { emit } from "../../lib/events";
import { revalidatePath } from "next/cache";

const TYPES = new Set(["seasonal", "annual", "emergency", "general", "appeal"]);
const STATUSES = new Set(["live", "draft", "ended", "planned"]);

function clean(fd: FormData) {
  const num = (k: string) => {
    const v = String(fd.get(k) || "").replace(/[^0-9.]/g, "");
    return v ? Number(v) : null;
  };
  const str = (k: string) => String(fd.get(k) || "").trim();
  const type = str("type").toLowerCase();
  const status = str("status").toLowerCase();
  return {
    name: str("name"),
    type: TYPES.has(type) ? type : "general",
    status: STATUSES.has(status) ? status : "draft",
    goal_amount: num("goal_amount"),
    raised_amount: num("raised_amount"),
    starts_on: str("starts_on") || null,
    ends_on: str("ends_on") || null,
  };
}

export async function saveCampaign(fd: FormData) {
  const id = String(fd.get("id") || "").trim();
  const row = clean(fd);
  if (!row.name) return; // a campaign needs a name; the UI guards this too
  const db = admin();
  if (id) {
    await db.from("campaigns").update({ ...row, updated_at: new Date().toISOString() }).eq("id", id);
    await emit({ type: "campaign.updated", source: "campaigns", actor: "Nur", subject_type: "campaign", subject_id: id, payload: { name: row.name } });
  } else {
    const { data } = await db.from("campaigns").insert(row).select("id").single();
    await emit({ type: "campaign.created", source: "campaigns", actor: "Nur", subject_type: "campaign", subject_id: data?.id ?? null, payload: { name: row.name } });
  }
  revalidatePath("/campaigns");
  revalidatePath("/");
}
