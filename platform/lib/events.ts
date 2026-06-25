// The event bus helpers. Every meaningful thing becomes a row in `events`,
// which both the agents and the cockpit (Mission Control) read.
import { admin } from "./supabase-admin";

export type EventIn = {
  type: string;                 // message.received | agent.decided | approval.created | action.executed ...
  source?: string;              // gmail | agent:comms | gateway | nur | system
  actor?: string;
  subject_type?: string;
  subject_id?: string | null;
  correlation_id?: string | null;
  payload?: Record<string, any>;
};

export async function emit(e: EventIn) {
  try {
    const res = await admin().from("events").insert({ ...e, payload: e.payload || {} });
    if (res?.error) {
      console.error("emit supabase error:", res.error);
    }
  } catch (err) {
    console.error("emit threw:", err);
  }
}

export async function recentEvents(limit = 40) {
  const { data } = await admin()
    .from("events")
    .select("id,type,source,actor,subject_type,payload,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data || [];
}
