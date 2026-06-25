// SANDBOX REPLAY EVAL. Replays the real team transcript through the NEW mesh
// (via /api/eval/replay, stubbed tools, zero side effects), pairs each inbound with
// the OLD bot's actual reply, and LLM-judges new vs old. Writes a proof file.
// Reads secrets from env files only. Run: node scripts/_replay-eval.mjs
import fs from "node:fs";

const envTxt = (fs.existsSync("/tmp/ev.env") ? fs.readFileSync("/tmp/ev.env", "utf8") + "\n" : "") + fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const E = (k) => { const re = new RegExp(`^${k}=(.*)$`, "mg"); let m, v = ""; while ((m = re.exec(envTxt))) { const val = m[1].trim().replace(/^"|"$/g, ""); if (val) { v = val; break; } } return v; };
const SUPA = E("SUPABASE_URL"), SVC = E("SUPABASE_SERVICE_KEY"), AKEY = E("ANTHROPIC_API_KEY"), GS = E("GROUP_BOT_SECRET");
const REPLAY = "https://command.nisria.co/api/eval/replay";
const JUDGE_MODEL = "claude-haiku-4-5-20251001";
const FULL_CAP = 120;

if (!SUPA || !SVC || !AKEY || !GS) { console.log("missing env", { SUPA: !!SUPA, SVC: !!SVC, AKEY: !!AKEY, GS: !!GS }); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { __err: String(e?.message || e) }; } }
  }));
  return out;
}

// ---- 1. pull full DM transcript (in + out), ordered ----
async function pullAll() {
  let rows = [], off = 0;
  while (true) {
    const url = `${SUPA}/rest/v1/messages?select=contact_id,direction,body,handled_by,sender_type,created_at&channel=eq.whatsapp&sender_type=is.null&created_at=gte.2026-05-28&order=contact_id.asc,created_at.asc&limit=1000&offset=${off}`;
    const r = await fetch(url, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } });
    const b = await r.json(); rows = rows.concat(b);
    if (b.length < 1000) break; off += 1000;
  }
  return rows;
}

// ---- 2. build (inbound, history, oldReply, nextUser) records ----
function buildRecords(rows) {
  const byContact = {};
  for (const r of rows) { (byContact[r.contact_id] ||= []).push(r); }
  const recs = [];
  for (const cid of Object.keys(byContact)) {
    const seq = byContact[cid];
    for (let i = 0; i < seq.length; i++) {
      if (seq[i].direction !== "in") continue;
      const inbound = (seq[i].body || "").trim();
      if (!inbound || inbound.startsWith("[")) continue; // skip media/empty
      // history = last up to 6 turns before this
      const hist = [];
      for (let j = Math.max(0, i - 6); j < i; j++) {
        const m = seq[j]; if (!m.body) continue;
        hist.push({ role: m.direction === "in" ? "user" : "assistant", content: String(m.body).slice(0, 600) });
      }
      // oldReply = next out; nextUser = next in after that
      let oldReply = "", nextUser = "";
      for (let j = i + 1; j < seq.length; j++) { if (seq[j].direction === "out" && seq[j].body) { oldReply = seq[j].body; break; } if (seq[j].direction === "in") break; }
      for (let j = i + 1; j < seq.length; j++) { if (seq[j].direction === "in" && seq[j].body) { nextUser = seq[j].body; break; } }
      recs.push({ cid, ts: seq[i].created_at, inbound, history: hist, oldReply, nextUser });
    }
  }
  return recs;
}

