// Lightweight background job queue (the non-blocking spine).
//
// THE PROBLEM this solves: Next.js processes server actions serially per
// session, and every page here is force-dynamic (every nav is a server
// round-trip). So a single long server action (a grant prepare is 15-80s of
// Claude) holds the request pipeline and traps the founder on the page: she
// cannot navigate while it runs.
//
// THE FIX: the click does ONE fast INSERT into this table and returns instantly.
// A separate worker invocation (/api/grants/prepare) drains the queue on its own
// request, so the slow Claude work never sits on the navigation path. The daily
// cron drains it too, so completion is guaranteed even if the detached trigger
// is dropped. Everything is idempotent and capped.
import { admin } from "./supabase-admin";

export type JobKind = "grant.prepare";
export type JobStatus = "queued" | "running" | "done" | "error";

export type Job = {
  id: string;
  kind: string;
  subject_id: string | null;
  status: JobStatus;
  payload: Record<string, any>;
  attempts: number;
  error: string | null;
  created_at: string;
};

// Enqueue a job. Returns the new row id, or null on failure (best-effort: the
// daily cron's own scan still picks the work up, so a failed enqueue degrades
// gracefully rather than blocking). Idempotent for grant.prepare: we skip if an
// open job already exists for the same grant so rapid taps never pile up.
export async function enqueueJob(
  kind: JobKind,
  subjectId: string | null,
  payload: Record<string, any> = {},
): Promise<string | null> {
  const db = admin();
  if (subjectId) {
    const { data: open } = await db
      .from("jobs")
      .select("id")
      .eq("kind", kind)
      .eq("subject_id", subjectId)
      .in("status", ["queued", "running"])
      .limit(1);
    if (open && open.length) return open[0].id;
  }
  const { data, error } = await db
    .from("jobs")
    .insert({ kind, subject_id: subjectId, payload, status: "queued" })
    .select("id")
    .single();
  if (error) {
    console.error("enqueueJob failed", kind, error.message);
    return null;
  }
  return data?.id ?? null;
}

// Claim up to `limit` queued jobs of a kind and flip them to running in one
// pass. Not a hard distributed lock (single worker, low volume), but the
// status flip + skip-running in enqueue keeps double-processing rare and the
// downstream write is idempotent regardless.
export async function claimJobs(kind: JobKind, limit: number): Promise<Job[]> {
  const db = admin();
  const { data } = await db
    .from("jobs")
    .select("*")
    .eq("kind", kind)
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(limit);
  const jobs = (data || []) as Job[];
  if (!jobs.length) return [];
  const ids = jobs.map((j) => j.id);
  await db
    .from("jobs")
    .update({ status: "running", started_at: new Date().toISOString(), attempts: (jobs[0].attempts || 0) + 1 })
    .in("id", ids);
  return jobs;
}

export async function markJobDone(id: string): Promise<void> {
  await admin().from("jobs").update({ status: "done", finished_at: new Date().toISOString(), error: null }).eq("id", id);
}

export async function markJobError(id: string, message: string): Promise<void> {
  await admin().from("jobs").update({ status: "error", finished_at: new Date().toISOString(), error: message.slice(0, 500) }).eq("id", id);
}

// Open-work counts for the quiet status chip. Cheap (HEAD counts), safe to poll.
export async function jobCounts(kind?: JobKind): Promise<{ queued: number; running: number }> {
  const db = admin();
  const base = () => {
    let q = db.from("jobs").select("id", { count: "exact", head: true });
    if (kind) q = q.eq("kind", kind);
    return q;
  };
  const [{ count: queued }, { count: running }] = await Promise.all([
    base().eq("status", "queued"),
    base().eq("status", "running"),
  ]);
  return { queued: queued || 0, running: running || 0 };
}

// Fire-and-forget trigger so a queued job starts draining immediately instead of
// waiting for the next cron. We DO NOT await the response (that is the whole
// point: the caller returns instantly and the worker runs on its own request).
// A dropped trigger is harmless: the daily cron drains the same queue.
export function triggerWorker(path: string): void {
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;
  const origin = base ? (base.startsWith("http") ? base : `https://${base}`) : "http://localhost:3000";
  const secret = process.env.AGENT_TICK_SECRET || "";
  const url = `${origin}${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(secret)}`;
  // Intentionally not awaited. Swallow connection errors; cron is the backstop.
  fetch(url, { method: "POST", headers: { "x-agent-secret": secret }, cache: "no-store" }).catch(() => {});
}
