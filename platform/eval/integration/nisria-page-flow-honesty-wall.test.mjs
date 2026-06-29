// Third-pass page/flow wall — batch 1 (2026-06-29).
// H-1: the Memory page is a read-only Brain viewer — it must NOT host the DispatchBox (which
//      creates tasks + emails staff), or "save a memory" silently fires the wrong action.
// H-4: the Workspace send must not mark the inbound thread answered when the email send failed.
// M-1: the inbox "+ Add account" must point at /settings (where the connect action lives), not /team.
// L-1: team/[id] must 404 an unknown id, not render a phantom profile bound to a dead id.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const rd = (...p) => fs.readFileSync(path.resolve(HERE, "..", "..", ...p), "utf8");
const MEM = rd("app", "memory", "page.tsx");
const WS = rd("app", "workspace", "actions.ts");
const INB = rd("app", "inbox", "page.tsx");
const TM = rd("app", "team", "[id]", "page.tsx");
const SC = rd("components", "SmartConsole.tsx");
const RA = rd("components", "ReportArchive.tsx");
const RES = rd("app", "resources", "page.tsx");
const BEN = rd("app", "beneficiaries", "page.tsx");
const LIB = rd("app", "library", "page.tsx");
const FIL = rd("app", "filing", "page.tsx");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- H-1 ----
{
  if (/<DispatchBox\s*\/>/.test(MEM)) fail("H-1a the Memory viewer must NOT render <DispatchBox/> (it creates tasks + emails staff)");
  else ok("H-1a Memory page no longer renders DispatchBox");
  if (/import DispatchBox/.test(MEM)) fail("H-1b drop the now-unused DispatchBox import from the Memory page");
  else ok("H-1b DispatchBox import removed");
}

// ---- H-4 ----
{
  if (!/if \(contact_id && status !== "failed"\) await admin\(\)\.from\("messages"\)\.update\(\{ status: "replied" \}\)/.test(WS))
    fail("H-4 workspace sendChat must only close the inbound thread when the send did not fail");
  else ok("H-4 workspace send closes the thread only on a non-failed send");
}

// ---- M-1 ----
{
  if (/<a href="\/team"[^>]*>\+ Add account<\/a>/.test(INB)) fail("M-1a inbox '+ Add account' must not point at /team (no connect UI there)");
  else ok("M-1a inbox '+ Add account' no longer points at /team");
  if (!/<a href="\/settings"[^>]*title="Connect another mailbox or channel"[^>]*>\+ Add account<\/a>/.test(INB)) fail("M-1b inbox '+ Add account' must point at /settings");
  else ok("M-1b inbox '+ Add account' points at /settings");
}

// ---- L-1 ----
{
  if (!/import \{ notFound \} from "next\/navigation";/.test(TM)) fail("L-1a team/[id] must import notFound");
  else ok("L-1a team/[id] imports notFound");
  if (!/if \(!row\) notFound\(\);/.test(TM)) fail("L-1b team/[id] must 404 an unknown id, not render a phantom profile");
  else ok("L-1b team/[id] 404s an unknown id");
}

// ---- H-2: Smart drop no longer fabricates a "Saved" card ----
{
  if (/I'll add this to the Library and caption it|I'll file this to the Library/.test(SC))
    fail("H-2a the file-drop must not promise it filed a file it never uploaded");
  else ok("H-2a Smart drop no longer claims it filed the dropped file");
  const di = SC.indexOf("function onDrop");
  const region = di >= 0 ? SC.slice(di, di + 900) : "";
  if (/affordance: aff/.test(region)) fail("H-2b the drop must not push a 'Done. Saved in the platform.' affordance card");
  else ok("H-2b the drop pushes no fake success card");
  if (!/can't capture a dropped file here yet/.test(SC)) fail("H-2c the drop must honestly say it can't capture the file yet and point to a real upload");
  else ok("H-2c the drop tells the truth and points to a real upload path");
}

// ---- M-6: report archive renders an empty state, not null ----
{
  if (/if \(!rows\.length\) return null;/.test(RA)) fail("M-6a ReportArchive must not return null on empty (dangling header + blank tab)");
  else ok("M-6a ReportArchive no longer returns null on empty");
  if (!/if \(!rows\.length\) return <div className="empty">/.test(RA)) fail("M-6b ReportArchive must render an empty state when there are no reports");
  else ok("M-6b ReportArchive renders an empty state");
}

// ---- M-3: resources no-match empty state ----
{
  if (!/allLinks\.length > 0 && grouped\.length === 0 &&/.test(RES)) fail("M-3 resources must show a no-match card when a search/filter matches nothing");
  else ok("M-3 resources renders a no-match empty state");
}

// ---- L-3: beneficiaries rescue count matches its active-only link ----
{
  if (/const rescueInCare = rescue\.filter\(\(r: any\) => \(r\.status \|\| ""\) !== "transitioned"\)/.test(BEN)) fail("L-3 the rescue 'in care now' count must not include exited/paused (it links to status:active)");
  else if (!/const rescueInCare = rescue\.filter\(\(r: any\) => \(r\.status \|\| ""\) === "active"\)/.test(BEN)) fail("L-3 the rescue 'in care now' count must be active-only to match its link");
  else ok("L-3 rescue tile count is active-only (matches the link)");
}

// ---- L-4: library Drive badge gated on the real env ----
{
  if (!/process\.env\.GOOGLE_SERVICE_ACCOUNT_B64 \? <Badge tone="green">connected<\/Badge> : <Badge tone="gray">not connected<\/Badge>/.test(LIB)) fail("L-4 the Drive badge must be gated on the real service-account env, not hardcoded connected");
  else ok("L-4 Drive badge reflects the real env");
}

// ---- L-5: filing search shows 50+ instead of silently dropping rows ----
{
  if (/\.limit\(50\);/.test(FIL)) fail("L-5 filing search must not hard-cap at 50 with no indicator");
  else ok("L-5 filing search no longer hard-caps at 50 silently");
  if (!/const capped = allResults\.length > 50;/.test(FIL)) fail("L-5b filing must detect the cap");
  else ok("L-5b filing detects the 50+ cap");
  if (!/\$\{capped \? "50\+" : results\.length\}/.test(FIL)) fail("L-5c the heading must say 50+ when capped");
  else ok("L-5c filing heading honestly says 50+ when capped");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
