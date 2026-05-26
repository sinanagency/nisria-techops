// "Draft with Sasa" for the donor 360 composer. If the donor has a recent gift,
// write a warm thank-you (Donor Steward). Otherwise write a sincere check-in,
// both grounded in the donor's own history + the Brain. PROPOSES only — it fills
// the composer textarea for Nur; nothing is sent here.
import { NextRequest, NextResponse } from "next/server";
import { admin, money } from "../../../lib/supabase-admin";
import { recall, groundingText } from "../../../lib/memory";
import { draftThankYou } from "../../../lib/agents/steward";
import { claudeJSON } from "../../../lib/anthropic";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RECENT_DAYS = 60;

export async function POST(req: NextRequest) {
  try {
    const { donor_id } = await req.json();
    if (!donor_id) return NextResponse.json({ error: "missing donor_id" }, { status: 200 });

    const db = admin();
    const { data: donor } = await db.from("donors").select("*").eq("id", donor_id).single();
    const d: any = donor || {};
    const name = d.full_name || (d.email || "there").split("@")[0];

    // most recent succeeded gift, if any
    const { data: giftRows } = await db
      .from("donations")
      .select("amount,status,donated_at,is_recurring,campaign:campaigns(name)")
      .eq("donor_id", donor_id)
      .order("donated_at", { ascending: false })
      .limit(8);
    const gifts: any[] = giftRows || [];
    const succeeded = gifts.filter((g) => g.status === "succeeded");
    const last = succeeded[0] || null;

    const grounding = groundingText(
      await recall(`donor ${name} ${d.type || ""} ${(last?.campaign?.name) || ""}`, {
        kinds: ["brand_voice", "approved_reply"],
      }),
    );

    const recent =
      last && (Date.now() - new Date(last.donated_at).getTime()) / 86400e3 <= RECENT_DAYS;

    // recent gift -> thank-you via the Donor Steward
    if (recent && last) {
      const r = await draftThankYou({
        name,
        amount: money(last.amount),
        recurring: !!last.is_recurring,
        grounding,
      });
      if (r?.body) return NextResponse.json({ subject: r.subject || "Thank you", body: r.body });
    }

    // otherwise a warm, grounded check-in
    const lifetime = Number(d.lifetime_value) || succeeded.reduce((s, g) => s + Number(g.amount || 0), 0);
    const system = `You are Nisria's Donor Steward. Write a short, warm check-in to a supporter (2-4 sentences) in Nisria's sincere voice. Not a fundraising ask, not guilt-trippy. Acknowledge them genuinely and, if there is past giving, the difference their support has made in general terms. Do NOT invent figures, names, or specific outcomes. End simply.

Brand voice + examples to match:
${grounding}`;
    const user = `Donor: ${name}
${succeeded.length ? `Past gifts: ${succeeded.length}, lifetime ${money(lifetime)}${last ? `, last on ${new Date(last.donated_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}` : ""}.` : "No recorded gifts yet (a prospect or lapsed donor)."}
${d.country ? `Country: ${d.country}.` : ""}

Return JSON: { "subject": "a warm subject line", "body": "the message body" }`;
    const r = await claudeJSON<{ subject: string; body: string }>(system, user, 500);
    return NextResponse.json(r || { subject: "A note from Nisria", body: `Hi ${name},\n\n` });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "draft failed" }, { status: 200 });
  }
}
