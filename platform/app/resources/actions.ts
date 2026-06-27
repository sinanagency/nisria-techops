"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { admin } from "../../lib/supabase-admin";
import { remember } from "../../lib/memory";
import { emit } from "../../lib/events";
import {
  VAULT_COOKIE, checkVaultPassword, mintVaultCookie, isVaultUnlocked,
  sealSecret, openSecret, vaultConfigured,
} from "../../lib/vault";

// ---- vault gate ----
export async function unlockVault(_prev: unknown, fd: FormData): Promise<{ error?: string }> {
  if (!vaultConfigured()) return { error: "Vault isn't set up yet. Ask Taona to add the vault password." };
  const pw = String(fd.get("password") || "");
  if (!checkVaultPassword(pw)) return { error: "Wrong vault password." };
  const { value, maxAge } = mintVaultCookie();
  cookies().set(VAULT_COOKIE, value, { httpOnly: true, secure: true, sameSite: "lax", path: "/resources", maxAge });
  // reload the route server-side so it re-reads the cookie and renders unlocked
  redirect("/resources");
}

export async function lockVault() {
  // clear with the SAME path the cookie was set on, or the delete won't match
  cookies().set(VAULT_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/resources", maxAge: 0 });
  redirect("/resources");
}

function unlocked(): boolean {
  return isVaultUnlocked(cookies().get(VAULT_COOKIE)?.value);
}

// ---- add a resource (link, platform, supplier, or a credential) ----
export async function addResource(fd: FormData) {
  // writing a credential requires an unlocked vault (defence in depth — the page
  // is already gated, but a stale form post shouldn't be able to write a secret).
  const isCred = String(fd.get("is_credential") || "") === "on";
  const password = String(fd.get("password") || "");
  if ((isCred || password) && !unlocked()) return;

  const title = String(fd.get("title") || "").trim();
  if (!title) return;
  const brandRaw = String(fd.get("brand") || "").trim();
  const brand = ["nisria", "maisha", "ahadi"].includes(brandRaw) ? brandRaw : null;
  const category = String(fd.get("category") || "link").trim() || "link";
  const url = String(fd.get("url") || "").trim() || null;
  const username = String(fd.get("username") || "").trim() || null;
  const notes = String(fd.get("notes") || "").trim() || null;
  const tags = String(fd.get("tags") || "")
    .split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);

  const row: Record<string, any> = {
    title, url, brand, category, tags, notes, username,
    is_credential: isCred || !!password,
    source_type: "dashboard", created_by: "Nur",
  };
  if (password) {
    const sealed = sealSecret(password);
    row.secret_ciphertext = sealed.ciphertext;
    row.secret_iv = sealed.iv;
    row.secret_tag = sealed.tag;
  }

  const { data: res, error } = await admin().from("resources").insert(row).select("id").single();
  if (error || !res) return; // table may not exist pre-migration; fail soft, no crash

  // mirror into the brain so Sasa can cite the link when drafting — NEVER the
  // secret. Only the non-sensitive metadata is remembered.
  await remember({
    kind: "resource", brand, title,
    content: `Resource: ${title}${url ? ` — ${url}` : ""}${notes ? `. ${notes}` : ""} (category: ${category}${isCred ? ", credential — password in the vault" : ""}).`,
    source_type: "resource", source_id: res.id,
  });
  await emit({ type: "resource.added", source: "dashboard", actor: "Nur", subject_type: "resource", subject_id: res.id, payload: { title, category, brand, is_credential: row.is_credential } });
  revalidatePath("/resources");
}

export async function deleteResource(fd: FormData) {
  if (!unlocked()) return;
  const id = String(fd.get("id") || "");
  if (!id) return;
  await admin().from("resources").delete().eq("id", id);
  revalidatePath("/resources");
}

// ---- reveal a stored secret (server-side decrypt; requires unlocked vault) ----
export async function revealSecret(id: string): Promise<{ secret?: string; error?: string }> {
  if (!unlocked()) return { error: "locked" };
  const { data } = await admin().from("resources").select("secret_ciphertext,secret_iv,secret_tag").eq("id", id).single();
  if (!data?.secret_ciphertext) return { error: "no secret" };
  try {
    const secret = openSecret({ ciphertext: data.secret_ciphertext, iv: data.secret_iv, tag: data.secret_tag });
    await emit({ type: "resource.secret_revealed", source: "dashboard", actor: "Nur", subject_type: "resource", subject_id: id, payload: {} });
    return { secret };
  } catch {
    return { error: "could not decrypt" };
  }
}
