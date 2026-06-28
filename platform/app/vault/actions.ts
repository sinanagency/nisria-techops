"use server";
import { revalidatePath } from "next/cache";
import { admin } from "../../lib/supabase-admin";
import { getCurrentUser } from "../../lib/auth";
import { remember } from "../../lib/memory";
import { emit } from "../../lib/events";
import { sealSecret, openSecret } from "../../lib/vault";

// The /vault surface is FOUNDER-ONLY. Every action below re-checks the role on
// the server (defence in depth — the page is gated too, but a stale form post
// from a non-founder session must never write or read a secret). This mirrors
// the founder gate on app/inventory/page.tsx (user?.role === "founder") and the
// MASTER-tier gate on the get_credential smart-tool.
function isFounder(): boolean {
  return getCurrentUser()?.role === "founder";
}

// ---- add a credential (founder-only; password sealed before it touches the DB) ----
export async function addCredential(fd: FormData): Promise<void> {
  // GATE: founder only. Silently no-op for anyone else (never write a secret).
  if (!isFounder()) return;

  const title = String(fd.get("title") || "").trim();
  if (!title) return;
  const url = String(fd.get("url") || "").trim() || null;
  const username = String(fd.get("username") || "").trim() || null;
  const notes = String(fd.get("notes") || "").trim() || null;
  const brandRaw = String(fd.get("brand") || "").trim();
  const brand = ["nisria", "maisha", "ahadi"].includes(brandRaw) ? brandRaw : null;
  const password = String(fd.get("password") || "");

  // Reuse the EXACT storage shape save_vault_resource / addResource use: a row in
  // `resources` with is_credential=true and, when a password is given, the
  // AES-256-GCM sealed triple. The plaintext never lands in the table.
  const row: Record<string, any> = {
    title, url, username, notes, brand,
    category: "account",
    tags: [] as string[],
    is_credential: true,
    source_type: "dashboard",
    created_by: "Nur",
  };
  if (password) {
    const sealed = sealSecret(password);
    row.secret_ciphertext = sealed.ciphertext;
    row.secret_iv = sealed.iv;
    row.secret_tag = sealed.tag;
  }

  const { data: res, error } = await admin().from("resources").insert(row).select("id").single();
  if (error || !res) return; // fail soft (table may be pre-migration); no crash

  // Mirror only the non-sensitive metadata into the brain — NEVER the password.
  await remember({
    kind: "resource", brand, title,
    content: `Credential: ${title}${url ? ` — ${url}` : ""} (login${username ? `, user ${username}` : ""}; password in the vault).`,
    source_type: "resource", source_id: res.id,
  });
  await emit({
    type: "resource.added", source: "dashboard", actor: "Nur",
    subject_type: "resource", subject_id: res.id,
    payload: { title, category: "account", brand, is_credential: true, via: "vault" },
  });
  // never echo the password back, even though we just stored it
  revalidatePath("/vault");
}

// ---- delete a credential (founder-only) ----
export async function deleteCredential(fd: FormData): Promise<void> {
  if (!isFounder()) return;
  const id = String(fd.get("id") || "");
  if (!id) return;
  await admin().from("resources").delete().eq("id", id).eq("is_credential", true);
  revalidatePath("/vault");
}

// ---- reveal a stored password (founder-only; decrypts SERVER-SIDE) ----
// The client calls this with the row id only. The ciphertext/iv/tag and the key
// never leave the server: the row is read here, openSecret runs here, and only
// the plaintext is returned — to this authenticated founder session alone.
export async function revealCredential(id: string): Promise<{ secret?: string; error?: string }> {
  // GATE: founder only. A non-founder gets "denied" and no DB read happens.
  if (!isFounder()) return { error: "denied" };
  if (!id) return { error: "no id" };
  const { data } = await admin()
    .from("resources")
    .select("secret_ciphertext,secret_iv,secret_tag,title")
    .eq("id", id)
    .eq("is_credential", true)
    .single();
  if (!data?.secret_ciphertext) return { error: "no secret" };
  try {
    const secret = openSecret({
      ciphertext: data.secret_ciphertext,
      iv: data.secret_iv,
      tag: data.secret_tag,
    });
    await emit({
      type: "resource.secret_revealed", source: "dashboard", actor: "Nur",
      subject_type: "resource", subject_id: id, payload: { via: "vault", title: data.title },
    });
    return { secret };
  } catch {
    return { error: "could not decrypt" };
  }
}
