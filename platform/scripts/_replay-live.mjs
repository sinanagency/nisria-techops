// EVOLVING-STATE SEQUENTIAL REPLAY. Feeds the real transcript through the NEW mesh
// in GLOBAL chronological order against an ISOLATED sandbox DB where the bot ACTUALLY
// runs its tools (state evolves: a task created June 2 exists June 10). Per-thread
// history (self-play). Judges new vs old; flags logically-unreplayable cases and
// EXCLUDES them from the accuracy %. Sends are dead on the sandbox. Writes proof.
//
// env knobs: REPLAY_START (default 0), REPLAY_N (default all), JUDGE=1
import fs from "node:fs";
import crypto from "node:crypto";

const local = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const EL = (k) => { const m = local.match(new RegExp(`^${k}=(.*)$`, "m")); return m ? m[1].trim().replace(/^"|"$/g, "") : ""; };
const sbx = fs.readFileSync("/tmp/.sbxenv", "utf8");
const SB = (k) => { const m = sbx.match(new RegExp(`^${k}=(.*)$`, "m")); return m ? m[1].trim() : ""; };
const PROD_URL = EL("SUPABASE_URL"), PROD_SVC = EL("SUPABASE_SERVICE_KEY"), AKEY = EL("ANTHROPIC_API_KEY");
const SBX_URL = SB("SBX_URL"), SBX_SVC = SB("SBX_SVC");
const SECRET = fs.readFileSync("/tmp/.sbxsecret", "utf8").trim();
const DEPLOY = fs.readFileSync("/tmp/.sbxurl", "utf8").trim();
const START = parseInt(process.env.REPLAY_START || "0"), N = parseInt(process.env.REPLAY_N || "100000");
const JUDGE_MODEL = "claude-haiku-4-5-20251001";

const OPERATORS = {
  "971501622716": { name: "Nur", role: "admin", rank: "owner" },
  "971501168462": { name: "Taona", role: "admin", rank: "owner" },
};
const TEAM = { "254111741123": "Cynthia Mwangi", "254796210538": "Eliza Kariuki", "254718686515": "Malieng", "254703119486": "Mark Njambi", "254719342752": "Violet Otieno", "254706298128": "Wahome Jerry" };

const sbxRest = (p, init = {}) => fetch(`${SBX_URL}/rest/v1/${p}`, { ...init, headers: { apikey: SBX_SVC, Authorization: `Bearer ${SBX_SVC}`, "Content-Type": "application/json", ...(init.headers || {}) } });
const prodRest = (p) => fetch(`${PROD_URL}/rest/v1/${p}`, { headers: { apikey: PROD_SVC, Authorization: `Bearer ${PROD_SVC}` } });

async function seedSandbox() {
  // map each phone -> a stable sandbox contact_id; seed contacts + team_members
  const map = {};
  for (const [phone, info] of Object.entries({ ...Object.fromEntries(Object.entries(OPERATORS).map(([p, i]) => [p, i.name])), ...TEAM })) {
    const cid = crypto.randomUUID();
    map[phone] = cid;
    await sbxRest("contacts", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ id: cid, name: info, phone: "+" + phone, channel: "whatsapp" }) }).catch(() => {});
    const isOp = OPERATORS[phone];
    await sbxRest("team_members", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ name: info, phone: "+" + phone, role: isOp ? "founder" : "field", status: "active", bot_access: true }) }).catch(() => {});
  }
  return map;
}

async function pullTranscript() {
  let rows = [], off = 0;
  while (true) {
    const r = await prodRest(`messages?select=contact_id,direction,body,created_at,sender_type&channel=eq.whatsapp&sender_type=is.null&created_at=gte.2026-05-28&order=created_at.asc&limit=1000&offset=${off}`);
    const b = await r.json(); rows = rows.concat(b);
    if (b.length < 1000) break; off += 1000;
  }
  // resolve each contact_id -> phone via prod contacts
  const cids = [...new Set(rows.map((r) => r.contact_id).filter(Boolean))];
  const phoneByCid = {};
  for (let i = 0; i < cids.length; i += 50) {
    const r = await prodRest(`contacts?select=id,phone&id=in.(${cids.slice(i, i + 50).join(",")})`);
    for (const c of await r.json()) phoneByCid[c.id] = (c.phone || "").replace(/[^0-9]/g, "");
  }
  return rows.map((r) => ({ ...r, phone: phoneByCid[r.contact_id] || "" }));
}

async function liveReplay(rec, history, sbxCid) {
  const op = OPERATORS[rec.phone];
  const body = { command: rec.inbound, history, live: true, role: op ? "admin" : "team", operatorName: op?.name || TEAM[rec.phone] || undefined, operatorRank: op?.rank, speakerPhone: rec.phone, contactId: sbxCid };
  const r = await fetch(`${DEPLOY}/api/eval/replay`, { method: "POST", headers: { "Content-Type": "application/json", "x-eval-secret": SECRET }, body: JSON.stringify(body) });
  return r.json();
}

