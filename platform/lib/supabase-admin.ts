import { createClient } from "@supabase/supabase-js";

// SERVER-ONLY admin client. Uses the service role key → bypasses RLS.
// Never import this into a client component. The whole app is auth-gated by
// middleware, and these env vars are NOT NEXT_PUBLIC, so the key never ships
// to the browser.
// Loosely typed on purpose: no generated DB types, so we let inserts/updates
// accept plain objects (avoids supabase-js inferring `never` row shapes).
let _client: any = null;

export function admin(): any {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY");
  _client = createClient(url, key, {
    auth: { persistSession: false },
    // Force fresh reads: stop Next.js from caching supabase-js fetches so the
    // dashboard always reflects live data (e.g. right after a Givebutter sync).
    global: { fetch: (input: any, init: any) => fetch(input, { ...init, cache: "no-store" }) },
  });
  return _client;
}

export const money = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(n || 0));

export const num = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("en-US").format(Number(n || 0));

export const date = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
