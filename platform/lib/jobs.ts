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

export type JobKind = "grant.prepare" | "studio.generate" | "ingest.process" | "whatsapp.reply" | "group.send";
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
// gracefully rather than blocking).
//
// v1.3.12: subject-id idempotency is now OPT-IN per kind, not blanket. The
// 2026-06-10 demo caught the latent bug: while batch 1's whatsapp.reply was
// still `running`, batch 2's inbound was silently merged into batch 1's slot
// and its body was lost forever. The original comment named grant.prepare as
// the only legitimate user of this rule, but the code applied it to every
// kind. Now only DEDUP_BY_SUBJECT kinds get the open-job check; whatsapp.reply
// and every per-event kind always enqueues a fresh row.
const DEDUP_BY_SUBJECT = new Set<JobKind>(["grant.prepare"]);
export async function enqueueJob(
  kind: JobKind,
  subjectId: string | null,
  payload: Record<string, any> = {},
): Promise<string | null> {
  const db = admin();
  if (subjectId && DEDUP_BY_SUBJECT.has(kind)) {
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

// Enqueue a job deduped on a PAYLOAD field instead of subject_id. Used by
// studio.generate, whose "subject" is a document kind string (not a uuid that
// fits subject_id). Skips if an open job already targets the same payload value
// so rapid taps on "Regenerate" never pile up. Returns the row id (existing or
// new) or null on insert failure.
export async function enqueueJobByPayload(
  kind: JobKind,
  payloadKey: string,
  payloadValue: string,
  payload: Record<string, any> = {},
): Promise<{ id: string | null; deduped: boolean }> {
  const db = admin();
  const { data: open } = await db
    .from("jobs")
    .select("id")
    .eq("kind", kind)
    .eq(`payload->>${payloadKey}`, payloadValue)
    .in("status", ["queued", "running"])
    .limit(1);
  if (open && open.length) return { id: open[0].id, deduped: true };
  const { data, error } = await db
    .from("jobs")
    .insert({ kind, subject_id: null, payload: { ...payload, [payloadKey]: payloadValue }, status: "queued" })
    .select("id")
    .single();
  if (error) {
    console.error("enqueueJobByPayload failed", kind, error.message);
    return { id: null, deduped: false };
  }
  return { id: data?.id ?? null, deduped: false };
}

// Open studio.generate jobs grouped by the doc kind in their payload, for the
// per-document "preparing" status chip. Cheap select of open rows only.
export async function studioGenerateOpen(): Promise<Record<string, number>> {
  const db = admin();
  const { data } = await db
    .from("jobs")
    .select("payload")
    .eq("kind", "studio.generate")
    .in("status", ["queued", "running"]);
  const out: Record<string, number> = {};
  for (const r of (data || []) as any[]) {
    const k = r?.payload?.docKind;
    if (typeof k === "string") out[k] = (out[k] || 0) + 1;
  }
  return out;
}

// How long a job may sit in `running` before we treat the worker that claimed it
// as dead and requeue its work. A full grant prepare measures ~80s; the worker
// budget is up to 300s. 10 minutes is comfortably past any single legitimate run,
// so anything still "running" past it was orphaned by a crashed/clamped invocation.
const STUCK_MINUTES = 10;
// A job that has failed this many times is parked (status "error") rather than
// retried forever, so one poisoned payload can never wedge the queue.
const MAX_ATTEMPTS = 4;

// STUCK-JOB RECLAIM (P5). Jobs left "running" longer than STUCK_MINUTES were
// orphaned (the worker that claimed them was clamped by the function budget or
// crashed mid-build). Flip them back to "queued" so the next drain re-claims
// them, UNLESS they have already burned through MAX_ATTEMPTS (then park as
// "error" with a clear note). Returns how many were requeued. Cheap + idempotent;
// safe to run at the top of every worker invocation and on the cron.
export async function reclaimStuckJobs(kind?: JobKind): Promise<{ requeued: number; parked: number }> {
  const db = admin();
  const cutoff = new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString();
  let q = db.from("jobs").select("id,attempts").eq("status", "running").lt("started_at", cutoff);
  if (kind) q = q.eq("kind", kind);
  const { data } = await q.limit(50);
  const stuck = (data || []) as { id: string; attempts: number }[];
  if (!stuck.length) return { requeued: 0, parked: 0 };

  const requeueIds = stuck.filter((j) => (j.attempts || 0) < MAX_ATTEMPTS).map((j) => j.id);
  const parkIds = stuck.filter((j) => (j.attempts || 0) >= MAX_ATTEMPTS).map((j) => j.id);

  if (requeueIds.length) {
    await db.from("jobs").update({ status: "queued", started_at: null }).in("id", requeueIds);
  }
  if (parkIds.length) {
    await db
      .from("jobs")
      .update({ status: "error", finished_at: new Date().toISOString(), error: `stuck past ${STUCK_MINUTES}m, exceeded ${MAX_ATTEMPTS} attempts` })
      .in("id", parkIds);
  }
  return { requeued: requeueIds.length, parked: parkIds.length };
}

// Claim up to `limit` queued jobs of a kind and flip them to running. ATOMIC: the
// status flip carries its OWN guard (.eq("status","queued")) and returns only the
// rows this caller actually flipped (.select()). Postgres takes a row lock for the
// UPDATE, so when two worker invocations race the same queued job, exactly one
// UPDATE matches status='queued' and returns the row; the loser re-reads 'running'
// under the lock, matches zero rows, and returns []. Only the winner processes it.
//
// This is the fix for the duplicate-reply bug (one inbound message answered up to
// six times): the old code did SELECT-then-blind-UPDATE, so two concurrent drains
// (the webhook fires triggerWorker on every inbound, and Nur sends bursts of media)
// both selected the same queued row and both replied. The guarded update closes
// that race. Attempts is incremented per row so stuck-job reclaim can park a
// poisoned payload.
export async function claimJobs(kind: JobKind, limit: number): Promise<Job[]> {
  const db = admin();
  const { data } = await db
    .from("jobs")
    .select("*")
    .eq("kind", kind)
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(limit);
  const candidates = (data || []) as Job[];
  if (!candidates.length) return [];
  const now = new Date().toISOString();
  const claimed: Job[] = [];
  await Promise.all(
    candidates.map(async (j) => {
      const { data: won } = await db
        .from("jobs")
        .update({ status: "running", started_at: now, attempts: (j.attempts || 0) + 1 })
        .eq("id", j.id)
        .eq("status", "queued")
        .select("*");
      if (won && won.length) claimed.push(won[0] as Job);
    })
  );
  return claimed;
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
