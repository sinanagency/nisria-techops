"use server";
import { admin } from "../../lib/supabase-admin";
import { claudeJSON } from "../../lib/anthropic";
import { emit } from "../../lib/events";
import { revalidatePath } from "next/cache";

// Add an inventory item with the real schema columns. The free-text "story"
// is NOT persisted on the item (inventory has no notes column) — it's only
// used at generation time and lives on in the generated Folklore listing.
export async function addItem(fd: FormData) {
  const name = String(fd.get("name") || "").trim();
  if (!name) return;
  const collection = String(fd.get("collection") || "").trim() || null;
  const category = String(fd.get("category") || "").trim() || null;
  const quantity = Number(fd.get("quantity") || 0) || 0;
  const unit_price = fd.get("unit_price") ? Number(fd.get("unit_price")) : null;

  await admin().from("inventory").insert({
    name,
    collection,
    category,
    quantity,
    unit_price,
    status: "in_stock",
    folklore_listed: false,
  });

  await emit({
    type: "inventory.item_added",
    source: "inventory",
    actor: "Nur",
    payload: { name, collection, category },
  });
  revalidatePath("/inventory");
}

// Generate a The-Folklore-marketplace listing for an item in Maisha's voice,
// then save the copy to the Library (assets) and mark the item as listed.
export async function generateListing(fd: FormData) {
  const id = String(fd.get("id"));
  if (!id) return;
  const story = String(fd.get("story") || "").trim();
  const db = admin();

  const { data: item } = await db.from("inventory").select("*").eq("id", id).single();
  if (!item) return;

  const draft = await claudeJSON<{ title: string; description: string; tags: string[] }>(
    `You are the brand copywriter for Maisha, the handmade-goods sister brand of Nisria Inc (a US/Florida nonprofit helping children and families in Kenya). You write product listings for The Folklore — a curated marketplace for African and diaspora brands. Voice: warm, dignified, culturally rooted, never poverty-porn or charity-pity. Celebrate the craft and the maker. Return a JSON object with: "title" (a refined product title), "description" (2-3 short evocative paragraphs covering the piece, its making, materials and the maker community, ending with a soft note that purchases support Nisria's work in Kenya), and "tags" (an array of 5-8 lowercase marketplace keywords).`,
    `Product: ${item.name}
Collection: ${item.collection || "—"}
Category: ${item.category || "—"}
Price: ${item.unit_price ? `$${item.unit_price}` : "—"}${story ? `\nMaker story / notes: ${story}` : ""}`,
    900
  );

  if (!draft || !draft.description) {
    await emit({
      type: "inventory.listing_failed",
      source: "inventory",
      actor: "AI",
      subject_type: "inventory",
      subject_id: id,
      payload: { name: item.name },
    });
    return;
  }

  const tags = Array.isArray(draft.tags) ? draft.tags : [];
  const fullCopy = `${draft.title || item.name}\n\n${draft.description}${
    tags.length ? `\n\nTags: ${tags.join(", ")}` : ""
  }${story ? `\n\n— maker story —\n${story}` : ""}`;

  // Save the generated copy into the Library so the agents + Nur can reuse it.
  const { data: asset } = await db
    .from("assets")
    .insert({
      brand: "maisha",
      type: "document",
      title: `Folklore listing — ${item.name}`,
      description: fullCopy,
      tags,
      source: "inventory",
      created_by: "AI",
    })
    .select()
    .single();

  // Mark the item as listed. (folklore_url is left for the human to paste once
  // the listing is live on The Folklore.) Stock status is left untouched —
  // listing a piece does not change whether it is in_stock; folklore_listed
  // is the listing flag. Writing status:'active' previously violated the
  // inventory_status_check constraint (in_stock|low|out|archived) and threw.
  await db.from("inventory").update({ folklore_listed: true }).eq("id", id);

  await emit({
    type: "inventory.listing_generated",
    source: "inventory",
    actor: "AI",
    subject_type: "inventory",
    subject_id: id,
    payload: { name: item.name, asset_id: asset?.id, title: draft.title },
  });
  revalidatePath("/inventory");
}
