"use server";
// Beneficiary writes. Service-role only (server actions), never a client path.
// PII stays server-side. The ONLY field that crosses into the public,
// donor-facing surface is via the consent_public flag -> public_beneficiary_profiles
// view, which the toggle below flips. Every write revalidates the affected pages
// and logs an event so it shows up in Mission Control.
import { admin } from "../../lib/supabase-admin";
import { emit } from "../../lib/events";
import { recall, groundingText, remember } from "../../lib/memory";
import { revalidatePath } from "next/cache";

// Publish / unpublish a beneficiary's PUBLIC donor-facing profile.
// consent_public=true exposes ONLY the consent-gated view fields (alias, program,
// sanitized story, public photo). The DB trigger stamps/clears consent_date.
export async function toggleConsent(fd: FormData) {
  const id = String(fd.get("id") || "");
  if (!id) return;
  const to = String(fd.get("to") || "").toLowerCase();
  const next = to === "on" ? true : to === "off" ? false : null;

  const db = admin();
  const { data: b } = await db
    .from("beneficiaries")
    .select("id,consent_public,public_name,ref_code")
    .eq("id", id)
    .single();
  if (!b) return;

  const value = next === null ? !b.consent_public : next;

  await db
    .from("beneficiaries")
    .update({ consent_public: value, consent_date: value ? new Date().toISOString() : null })
    .eq("id", id);

  await emit({
    type: value ? "beneficiary.consent_granted" : "beneficiary.consent_withdrawn",
    source: "beneficiaries",
    actor: "Nur",
    subject_type: "beneficiary",
    subject_id: id,
    payload: { ref: b.ref_code || null, public: value },
  });

  revalidatePath("/beneficiaries");
  revalidatePath(`/beneficiaries/${id}`);
}

// ---------------------------------------------------------------------------
// AI BENEFICIARY INTAKE
// CRITICAL PII PATH. A child's data. Three inputs (photos / voice transcript /
// text) all resolve into ONE structured profile that Nur reviews and edits in a
// gated confirm modal before anything is written. Mirrors the finance AI intake
// shape exactly. Everything here runs server-side with the service role; the
// browser never touches the key or the DB. A new beneficiary ALWAYS lands with
// consent_public=false: nothing is donor-facing until Nur explicitly publishes
// via the existing toggle. The extraction is grounded with recall() so Claude
// knows the real program names.
// ---------------------------------------------------------------------------
const PROGRAMS = ["safe_house", "education", "rescue", "nutrition", "other"];
const GENDERS = ["female", "male", "other", "unknown"];

export type ExtractedBeneficiary = {
  full_name: string | null;     // PII — the child's real / working name or alias
  age: number | null;           // years, when stated as an age
  date_of_birth: string | null; // YYYY-MM-DD, only if an actual date was given
  gender: string | null;        // one of GENDERS or null
  program: string;              // one of PROGRAMS
  region: string | null;        // county / area, kept private
  guardian_status: string | null;
  story: string | null;         // private case-note narrative
  school_fees: string | null;   // free text re: fees / costs, if mentioned
  needs: string | null;         // current needs
  tags: string[];               // short keyword tags
};

export type BeneficiaryExtractResult = {
  ok: boolean;
  profile?: ExtractedBeneficiary;
  photo_path?: string | null;   // private assets-bucket path for an uploaded photo
  lowConfidence?: boolean;      // no name extracted -> needs a human check
  raw?: string | null;
  error?: string;
};

