// Owner-mirror 24h-window wall (2026-06-24, KT #395). Live bug: a free-form mirror to the owner
// outside his 24h window is ACCEPTED by Meta (returns a wamid) but never delivered, yet the bot
// logged free_ok:true — a false success ("i didnt see the mirror / nothing came"). The template
// fallback never fired because it was gated on !mr?.id (and the id was present). Fix: check the
// owner's real inbound window FIRST; if closed, skip the doomed free-form and use the approved
// template, and record the truth (free_ok reflects actual delivery, window_open recorded).
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const WA = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "lib", "whatsapp.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);
const i = WA.indexOf("OWNER 24h-WINDOW CHECK (KT #395)");
const R = i >= 0 ? WA.slice(i - 200, i + 2400) : "";

if (!R) fail("W1 the owner-window check must exist in the mirror block");
else ok("W1 owner-window check present");
if (!/let ownerWindowOpen = true;/.test(R)) fail("W2 must compute the owner window state");
else ok("W2 computes ownerWindowOpen");
if (!/eq\("direction", "in"\)\.gte\("created_at", since\)/.test(R)) fail("W3 must check the owner's INBOUND within the last 24h");
else ok("W3 checks owner inbound within 24h");
if (!/if \(ownerWindowOpen\) \{[\s\S]{0,200}?freeOk = !!mr\?\.id;/.test(R)) fail("W4 free-form mirror runs ONLY when the window is open");
else ok("W4 free-form only when window open");
if (!/if \(!freeOk\) \{ try \{ await sendTemplate\(_own, "system_alert"/.test(R)) fail("W5 a closed window OR a failed free-form falls back to the approved template (delivers outside the window)");
else ok("W5 template fallback on closed-window/failed free-form");
if (!/free_ok: freeOk, window_open: ownerWindowOpen/.test(R)) fail("W6 the event must record the TRUTH (free_ok reflects real delivery, window_open recorded) — no false success");
else ok("W6 honest event (free_ok reflects delivery, window_open recorded)");
// the OLD false-success shape must be gone
if (/free_ok: !!mr\?\.id \}\);/.test(WA)) fail("W7 the old free_ok:!!mr?.id (false success on a wamid) must be replaced");
else ok("W7 old false-success free_ok removed");

if (process.exitCode) console.error("\nWALL RED."); else console.log("\nWALL GREEN.");
