// LIBRARY DOMAIN wall (2026-06-26). The 8th specialist: resource & link curation, the
// dominant "other" behavior in the transcript (~25% of unclassified messages were "save
// this link/article" or "find me X again"). Locks the wiring so the domain can't silently
// regress: type + manifest + focus + router + intake hint + 4 UNIQUE tools (save write,
// 3 reads) over agent_memory kind="resource" (no migration). Source-structure asserts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const R = (p) => fs.readFileSync(path.resolve(HERE, "..", "..", p), "utf8");
const MAN = R("lib/agents/manifests/index.ts");
const SPEC = R("lib/agents/specialists/index.ts");
// Routing patterns live in router-patterns.ts (extracted for testability); read both.
const ROUTER = R("lib/agents/router.ts") + "\n" + R("lib/agents/router-patterns.ts");
const INTAKE = R("lib/agents/intake-pipeline.ts");
const TOOLS = R("lib/smart-tools.ts");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

const LIB_TOOLS = ["save_resource", "search_resources", "get_resource", "list_resources"];

// ---- L1: the domain type + manifest ----
{
  if (!/export type Domain = [^;]*\|\s*"library"/.test(MAN)) fail("L1a 'library' must be in the Domain union");
  else ok("L1a Domain union includes library");
  if (!/export const LIBRARY_MANIFEST: DomainManifest = \{/.test(MAN)) fail("L1b LIBRARY_MANIFEST must exist");
  else ok("L1b LIBRARY_MANIFEST defined");
  if (!/library: LIBRARY_MANIFEST/.test(MAN)) fail("L1c MANIFESTS map must include library");
  else ok("L1c MANIFESTS map wired");
}

// ---- L2: the 4 tools are present and UNIQUE to library (isolation wall) ----
{
  for (const t of LIB_TOOLS) {
    const inManifest = (MAN.match(new RegExp(`"${t}"`, "g")) || []).length;
    if (inManifest !== 1) fail(`L2 ${t} must appear in EXACTLY one manifest slot (found ${inManifest}) — tool reuse breaks isolation`);
    else ok(`L2 ${t} is unique to library`);
  }
}

// ---- L3: tool schemas + dispatch implementations exist ----
{
  for (const t of LIB_TOOLS) {
    if (!new RegExp(`name: "${t}"`).test(TOOLS)) fail(`L3a ${t} missing a tool schema definition`);
    else ok(`L3a ${t} schema defined`);
  }
  // save_resource is a WRITE (has its own dispatch + writes agent_memory kind="resource")
  if (!/if \(name === "save_resource"\)/.test(TOOLS)) fail("L3b save_resource needs a write dispatch handler");
  else ok("L3b save_resource has a write handler");
  if (!/kind: "resource"/.test(TOOLS)) fail("L3c save_resource must store under agent_memory kind='resource' (no migration)");
  else ok("L3c save_resource writes kind='resource'");
  // the 3 reads are routed through runRead and registered in READ_TOOLS
  if (!/"search_resources", "get_resource", "list_resources"/.test(TOOLS)) fail("L3d the 3 reads must be in READ_TOOLS");
  else ok("L3d reads registered in READ_TOOLS");
  if (!/name === "search_resources" \|\| name === "list_resources" \|\| name === "get_resource"/.test(TOOLS)) fail("L3e reads need a runRead handler");
  else ok("L3e reads have a runRead handler");
}

// ---- L4: focus, router patterns, intake hint ----
{
  if (!/library: `DOMAIN SPECIALIST \(HARD WALL\): You are Sasa's Library specialist/.test(SPEC)) fail("L4a DOMAIN_FOCUS.library missing");
  else ok("L4a library focus present");
  if (!/domain: "library",\s*patterns: \[/.test(ROUTER.replace(/\s+/g, " "))) fail("L4b router must have a library pattern block");
  else ok("L4b router library patterns present");
  if (!/library: "This appears to be a link\/article\/resource/.test(INTAKE)) fail("L4c intake domainHints.library missing");
  else ok("L4c intake hint present");
}

// ---- L5: files are findable too — search spans resource AND asset kinds ----
{
  const WORKER = R("app/api/whatsapp/worker/route.ts");
  if (!/\.in\("kind", \["resource", "asset"\]\)/.test(TOOLS)) fail("L5a library search must span kind IN (resource, asset) so captured files are findable");
  else ok("L5a search spans links + captured files");
  // operator directive: team works with these children -> no consent filter on the library lane
  if (/tier === "team"[\s\S]{0,80}BENEFICIARY:/.test(TOOLS)) fail("L5b the library lane must NOT re-add a team consent filter (operator directive)");
  else ok("L5b team may recall files (no consent filter on library lane)");
  // worker files inbound media as a searchable asset row, for BOTH tiers now
  if (!/if \(stored\.assetId\) \{[\s\S]{0,400}kind: "asset"/.test(WORKER)) fail("L5c worker must file inbound media as a searchable asset row (both tiers)");
  else ok("L5c inbound media filed for recall (admin + team)");
}

// ---- L6: send_resource — actually send a saved file back, honestly, to the requester ----
{
  if ((MAN.match(/"send_resource"/g) || []).length !== 1) fail("L6a send_resource must be unique to the library manifest");
  else ok("L6a send_resource in library manifest");
  if (!/name: "send_resource"/.test(TOOLS)) fail("L6b send_resource schema missing");
  else ok("L6b send_resource schema defined");
  const sr = TOOLS.slice(TOOLS.indexOf('if (name === "send_resource")'), TOOLS.indexOf('if (name === "send_resource")') + 2600);
  if (!/if \(!ctx\.senderPhone\)/.test(sr)) fail("L6c send_resource must only send to the requester (ctx.senderPhone), not arbitrary people");
  else ok("L6c send_resource sends only to the requester");
  if (!/if \(!res\?\.id\) return \{ ok: false/.test(sr)) fail("L6d send_resource must claim a send ONLY when WhatsApp returns a message id (honesty)");
  else ok("L6d send_resource is honest about delivery");
}

// ---- B1: honesty — save_resource refuses without a url, never invents ----
{
  const sr = TOOLS.slice(TOOLS.indexOf('if (name === "save_resource")'), TOOLS.indexOf('if (name === "save_resource")') + 400);
  if (!(/if \(!url\) return \{ ok: false/.test(sr) && /error: "no url"/.test(sr))) fail("B1 save_resource must refuse (ok:false, error 'no url') when no url/reference given");
  else ok("B1 save_resource refuses empty input (no invented link)");
}