const ACTIONABLE = /\b(remind|task|todo|deadline|meeting|calendar|schedul|event|done|complete|reopen|paid|payment|pay|salary|stipend|rent|receipt|invoice|donat|donor|campaign|payroll|beneficiar|case|intake|contact|add|update|delete|merge|message|send|tell|email|draft|post|flag|relay|document|file|grant|remember|inventory|stock|wishlist|mark|log|find|who is|how much|how many)\b/i;
const FAILURE = /\b(hallucinat|you('?re| are) wrong|did(n'?t| not) say|that('?s| is) not|no don'?t|for god'?s sake|where did you (get|come)|you marked.*(done|complete)|not done|disappointed|stop (saying|repeating)|i did ?n'?t say|OMG|that'?s wrong|wrong number)\b/i;

// ---- judge ----
async function judge(rec, neu) {
  const sys = `You grade a nonprofit WhatsApp assistant. Compare the OLD reply (what the bot actually said historically) and the NEW reply (the rebuilt model) for the SAME user message. Use the user's NEXT message as a truth signal if present (frustration = the reply that triggered it was wrong). Return STRICT JSON: {"new_ok":true/false,"old_ok":true/false,"new_fixed_old":true/false,"routing_ok":true/false,"note":"<=16 words"}. new_fixed_old=true only if old was wrong AND new is right. routing_ok = did NEW route to a sensible domain for this message.`;
  const usr = `USER MESSAGE: ${rec.inbound}\n\nOLD REPLY: ${rec.oldReply || "(none)"}\n\nNEW REPLY (domain=${neu.domain}, tools=${(neu.toolCalls || []).map((t) => t.name).join(",") || "none"}): ${neu.reply || "(none)"}\n\nUSER'S NEXT MESSAGE: ${rec.nextUser || "(none)"}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: JUDGE_MODEL, max_tokens: 200, system: sys, messages: [{ role: "user", content: usr }] }),
  });
  const j = await r.json();
  const txt = (j?.content || []).find((b) => b.type === "text")?.text || "";
  const mm = txt.match(/\{[\s\S]*\}/); if (!mm) return { __judgeerr: txt.slice(0, 80) };
  try { return JSON.parse(mm[0]); } catch { return { __judgeerr: "parse" }; }
}

(async () => {
  console.log("pulling transcript...");
  const rows = await pullAll();
  const recs = buildRecords(rows);
  console.log(`DM inbound records: ${recs.length}`);

  // 3. ROUTE ALL (cheap)
  console.log("routing all inbound (routeOnly)...");
  const routed = await pool(recs, 8, async (rec) => {
    const r = await fetch(REPLAY, { method: "POST", headers: { "Content-Type": "application/json", "x-eval-secret": GS }, body: JSON.stringify({ command: rec.inbound, history: rec.history, routeOnly: true }) });
    const b = await r.json(); return b.ok ? b.domain : `ERR:${b.error || r.status}`;
  });
  const dist = {}; routed.forEach((d) => { dist[d] = (dist[d] || 0) + 1; });
  console.log("routing distribution:", dist);

  // 4. focused full-replay set: all known-failures + actionable sample, capped
  const failures = recs.map((r, i) => ({ r, i })).filter(({ r }) => FAILURE.test(r.nextUser || ""));
  const actionable = recs.map((r, i) => ({ r, i })).filter(({ r }) => ACTIONABLE.test(r.inbound) && !FAILURE.test(r.nextUser || ""));
  // dedup + cap: all failures, then fill with evenly-sampled actionable
  const chosen = [...failures];
  const need = Math.max(0, FULL_CAP - chosen.length);
  const step = Math.max(1, Math.floor(actionable.length / Math.max(1, need)));
  for (let k = 0; k < actionable.length && chosen.length < FULL_CAP; k += step) chosen.push(actionable[k]);
  console.log(`known-failures: ${failures.length} | actionable total: ${actionable.length} | full-replay set: ${chosen.length} (cap ${FULL_CAP})`);

  // 5. FULL REPLAY chosen
  console.log("full-replaying focused set...");
  const replayed = await pool(chosen, 5, async ({ r }) => {
    const resp = await fetch(REPLAY, { method: "POST", headers: { "Content-Type": "application/json", "x-eval-secret": GS }, body: JSON.stringify({ command: r.inbound, history: r.history, role: "admin" }) });
    const b = await resp.json(); return b.ok ? { domain: b.domain, confidence: b.confidence, reply: b.reply, toolCalls: b.toolCalls } : { __err: b.error || resp.status };
  });

  // 6. JUDGE
  console.log("judging...");
  const judged = await pool(chosen, 5, async ({ r }, k) => {
    const neu = replayed[k]; if (neu?.__err) return { rec: r, neu, verdict: { __err: neu.__err } };
    const v = await judge(r, neu); return { rec: r, neu, verdict: v };
  });

  // 7. summarize
  const ok = judged.filter((x) => x.verdict && !x.verdict.__err && !x.verdict.__judgeerr);
  const newOk = ok.filter((x) => x.verdict.new_ok).length;
  const oldOk = ok.filter((x) => x.verdict.old_ok).length;
  const fixed = ok.filter((x) => x.verdict.new_fixed_old).length;
  const routeOk = ok.filter((x) => x.verdict.routing_ok).length;
  const failJudged = judged.filter((x) => FAILURE.test(x.rec.nextUser || ""));
  const failFixed = failJudged.filter((x) => x.verdict && x.verdict.new_ok).length;
  const regressions = ok.filter((x) => x.verdict.old_ok && !x.verdict.new_ok);

  const summary = {
    generated_for: "Taona", date: "2026-06-25",
    total_dm_inbound: recs.length,
    routing_distribution: dist,
    routing_errors: routed.filter((d) => String(d).startsWith("ERR")).length,
    full_replay_count: ok.length,
    known_failures_total: failures.length,
    known_failures_now_handled: `${failFixed}/${failJudged.length}`,
    new_model_ok: `${newOk}/${ok.length}`,
    old_model_ok: `${oldOk}/${ok.length}`,
    new_fixed_old: fixed,
    routing_ok_judged: `${routeOk}/${ok.length}`,
    regressions_new_worse_than_old: regressions.length,
    caps: `full-replay capped at ${FULL_CAP}; ${actionable.length - (chosen.length - failures.length)} actionable not deep-replayed (routed only)`,
  };

  const detail = judged.map((x) => ({ ts: x.rec.ts, inbound: x.rec.inbound, old_reply: (x.rec.oldReply || "").slice(0, 300), new_domain: x.neu?.domain, new_tools: (x.neu?.toolCalls || []).map((t) => t.name), new_reply: (x.neu?.reply || "").slice(0, 300), next_user: (x.rec.nextUser || "").slice(0, 150), verdict: x.verdict }));

  fs.writeFileSync(new URL("../../docs/replay-eval-proof.json", import.meta.url), JSON.stringify({ summary, detail }, null, 2));
  // CSV
  const csv = ["ts,new_domain,new_ok,old_ok,new_fixed_old,routing_ok,inbound,new_reply,note"].concat(
    detail.map((d) => [d.ts, d.new_domain, d.verdict?.new_ok, d.verdict?.old_ok, d.verdict?.new_fixed_old, d.verdict?.routing_ok, JSON.stringify(d.inbound), JSON.stringify(d.new_reply), JSON.stringify(d.verdict?.note || "")].join(","))
  ).join("\n");
  fs.writeFileSync(new URL("../../docs/replay-eval-proof.csv", import.meta.url), csv);

  console.log("\n==== SUMMARY ====");
  console.log(JSON.stringify(summary, null, 2));
  console.log("\nproof: docs/replay-eval-proof.json + .csv");
})();
