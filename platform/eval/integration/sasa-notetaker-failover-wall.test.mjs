// Notetaker failover wall (2026-06-21, KT #340). The notetaker hung off ONE
// ephemeral trycloudflare quick-tunnel; when that node/tunnel died (operator VPN
// off, host restart) the dispatch 500'd and the feature was dead. Now dispatch
// walks a list of candidate nodes (MEETING_BOT_URLS), health-probes each, and uses
// the first live one — "auto-find any active node to stay alive".
//
// Seams: S1 reads a multi-node list (MEETING_BOT_URLS) with MEETING_BOT_URL fallback;
//        S2 health-probes a node before dispatching (skip dead/404 tunnels);
//        S3 iterates nodes with failover (a loop over bases, returns the live node);
//        S4 returns an honest error when no node is reachable (no fake success).
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const D = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "lib", "digital-u.ts"), "utf8");
const fail=(m)=>{console.error("FAIL:",m);process.exitCode=1};const ok=(m)=>console.log("PASS:",m);
if(!/MEETING_BOT_URLS/.test(D)||!/MEETING_BOT_URL\b/.test(D))fail("S1 must read MEETING_BOT_URLS with MEETING_BOT_URL fallback");else ok("S1 multi-node list + fallback");
if(!/nodeHealthy|\/api\/health/.test(D))fail("S2 must health-probe a node before dispatching");else ok("S2 health-probe before dispatch");
if(!/for\s*\(const base of bases\)/.test(D))fail("S3 must iterate candidate nodes (failover)");else ok("S3 failover loop over nodes");
if(!/return\s*\{\s*ok:\s*false,\s*error:\s*lastErr\s*\}/.test(D.replace(/\s+/g," ")))fail("S4 must return honest error when no node reachable");else ok("S4 honest error when none reachable");
if(process.exitCode)console.error("\nWALL RED.");else console.log("\nWALL GREEN.");
