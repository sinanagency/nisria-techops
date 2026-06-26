// Pure graceful-degradation timeout. Races a promise against a timer: if the
// timer wins, resolve `fallback` and emit a structured warn (a soak signal)
// instead of blocking the caller. clearTimeout on settle so the fast path never
// logs a false timeout and no timer lingers past the caller's response.
//
// Ported in spirit from EmirVoice's rag.js (a 2s cap on knowledge-base search
// that returns [] instead of hanging). Kept as a pure .mjs so the same code is
// imported by BOTH lib/memory.ts and the wall test (zero drift).
export function withTimeout(p, ms, fallback, label = "recall") {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      console.warn(JSON.stringify({ event: "recall_query_timeout", label, ms }));
      resolve(fallback);
    }, ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
