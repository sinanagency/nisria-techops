// SMART MODE = a REAL tool-using agent (R3-3 / P6). The founder's vision (imgs
// 173,174): "I should just type and things happen ... an agent that does things
// for me." Nur types a command; Sasa runs a tool-use loop: it READS live data
// and EXECUTES actions inside the platform (create/assign tasks, add records,
// trigger grant prepares, draft+queue gated emails/thank-yous). Reads run
// directly; mutations that touch money/PII/outbound are GATED into the approvals
// queue (manage-by-exception).
//
// The agent loop now lives in lib/agents/sasa.ts (One-brain law) so the WhatsApp
// bot and this console share the identical brain. This route is the web door to it.
import { NextRequest, NextResponse } from "next/server";
import { runSasa, type SasaTurn } from "../../../lib/agents/sasa";
import { getCurrentUser } from "../../../lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { messages, command } = await req.json();
    const history: SasaTurn[] = (messages || [])
      .map((m: any) => ({ role: m.role, content: typeof m.content === "string" ? m.content : String(m.content || "") }))
      .filter((m: SasaTurn) => m.role === "user" || m.role === "assistant");
    const text = command || messages?.[messages.length - 1]?.content || "";
    if (!text && !history.length) {
      return NextResponse.json({ reply: "Tell me what you would like me to do.", actions: [] });
    }
    // WHO is typing. getCurrentUser() is a pure signed-cookie read (no DB, no
    // network), so threading identity costs nothing. builder => owner (Taona,
    // final say); founder => founder (Nur). Sasa's admin prompt is rank-aware.
    const user = getCurrentUser();
    const operatorRank = user?.role === "builder" ? "owner" : user?.role === "founder" ? "founder" : undefined;
    const { reply, actions } = await runSasa({
      history,
      command: String(text),
      operatorName: user?.name,
      operatorRank,
    });
    return NextResponse.json({ reply, actions });
  } catch (e: any) {
    return NextResponse.json({ reply: `Something went wrong: ${e?.message || "Smart Mode error"}`, actions: [] }, { status: 200 });
  }
}