async function judge(rec, neu) {
  const sys = `You grade a nonprofit WhatsApp assistant replayed with REAL evolving state. Decide if the NEW reply is correct for the user message given the thread. Use the user's NEXT message as a truth signal. ALSO decide if this case is LOGICALLY UNREPLAYABLE in a fresh sandbox (references a record created before the replay window, is a pure context fragment with no resolvable referent, is media-only, or depends on external state) — if so set excludable=true. STRICT JSON: {"new_ok":bool,"old_ok":bool,"routing_ok":bool,"excludable":bool,"reason":"<=14 words"}.`;
  const usr = `USER: ${rec.inbound}\nNEW [${neu.domain}, tools:${(neu.toolsRan || []).join(",") || "none"}]: ${neu.reply}\nOLD: ${rec.oldReply || "(none)"}\nNEXT USER: ${rec.nextUser || "(none)"}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: JUDGE_MODEL, max_tokens: 160, system: sys, messages: [{ role: "user", content: usr }] }) });
  const j = await r.json(); const t = (j?.content || []).find((b) => b.type === "text")?.text || ""; const m = t.match(/\{[\s\S]*\}/);
  try { return JSON.parse(m[0]); } catch { return { __err: 1 }; }
}

(async () => {
  if (!DEPLOY.startsWith("http")) { console.log("no sandbox deploy url"); process.exit(2); }
  console.log("seeding sandbox operators..."); const cidMap = await seedSandbox();
  console.log("pulling transcript..."); const rows = await pullTranscript();
  // build global chrono inbound list with per-thread oldReply/nextUser
  const inbound = [];
  const byc = {}; rows.forEach((r) => (byc[r.contact_id] ||= []).push(r));
  for (const r of rows) {
    if (r.direction !== "in" || !r.body || r.body.startsWith("[")) continue;
    const seq = byc[r.contact_id]; const i = seq.indexOf(r);
    let oldReply = "", nextUser = "";
    for (let j = i + 1; j < seq.length; j++) { if (seq[j].direction === "out" && seq[j].body) { oldReply = seq[j].body; break; } if (seq[j].direction === "in") break; }
    for (let j = i + 1; j < seq.length; j++) { if (seq[j].direction === "in" && seq[j].body) { nextUser = seq[j].body; break; } }
    inbound.push({ ts: r.created_at, contact_id: r.contact_id, phone: r.phone, inbound: r.body.trim(), oldReply, nextUser });
  }
  inbound.sort((a, b) => a.ts.localeCompare(b.ts));
  const slice = inbound.slice(START, START + N);
  console.log(`total inbound: ${inbound.length}; replaying [${START}, ${START + slice.length}) sequentially...`);

  const hist = {}; // per contact_id running history (self-play)
  const out = [];
  for (let k = 0; k < slice.length; k++) {
    const rec = slice[k];
    const sbxCid = cidMap[rec.phone] || null;
    const h = (hist[rec.contact_id] ||= []);
    let neu;
    try { neu = await liveReplay(rec, h.slice(-8), sbxCid); } catch (e) { neu = { __err: String(e?.message || e) }; }
    if (neu && neu.ok) { h.push({ role: "user", content: rec.inbound }); h.push({ role: "assistant", content: neu.reply || "" }); }
    out.push({ rec, neu });
    if (k % 25 === 0) console.log(`  ${k}/${slice.length} (${rec.phone} -> ${neu?.domain || neu?.error || "err"})`);
  }

  console.log("judging...");
  const judged = [];
  for (let k = 0; k < out.length; k++) {
    const { rec, neu } = out[k];
    if (!neu?.ok) { judged.push({ rec, neu, v: { __err: 1 } }); continue; }
    let v; try { v = await judge(rec, neu); } catch { v = { __err: 1 }; }
    judged.push({ rec, neu, v });
  }

  const graded = judged.filter((x) => x.v && !x.v.__err);
  const replayable = graded.filter((x) => !x.v.excludable);
  const excluded = graded.filter((x) => x.v.excludable);
  const newOk = replayable.filter((x) => x.v.new_ok).length;
  const oldOk = replayable.filter((x) => x.v.old_ok).length;
  const routeOk = replayable.filter((x) => x.v.routing_ok).length;
  const acc = replayable.length ? (100 * newOk / replayable.length) : 0;
  const summary = {
    window: `[${START}, ${START + slice.length})`, total_inbound: inbound.length,
    graded: graded.length, excluded_unreplayable: excluded.length, replayable_denominator: replayable.length,
    new_accuracy_pct: +acc.toFixed(1), new_ok: newOk, old_ok: oldOk,
    routing_ok_pct: replayable.length ? +(100 * routeOk / replayable.length).toFixed(1) : 0,
    errors: judged.filter((x) => !x.neu?.ok).length,
  };
  fs.writeFileSync(new URL("../../docs/replay-live-proof.json", import.meta.url), JSON.stringify({ summary, detail: judged.map((x) => ({ ts: x.rec.ts, phone: x.rec.phone, inbound: x.rec.inbound, new_domain: x.neu?.domain, new_tools: x.neu?.toolsRan, new_reply: (x.neu?.reply || "").slice(0, 240), old_reply: (x.rec.oldReply || "").slice(0, 180), next_user: (x.rec.nextUser || "").slice(0, 120), v: x.v })) }, null, 2));
  console.log("\n==== SUMMARY ===="); console.log(JSON.stringify(summary, null, 2));
  console.log("proof: docs/replay-live-proof.json");
})();
