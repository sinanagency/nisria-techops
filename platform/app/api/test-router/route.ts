import { NextResponse } from "next/server";
import { routeMessage } from "../../../lib/agents/router";
import { recentEvents } from "../../../lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const results: any[] = [];

  // Test routeMessage
  const texts = [
    "Remind me to call Mark at 3pm",
    "Send an email to John",
    "What's the budget?",
    "Add a new beneficiary named Sarah",
    "Hello!",
  ];

  for (const text of texts) {
    const routeResult = await routeMessage(text);
    results.push({
      text: text.slice(0, 50),
      domain: routeResult.domain,
      confidence: routeResult.confidence,
      reason: routeResult.reason,
    });
  }

  // Check for router.classified events
  const events = await recentEvents(20);
  const routerEvents = events.filter((e: any) => e.type === "router.classified");

  return NextResponse.json({
    test: results,
    routerEventCount: routerEvents.length,
    routerEvents: routerEvents.map((e: any) => ({
      type: e.type,
      domain: e.payload?.domain,
      confidence: e.payload?.confidence,
      created_at: e.created_at,
    })),
  });
}
