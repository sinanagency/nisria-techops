// Editable org-level settings that live in org_profile (the same table the Brain
// onboarding writes to). Each setting is one row keyed by `section`. We reuse
// org_profile so there is no extra table to migrate and the value is editable
// from Settings exactly like every other Brain field.
//
// monthly_goal: the fundraising target the dashboard gauge measures against.
// Defaults to 5000 when unset or unparseable, so the gauge never breaks.
import { admin } from "./supabase-admin";

export const MONTHLY_GOAL_DEFAULT = 5000;

// Read the configured monthly fundraising goal. Always returns a positive number
// (falls back to the default on missing/garbage values).
export async function getMonthlyGoal(db = admin()): Promise<number> {
  try {
    const { data } = await db
      .from("org_profile")
      .select("content")
      .eq("section", "monthly_goal")
      .maybeSingle();
    const n = Math.round(Number(data?.content));
    return Number.isFinite(n) && n > 0 ? n : MONTHLY_GOAL_DEFAULT;
  } catch {
    return MONTHLY_GOAL_DEFAULT;
  }
}
