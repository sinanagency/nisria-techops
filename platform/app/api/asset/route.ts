// Viewable proof. Given a private-bucket storage path, redirect to a short-lived
// signed URL so <img src="/api/asset?path=..."> and proof links work anywhere in
// the portal without exposing the bucket. Session-gated by the middleware (this
// route is not in the machine-secret exempt list), so only a logged-in operator
// can resolve a receipt. The signed URL itself expires in an hour.
import { NextRequest, NextResponse } from "next/server";
import { admin } from "../../../lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path) return new NextResponse("missing path", { status: 400 });
  const { data, error } = await admin().storage.from("assets").createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return new NextResponse("not found", { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
