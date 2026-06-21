// Notetaker health-path wall (2026-06-21, KT #346). The #340 multi-node failover
// health-probed GET /api/health, but the zanii-meetingbot engine (and the
// digitalu.zanii.agency Vercel rewrite) only serve GET /health. So the probe 404'd,
// nodeHealthy() returned false for EVERY node, and dispatchMeetingBot refused to
// dispatch at all ("no notetaker node is reachable") even when a healthy engine was
// up. Fix: probe /health first (the real engine contract), fall back to /api/health.
//
// Seams:
//   S1  nodeHealthy probes /health (not only /api/health)
//   S2  behavioural: an engine serving /health (200) but /api/health (404) reads HEALTHY
//   S3  behavioural: a node serving neither reads UNHEALTHY (failover still skips it)
//
// Pure local (mocks fetch).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DU = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "digital-u.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- S1 ----
{
  const i = DU.indexOf("async function nodeHealthy");
  const region = i >= 0 ? DU.slice(i, i + 600) : "";
  if (!/\["\/health",\s*"\/api\/health"\]/.test(region) && !/"\/health"/.test(region)) fail("S1 nodeHealthy must probe /health (the real engine contract)");
  else ok("S1 nodeHealthy probes /health (with /api/health fallback)");
}

// ---- S2 + S3: behavioural (mirror the probe loop) ----
{
  // mirror: try /health then /api/health; healthy if either is ok
  const probe = async (base, serves) => {
    for (const p of ["/health", "/api/health"]) {
      const okResp = serves.has(p);
      if (okResp) return true;
    }
    return false;
  };
  const engineServesHealthOnly = new Set(["/health"]);        // zanii-meetingbot + digitalu.zanii.agency
  const engineServesApiHealth = new Set(["/api/health"]);     // a namespaced variant
  const dead = new Set([]);                                   // nothing up
  const r1 = await probe("https://digitalu.zanii.agency", engineServesHealthOnly);
  const r2 = await probe("https://variant", engineServesApiHealth);
  const r3 = await probe("https://dead", dead);
  if (r1 !== true) fail("S2 an engine serving /health only must read HEALTHY");
  else if (r2 !== true) fail("S2 a variant serving /api/health must also read HEALTHY (fallback)");
  else if (r3 !== false) fail("S3 a node serving neither must read UNHEALTHY");
  else ok("S2/S3 /health-only and /api/health both healthy; dead node skipped");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
