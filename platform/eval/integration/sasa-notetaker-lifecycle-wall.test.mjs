// Notetaker lifecycle wall (2026-06-22, KT #362). The bot used to claim "I'm
// sending the notetaker now" on a dispatch 200 that only meant QUEUED, never
// JOINED, and the user was never told when (or whether) it actually got into the
// room. Now the driver opts in to engine lifecycle pings: {event:"joined"} when
// admitted, {event:"waiting"} when stuck in the Zoom waiting room.
//
// Seams: L1 dispatch payload opts in (lifecycle:true) so the engine emits pings;
//        L2 ingest handles event:"joined" AND event:"waiting";
//        L3 the lifecycle branch runs BEFORE the error/empty branches (a join
//           ping carries no transcript, so out-of-order would trip empty-capture);
//        L4 joined tells Nur the bot is IN; waiting tells her to ADMIT it;
//        L5 no forbidden status value written (status CHECK = captured/failed/
//           transcribing/queued; in_call/waiting would 23514) — joined uses
//           'transcribing', waiting writes no status.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const D = fs.readFileSync(path.resolve(here, "..", "..", "lib", "digital-u.ts"), "utf8");
const I = fs.readFileSync(path.resolve(here, "..", "..", "app", "api", "digital-u", "ingest", "route.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// L1: dispatch opts in.
if (!/lifecycle:\s*true/.test(D)) fail("L1 dispatch payload must set lifecycle:true to opt into engine pings");
else ok("L1 dispatch opts into lifecycle pings");

// L2: ingest handles both events, gated on event PRESENCE (skeptic-hardened so an
// unknown event value never falls through to the empty/error relay).
if (!/if\s*\(body\?\.event\)/.test(I)) fail("L2a lifecycle must gate on event PRESENCE (if (body?.event)), not a bare two-string whitelist");
else if (!/===\s*["']joined["']/.test(I) || !/===\s*["']waiting["']/.test(I)) fail("L2b ingest must handle 'joined' AND 'waiting'");
else ok("L2 ingest gates on event presence + handles joined/waiting (unknown events no-op)");

// L3: lifecycle branch is ordered before the error + empty branches.
const iLife = I.indexOf("if (body?.event)");
const iErr = I.indexOf("if (body?.error)");
const iEmpty = I.indexOf("if (!transcript)");
if (iLife < 0 || iErr < 0 || iEmpty < 0 || !(iLife < iErr && iLife < iEmpty))
  fail("L3 lifecycle branch must run BEFORE the error and empty-transcript branches");
else ok("L3 lifecycle handled before error/empty (no join-ping mis-routes to empty-capture)");

// L4: the human-visible copy is correct.
const joinedRegion = iLife >= 0 ? I.slice(iLife, iLife + 900) : "";
if (!/is in \$\{title\} now/.test(joinedRegion)) fail("L4 'joined' must tell Nur the bot is in the room now");
else if (!/waiting room/i.test(joinedRegion) || !/admit/i.test(joinedRegion)) fail("L4 'waiting' must tell Nur to admit the bot from the waiting room");
else ok("L4 joined='in the room now', waiting='admit me from the waiting room'");

// L5: no constraint-violating status value.
if (/status:\s*["'](in_call|waiting)["']/.test(I)) fail("L5 must NOT write status in_call/waiting (violates digital_u_meetings_status_check)");
else if (!/status:\s*["']transcribing["']/.test(I)) fail("L5 joined should advance the ledger to the allowed 'transcribing' status");
else ok("L5 only allowed status values written (joined→transcribing, waiting→none)");

if (process.exitCode) console.error("\nWALL RED."); else console.log("\nWALL GREEN.");
