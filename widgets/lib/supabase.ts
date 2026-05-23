import { createClient } from "@supabase/supabase-js";

// Public, read-only client (anon key). RLS must ensure anon can read ONLY
// public campaign fields + the public_beneficiary_profiles view.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, anon, {
  auth: { persistSession: false },
});

export type Campaign = {
  id: string;
  name: string;
  goal_amount: number | null;
  raised_amount: number;
  status: string;
};

export type PublicProfile = {
  id: string;
  name: string;
  category: string | null;
  public_story: string | null;
  photo_url: string | null;
  goal_amount: number | null;
  funded_amount: number;
  funded_pct: number;
};