// Coerce a loose model object into a clean profile (never trust the LLM output).
function normalizeBeneficiary(parsed: any): ExtractedBeneficiary {
  let program = String(parsed?.program || "").toLowerCase().replace(/\s+/g, "_");
  if (!PROGRAMS.includes(program)) program = "other";

  let gender: string | null = String(parsed?.gender || "").toLowerCase() || null;
  if (gender && !GENDERS.includes(gender)) {
    if (gender.startsWith("f") || gender.startsWith("girl")) gender = "female";
    else if (gender.startsWith("m") || gender.startsWith("boy")) gender = "male";
    else gender = null;
  }

  const rawAge = parsed?.age;
  let age: number | null =
    rawAge === null || rawAge === undefined || rawAge === ""
      ? null
      : Math.round(Number(String(rawAge).replace(/[^0-9.]/g, ""))) || null;
  if (age !== null && (age < 0 || age > 130)) age = null;

  let date_of_birth: string | null = null;
  if (parsed?.date_of_birth) {
    const d = new Date(String(parsed.date_of_birth));
    if (!isNaN(d.getTime())) date_of_birth = d.toISOString().slice(0, 10);
  }

  const tags = Array.isArray(parsed?.tags)
    ? parsed.tags.map((t: any) => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 8)
    : [];

  const str = (v: any, max: number): string | null => {
    const s = v === null || v === undefined ? "" : String(v).trim();
    return s ? s.slice(0, max) : null;
  };

  return {
    full_name: str(parsed?.full_name ?? parsed?.alias ?? parsed?.name, 120),
    age,
    date_of_birth,
    gender,
    program,
    region: str(parsed?.region ?? parsed?.location, 120),
    guardian_status: str(parsed?.guardian_status ?? parsed?.guardian, 200),
    story: str(parsed?.story, 4000),
    school_fees: str(parsed?.school_fees, 300),
    needs: str(parsed?.needs, 600),
    tags,
  };
}

const PROFILE_SHAPE =
  'Respond with ONLY valid JSON, no prose, no code fences, in this exact shape: ' +
  '{"full_name": <string or null>, "age": <number or null>, "date_of_birth": "<YYYY-MM-DD or null>", ' +
  '"gender": "female"|"male"|"other"|"unknown"|null, "program": "safe_house"|"education"|"rescue"|"nutrition"|"other", ' +
  '"region": <string or null>, "guardian_status": <string or null>, "story": <a short, factual case-note narrative or null>, ' +
  '"school_fees": <string or null>, "needs": <string or null>, "tags": [<short keyword strings>]}. ' +
  "Use age (a number of years) OR date_of_birth, not both, and only when actually stated. Pick the single best program. " +
  "Do NOT invent facts, names, ages, or figures that were not given. If a field is unknown, use null.";

// Pull grounding once so Claude maps to the org's real programs/context.
async function intakeGrounding(seed: string): Promise<string> {
  try {
    const mem = await recall(seed.slice(0, 200), { kinds: ["org_fact", "brand_voice"] });
    return groundingText(mem);
  } catch {
    return "(no stored guidance yet)";
  }
}

// Vision: read one or more photos into a structured child profile. Photos may
// be ID cards, intake forms, a snapshot of the child, or handwritten notes.
async function visionExtractBeneficiary(
  images: { base64: string; mediaType: string }[],
  grounding: string,
): Promise<{ profile: ExtractedBeneficiary; raw: string } | null> {
  const KEY = process.env.ANTHROPIC_API_KEY || "";
  const content: any[] = images.map((im) => ({
    type: "image",
    source: { type: "base64", media_type: im.mediaType, data: im.base64 },
  }));
  content.push({
    type: "text",
    text:
      "These photos relate to a child entering a Kenyan nonprofit's care (an intake form, ID, a written note, or a photo of the child). " +
      "Read everything visible and build a single structured intake profile for the child.\n\n" +
      `The organisation's real programs and context:\n${grounding}\n\n` +
      PROFILE_SHAPE,
  });
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 700,
      messages: [{ role: "user", content }],
    }),
    cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "vision extract failed");
  const raw: string = j?.content?.[0]?.text ?? "";
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    return { profile: normalizeBeneficiary(JSON.parse(cleaned)), raw };
  } catch {
    return null;
  }
}

// Text: parse a spoken (transcript) or typed description into the same profile.
async function textExtractBeneficiary(
  text: string,
  grounding: string,
): Promise<{ profile: ExtractedBeneficiary; raw: string } | null> {
  const KEY = process.env.ANTHROPIC_API_KEY || "";
  const today = new Date().toISOString().slice(0, 10);
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 700,
      messages: [
        {
          role: "user",
          content:
            `A nonprofit founder is describing a child entering the program, by voice or typing. Today is ${today}. ` +
            `Turn her words into a single structured intake profile. Capture only what she actually says.\n\n` +
            `The organisation's real programs and context:\n${grounding}\n\n` +
            `Description:\n"""${text.slice(0, 4000)}"""\n\n` +
            PROFILE_SHAPE,
        },
      ],
    }),
    cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "text extract failed");
  const raw: string = j?.content?.[0]?.text ?? "";
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    return { profile: normalizeBeneficiary(JSON.parse(cleaned)), raw };
  } catch {
    return null;
  }
}

