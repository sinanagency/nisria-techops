// CASE PHOTO LINKING (cases-intake groups, e.g. Rescue & Rehab).
//
// In a cases group, the photos and the case description arrive as SEPARATE
// messages, in either order (drop 5 photos, then type the names; or vice versa).
// So linking is BIDIRECTIONAL over a time window: a case-group photo is stored
// tagged 'case-intake' + the group, with source_ref='group-case-pending' until it
// is claimed. Whichever lands second does the join:
//   - a photo arriving -> attach to the most recent open case from that group;
//   - a case being created -> sweep up the recent pending photos from that group.
// A claimed photo's source_ref becomes 'ben:<caseId>', which both marks it linked
// (so it is not double-claimed) and ties it to the case. The case's primary photo
// (photo_asset_id) is set from the first photo so it renders on /cases; the rest
// stay tagged 'ben:<caseId>' for the gallery.

const WINDOW_MS = 30 * 60 * 1000;     // case sweeps up photos dropped up to 30 min before it
const BACK_ATTACH_MS = 3 * 60 * 1000; // a photo only joins a PRIOR case if it is very fresh

const groupTag = (group: string) => `group:${String(group || "").trim().toLowerCase()}`;

// Find a still-open case (under_review) from this group created in the last few
// MINUTES. Deliberately short: the dominant pattern is photos-first then the name,
// so a photo should WAIT (stay pending) for the case that follows, not glom onto a
// previous child's case. We only back-attach when a case was just created (someone
// adding a photo right after typing it). Returns { id, photo_asset_id } or null.
async function recentOpenCase(db: any, group: string): Promise<{ id: string; photo_asset_id: string | null } | null> {
  const since = new Date(Date.now() - BACK_ATTACH_MS).toISOString();
  const { data } = await db
    .from("beneficiaries")
    .select("id,photo_asset_id,created_at")
    .eq("case_channel", `group:${group}`)
    .eq("intake_stage", "under_review")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0] ? { id: data[0].id, photo_asset_id: data[0].photo_asset_id } : null;
}

// Store ONE photo dropped in a cases group: upload bytes, create the asset tagged
// for case intake, and attach it to a recent open case if one exists (else leave
// it pending for the case that follows). Returns the asset id.
export async function storeCaseGroupPhoto(
  db: any,
  buf: Buffer,
  mime: string,
  group: string,
  senderName: string | null,
  contactId: string | null,
): Promise<{ id: string | null; path: string } | null> {
  const path = `case-intake/${group.toLowerCase().replace(/[^\w]+/g, "-")}/${Date.now().toString(36)}-${Math.abs(buf.length)}.jpg`;
  try {
    await db.storage.from("assets").upload(path, buf, { contentType: mime, upsert: true });
  } catch { return null; }
  const open = await recentOpenCase(db, group);
  const { data: asset } = await db
    .from("assets")
    .insert({
      type: "image", mime, storage_path: path, size_bytes: buf.length,
      source: "whatsapp", source_ref: open ? `ben:${open.id}` : "group-case-pending",
      tags: ["case-intake", groupTag(group)], consent_required: true, consent_on_file: false,
      created_by: senderName || "group-bot", title: "Case photo (intake)",
    })
    .select("id")
    .single();
  // If a case is already open and has no primary photo yet, make this it.
  if (open && asset?.id && !open.photo_asset_id) {
    await db.from("beneficiaries").update({ photo_asset_id: asset.id }).eq("id", open.id);
  }
  return { id: asset?.id ?? null, path };
}

// On case creation: claim the recent PENDING case photos from this group, link
// them to the case, and set the case's primary photo from the first. Returns the
// number of photos attached.
export async function attachPendingCasePhotos(db: any, caseId: string, group: string): Promise<number> {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const { data: pending } = await db
    .from("assets")
    .select("id")
    .eq("source_ref", "group-case-pending")
    .contains("tags", [groupTag(group)])
    .gte("created_at", since)
    .order("created_at", { ascending: true });
  const ids = (pending || []).map((a: any) => a.id);
  if (!ids.length) return 0;
  await db.from("assets").update({ source_ref: `ben:${caseId}` }).in("id", ids);
  // Primary photo = the first dropped, if the case has none yet.
  const { data: cur } = await db.from("beneficiaries").select("photo_asset_id").eq("id", caseId).single();
  if (!cur?.photo_asset_id) {
    await db.from("beneficiaries").update({ photo_asset_id: ids[0] }).eq("id", caseId);
  }
  return ids.length;
}
