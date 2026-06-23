// 727 cartography batch-4 wall (2026-06-23). Closes the last residuals:
//   KT #386 — exact-name preference on the remaining intake-edit resolvers (update_beneficiary,
//             update_contact, update_inventory_item, the case tools): pick the EXACTLY-named
//             record over a longer-substring sibling instead of shadowing/asking. Never worse.
//   KT #387 — digital-u-sweep reserve-before-dispatch: claim the gmail_id BEFORE dispatching the
//             meeting bot, so a ledger failure can't let the next tick double-dispatch; release
//             the claim on dispatch failure (no silent never-join).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { preferExact } from "../../lib/resolve-name.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ST = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "smart-tools.ts"), "utf8");
const DU = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "digital-u-sweep.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- P1: preferExact narrows to the unique exact match ----
{
  const list = [{ id: "a", full_name: "Ahmed" }, { id: "b", full_name: "Ahmed Khan" }];
  const r = preferExact(list, "ahmed", "full_name");
  if (r.length !== 1 || r[0].id !== "a") fail("P1 exact match must be preferred over a longer-substring sibling");
  else ok("P1 preferExact → unique exact match wins over substring");
}

// ---- P2: never worse — no exact match returns the list unchanged ----
{
  const list = [{ id: "a", full_name: "Ahmed Khan" }, { id: "b", full_name: "Ahmed Said" }];
  const r = preferExact(list, "ahmed", "full_name");
  if (r.length !== 2) fail("P2 no exact match must return the full list unchanged (still asks on >1)");
  else ok("P2 no exact → list unchanged (never worse)");
  // two exact same-name → unchanged (so the caller still asks — identity)
  const dup = [{ id: "a", full_name: "Ahmed" }, { id: "b", full_name: "Ahmed" }];
  if (preferExact(dup, "ahmed", "full_name").length !== 2) fail("P2b two exact same-name must stay >1 → ask (identity)");
  else ok("P2b two exact same-name → unchanged (caller asks, identity-safe)");
}

// ---- P3: all five resolvers route through preferExact ----
{
  const n = (ST.match(/const list(?:: any\[\])? = preferExact\(/g) || []).length;
  if (n < 5) fail(`P3 expected >=5 resolvers wired through preferExact, found ${n}`);
  else ok(`P3 ${n} intake-edit resolvers use exact-name preference`);
  if (!/import \{ classifyNameMatch, isBareFirstName, preferExact \} from "\.\/resolve-name\.mjs";/.test(ST))
    fail("P3b smart-tools must import preferExact");
  else ok("P3b smart-tools imports preferExact");
}

// ---- P4: digital-u reserves BEFORE dispatch + releases on failure ----
{
  const reserveIdx = DU.indexOf('insert({ gmail_id: hit.id, outcome: "dispatching" })');
  const dispatchIdx = DU.indexOf("const r = await dispatchMeetingBot(");
  if (reserveIdx < 0) fail("P4a must reserve the claim (outcome 'dispatching') before dispatch");
  else ok("P4a reserves the gmail_id before dispatch");
  if (!(reserveIdx > 0 && dispatchIdx > reserveIdx)) fail("P4b the reserve insert must come BEFORE dispatchMeetingBot");
  else ok("P4b reserve precedes dispatch (no double-dispatch on ledger failure)");
  if (!/if \(reserveErr\) \{ errors\.push/.test(DU)) fail("P4c a failed reserve must skip dispatch (not silently double)");
  else ok("P4c failed reserve → skip dispatch");
  if (!/delete\(\)\.eq\("gmail_id", hit\.id\)\.eq\("outcome", "dispatching"\)/.test(DU)) fail("P4d a dispatch failure must RELEASE the claim for retry");
  else ok("P4d dispatch failure releases the claim (no silent never-join)");
  // the OLD post-dispatch-only insert must be gone
  if (/insert\(\{ gmail_id: hit\.id, outcome: "dispatched"/.test(DU)) fail("P4e the old post-dispatch insert-as-latch must be replaced by an update");
  else ok("P4e 'dispatched' is now an UPDATE of the reserved row, not a fresh insert");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