// ACTION: drop one or more photos -> upload privately -> vision-extract a draft
// child profile for one-tap (gated) confirm. Does NOT write a beneficiary yet.
// The FIRST image is kept as the candidate photo (path returned for confirm).
export async function extractBeneficiaryFromImages(fd: FormData): Promise<BeneficiaryExtractResult> {
  const files = fd.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { ok: false, error: "No photo received." };
  for (const f of files) {
    if (!f.type.startsWith("image/")) return { ok: false, error: "Please drop images only (JPG, PNG, photo)." };
  }

  const db = admin();
  // Upload each image to the PRIVATE assets bucket. Keep the first as the photo.
  let photo_path: string | null = null;
  const visionImages: { base64: string; mediaType: string }[] = [];
  for (let i = 0; i < files.length && i < 4; i++) {
    const file = files[i];
    const buf = Buffer.from(await file.arrayBuffer());
    const mime = file.type || "image/jpeg";
    const safe = file.name.replace(/[^a-z0-9._-]/gi, "_");
    const path = `beneficiaries/${Date.now()}-${i}-${safe}`;
    const { error: upErr } = await db.storage.from("assets").upload(path, buf, { contentType: mime, upsert: false });
    if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` };
    if (i === 0) photo_path = path;
    if (buf.length < 4_500_000) visionImages.push({ base64: buf.toString("base64"), mediaType: mime });
  }

  if (!visionImages.length) {
    // images too large for the vision API — keep them, return an empty draft
    return { ok: true, photo_path, lowConfidence: true, profile: normalizeBeneficiary({}), raw: null };
  }

  const grounding = await intakeGrounding("beneficiary child intake program");
  let out: { profile: ExtractedBeneficiary; raw: string } | null = null;
  try {
    out = await visionExtractBeneficiary(visionImages, grounding);
  } catch (e: any) {
    return { ok: true, photo_path, lowConfidence: true, profile: normalizeBeneficiary({}), error: e?.message || null, raw: null };
  }
  if (!out) return { ok: true, photo_path, lowConfidence: true, profile: normalizeBeneficiary({}), raw: null };

  return { ok: true, photo_path, lowConfidence: !out.profile.full_name, profile: out.profile, raw: out.raw };
}

// ACTION: spoken (transcript) or typed description -> structured profile draft.
export async function extractBeneficiaryFromText(text: string): Promise<BeneficiaryExtractResult> {
  const t = (text || "").trim();
  if (!t) return { ok: false, error: "Tell me about the child." };
  const grounding = await intakeGrounding(t);
  let out: { profile: ExtractedBeneficiary; raw: string } | null = null;
  try {
    out = await textExtractBeneficiary(t, grounding);
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not read that." };
  }
  if (!out) return { ok: false, error: "Could not understand that. Try naming the child and their situation." };
  return { ok: true, lowConfidence: !out.profile.full_name, profile: out.profile, raw: out.raw };
}

// ACTION: human-confirmed profile -> write a beneficiary row. The ONLY intake
// path that touches the DB. Gated by an explicit click. Re-validates every field
// server-side. PII stays private: consent_public is hard-set false here, so a new
// record is NEVER donor-facing until Nur publishes it via the consent toggle.
export async function confirmBeneficiary(fd: FormData) {
  const full_name = String(fd.get("full_name") || "").trim();
  if (!full_name) return;

  let program = String(fd.get("program") || "other").toLowerCase();
  if (!PROGRAMS.includes(program)) program = "other";

  let gender: string | null = String(fd.get("gender") || "").toLowerCase() || null;
  if (gender && !GENDERS.includes(gender)) gender = null;

  const region = String(fd.get("region") || "").trim() || null;
  const guardian_status = String(fd.get("guardian_status") || "").trim() || null;
  const story = String(fd.get("story") || "").trim() || null;
  const needs = String(fd.get("needs") || "").trim() || null;
  const schoolFees = String(fd.get("school_fees") || "").trim();
  const source = String(fd.get("source") || "ai").trim(); // image | voice | text
  const photo_path = String(fd.get("photo_path") || "").trim() || null;

  // age -> date_of_birth (Jan 1 of the implied birth year) only if no real DOB given
  const dobStr = String(fd.get("date_of_birth") || "").trim();
  const ageStr = String(fd.get("age") || "").trim();
  let date_of_birth: string | null = null;
  if (dobStr) {
    const d = new Date(dobStr);
    if (!isNaN(d.getTime())) date_of_birth = d.toISOString().slice(0, 10);
  } else if (ageStr) {
    const age = Math.round(Number(ageStr.replace(/[^0-9.]/g, "")));
    if (age > 0 && age < 130) date_of_birth = `${new Date().getUTCFullYear() - age}-01-01`;
  }

  let tags: string[] = [];
  try {
    const t = JSON.parse(String(fd.get("tags") || "[]"));
    if (Array.isArray(t)) tags = t.map((x: any) => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 8);
  } catch {}
  // fold school-fees into the private case notes so nothing is dropped
  const story_private = [story, schoolFees ? `School fees: ${schoolFees}` : ""].filter(Boolean).join("\n\n") || null;

  const db = admin();

  // If a photo was staged, register it as an assets row (consent_required) so the
  // 360 view can resolve a signed URL via photo_asset_id. PII bucket stays private.
  let photo_asset_id: string | null = null;
  if (photo_path) {
    const { data: asset } = await db
      .from("assets")
      .insert({
        type: "image",
        title: `Beneficiary photo: ${full_name}`,
        storage_path: photo_path,
        source: "beneficiary_intake",
        consent_required: true,
        consent_on_file: false,
        created_by: "Nur",
      })
      .select("id")
      .single();
    photo_asset_id = asset?.id ?? null;
  }

  const ref_code = `NB-${Date.now().toString(36).toUpperCase()}`;

  const { data: row } = await db
    .from("beneficiaries")
    .insert({
      ref_code,
      full_name,
      program,
      gender,
      region,
      location: region,
      guardian_status,
      date_of_birth,
      story_private,
      needs,
      tags,
      photo_asset_id,
      status: "active",
      consent_public: false, // PII: never donor-facing until Nur consents
      intake_date: new Date().toISOString().slice(0, 10),
    })
    .select()
    .single();

  // learn the intake (private case context) so agents have grounding — no PII to
  // the public view, this stays in the service-role brain only.
  await remember({
    kind: "org_fact",
    title: `Beneficiary intake: ${ref_code}`,
    content: `A child entered the ${program} program${gender ? `, ${gender}` : ""}${region ? `, from ${region}` : ""}.${needs ? ` Needs: ${needs}.` : ""}`,
    source_type: "beneficiary",
    source_id: row?.id,
  });

  await emit({
    type: "beneficiary.intake",
    source: "beneficiaries",
    actor: "Nur",
    subject_type: "beneficiary",
    subject_id: row?.id ?? null,
    payload: { ref: ref_code, program, intake: source, ai: true, photo: !!photo_asset_id },
  });

  revalidatePath("/beneficiaries");
}

// Move a beneficiary through the program lifecycle from the 360 view.
const STATUSES = ["active", "graduated", "transitioned", "paused", "exited", "inactive"];
export async function setStatus(fd: FormData) {
  const id = String(fd.get("id") || "");
  const status = String(fd.get("status") || "").toLowerCase();
  if (!id || !STATUSES.includes(status)) return;

  const db = admin();
  await db.from("beneficiaries").update({ status }).eq("id", id);

  await emit({
    type: "beneficiary.status_changed",
    source: "beneficiaries",
    actor: "Nur",
    subject_type: "beneficiary",
    subject_id: id,
    payload: { status },
  });

  revalidatePath("/beneficiaries");
  revalidatePath(`/beneficiaries/${id}`);
}
