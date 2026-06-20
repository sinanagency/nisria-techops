// Operator-never-ambiguous wall (2026-06-21, KT #341). The live break: Taona told
// the bot "tell her (Nur) to give more context" and it refused THREE times with
// "two duplicate Nur contacts... which one is real?" — because Nur had a stray
// malformed-lid duplicate row (phone 106274704363640) alongside her real +971
// number, so the de-duped match set had 2 distinct phone keys. Nur is the OPERATOR:
// the bot always knows how to reach her. Fix: when >1 name match survives de-dup
// but EXACTLY ONE is a known operator number (WHATSAPP_OPERATORS / OWNER_WHATSAPP),
// resolve to that one instead of asking. Genuine two-stranger ambiguity still asks.
//
// Seams:
//   S1  operatorKeySet + preferOperatorMatch helpers exist in smart-tools
//   S2  message_person consults preferOperatorMatch before the ambiguous refusal
//   S3  send_file_to_person consults preferOperatorMatch before the ambiguous refusal
//   S4  behavioural: operator-among-matches resolves to the operator; two
//       non-operators stay ambiguous (null); two operators stay ambiguous (null)
//
// Pure local.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SMART = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "smart-tools.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- S1 ----
if (!/function operatorKeySet\(/.test(SMART) || !/function preferOperatorMatch\(/.test(SMART)) fail("S1 smart-tools must define operatorKeySet + preferOperatorMatch");
else ok("S1 operator-prefer helpers present");

// ---- S2 ----
{
  const i = SMART.indexOf('if (name === "message_person")');
  const region = i >= 0 ? SMART.slice(i, i + 2400) : "";
  if (!/preferOperatorMatch\(uniq\)/.test(region)) fail("S2 message_person must call preferOperatorMatch before refusing as ambiguous");
  else if (!/uniq\.length > 1 && !opPick/.test(region)) fail("S2 the ambiguous refusal must be skipped when an operator match exists");
  else ok("S2 message_person prefers the operator before asking");
}

// ---- S3 ----
{
  const i = SMART.indexOf('if (name === "send_file_to_person")');
  const region = i >= 0 ? SMART.slice(i, i + 2400) : "";
  if (!/preferOperatorMatch\(uniq\)/.test(region)) fail("S3 send_file_to_person must call preferOperatorMatch before refusing as ambiguous");
  else if (!/uniq\.length > 1 && !opPick/.test(region)) fail("S3 the ambiguous refusal must be skipped when an operator match exists");
  else ok("S3 send_file_to_person prefers the operator before asking");
}

// ---- S4: behavioural model (mirror the helpers exactly) ----
{
  const phoneKey = (s) => String(s || "").replace(/\D/g, "").replace(/^00/, "");
  const OPERATORS = "971501622716,971501168462"; // Nur, Taona
  const operatorKeySet = () => new Set(`${OPERATORS},`.split(",").map(phoneKey).filter((k) => k.length >= 9));
  const preferOperatorMatch = (uniq) => {
    if (uniq.length <= 1) return null;
    const ops = operatorKeySet();
    const opMatches = uniq.filter((m) => ops.has(phoneKey(m.phone)));
    return opMatches.length === 1 ? opMatches[0] : null;
  };
  // the exact live incident: Nur's real +971 number vs the garbage lid duplicate
  const nurCase = [{ name: "Nur M’nasria", phone: "+971501622716" }, { name: "Nur M’nasria", phone: "106274704363640" }];
  const pick = preferOperatorMatch(nurCase);
  if (!pick || phoneKey(pick.phone) !== "971501622716") fail("S4 the Nur incident must resolve to her real operator number, not ask");
  else if (preferOperatorMatch([{ name: "Mark A", phone: "+254700000001" }, { name: "Mark B", phone: "+254700000002" }]) !== null) fail("S4 two non-operator strangers must STILL be ambiguous (return null)");
  else if (preferOperatorMatch([{ name: "Nur", phone: "+971501622716" }, { name: "Taona", phone: "+971501168462" }]) !== null) fail("S4 two operators must stay ambiguous (return null) — do not silently pick");
  else if (preferOperatorMatch([{ name: "Nur", phone: "00971501622716" }, { name: "Nur dup", phone: "106274704363640" }]) === null) fail("S4 the 00-prefixed operator form must also be recognised as the operator");
  else ok("S4 operator wins over a stray dup; real ambiguity still asks");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
