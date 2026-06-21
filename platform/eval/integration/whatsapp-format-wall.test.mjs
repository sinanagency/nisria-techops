// WhatsApp outbound format wall (2026-06-21, KT #360). Two real bugs in the send
// path: (1) the model emits Markdown and WhatsApp renders the literal symbols
// (**stars**, ### hashes, [label](url) brackets, pipe tables), and (2) sendText
// hard-sliced at 4096 chars, SILENTLY dropping the rest of a long reply. Fix: a
// deterministic normalizer at the one text chokepoint (sendText) that converts
// Markdown to WhatsApp formatting and splits long text into ordered bubbles, never
// silent loss. Pure functions live in lib/whatsapp-format.mjs so this wall tests
// the REAL code (imported, not a drifting mirror).
//
// Seams:
//   F1  formatWhatsApp converts every Markdown construct WhatsApp can't render
//   F2  formatWhatsApp is idempotent and never invents emphasis
//   F3  splitForWhatsApp never exceeds 4096, never breaks mid-word, marks order
//   F4  splitForWhatsApp never silently drops content (honest cap, all text kept)
//   F5  the send seam (sendText) actually calls format + split before send()

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatWhatsApp, splitForWhatsApp, formatAndSplit } from "../../lib/whatsapp-format.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const W = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "whatsapp.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);
const eq = (label, got, want) => { if (got !== want) fail(`${label}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`); else ok(label); };

// ---- F1: Markdown -> WhatsApp conversion ----
eq("F1 bold ** -> *", formatWhatsApp("hello **world**"), "hello *world*");
eq("F1 bold __ -> *", formatWhatsApp("a __b__ c"), "a *b* c");
eq("F1 single-char bold", formatWhatsApp("**x**"), "*x*");
eq("F1 heading -> bold line", formatWhatsApp("## Weekly Report"), "*Weekly Report*");
eq("F1 heading strips inner stars", formatWhatsApp("### **Donors**"), "*Donors*");
eq("F1 bullets - -> bullet dot", formatWhatsApp("- one\n- two"), "• one\n• two");
eq("F1 star bullet -> dot", formatWhatsApp("* item"), "• item");
eq("F1 link -> label (url)", formatWhatsApp("see [Nisria](https://nisria.co)"), "see Nisria (https://nisria.co)");
eq("F1 image -> alt (url)", formatWhatsApp("![logo](https://x.co/a.png)"), "logo (https://x.co/a.png)");
eq("F1 strike ~~ -> ~", formatWhatsApp("~~gone~~"), "~gone~");
eq("F1 inline code ticks stripped", formatWhatsApp("run `npm test` now"), "run npm test now");
eq("F1 horizontal rule dropped", formatWhatsApp("a\n\n---\n\nb"), "a\n\nb");
eq("F1 blank lines collapsed", formatWhatsApp("a\n\n\n\nb"), "a\n\nb");
// table: separator row dropped, pipes made readable
{
  const got = formatWhatsApp("| Name | Age |\n|------|-----|\n| Grace | 12 |");
  if (/\|---/.test(got) || /^\s*\|/.test(got)) fail("F1 table separator/leading pipes must be gone");
  else if (!/Name/.test(got) || !/Grace/.test(got) || !/12/.test(got)) fail("F1 table content must survive");
  else ok("F1 table flattened (separator dropped, content kept, no leading pipe)");
}
// code fence preserved (WhatsApp supports ```), language hint stripped
{
  const got = formatWhatsApp("```js\nconst x = 1;\n```");
  if (!/```/.test(got)) fail("F1 code fence must be preserved (WhatsApp monospace)");
  else if (/```js/.test(got)) fail("F1 code fence language hint must be stripped");
  else if (!/const x = 1;/.test(got)) fail("F1 code inside fence must be untouched");
  else ok("F1 code fence kept, language hint stripped, inner code intact");
}

// ---- F2: idempotent + never invents emphasis ----
{
  const once = formatWhatsApp("## Hi\n- **x** and __y__ and ~~z~~\nsee [a](http://b.co)");
  const twice = formatWhatsApp(once);
  if (once !== twice) fail(`F2 must be idempotent\n   once:  ${JSON.stringify(once)}\n   twice: ${JSON.stringify(twice)}`);
  else ok("F2 idempotent (running twice is a no-op)");
}
eq("F2 empty bold not invented", formatWhatsApp("** **"), "** **");
eq("F2 plain text untouched", formatWhatsApp("just a normal sentence."), "just a normal sentence.");

// ---- F3: split never exceeds 4096, never mid-word, marks order ----
{
  const long = Array.from({ length: 300 }, (_, i) => `Paragraph ${i} carries a handful of words to take up real space here.`).join("\n\n");
  const chunks = splitForWhatsApp(long);
  if (chunks.length < 2) fail("F3 a long message must split into multiple bubbles");
  else if (!chunks.every((c) => c.length <= 4096)) fail("F3 every chunk must be <= 4096 (WhatsApp hard limit)");
  else if (!/\(1\/\d+\)\s*$/.test(chunks[0])) fail("F3 multi-bubble chunks must carry an (i/n) order marker");
  else if (!/\(\d+\/\d+\)\s*$/.test(chunks[chunks.length - 1])) fail("F3 last chunk must also carry the marker");
  else ok(`F3 long text split into ${chunks.length} ordered bubbles, all <= 4096`);
}
eq("F3 short text stays one chunk", splitForWhatsApp("hi").length, 1);
eq("F3 short text gets no marker", splitForWhatsApp("hi")[0], "hi");
{
  // a single enormous word (no spaces) must still chunk under the limit (hard split)
  const huge = "x".repeat(9000);
  const chunks = splitForWhatsApp(huge);
  if (!chunks.every((c) => c.length <= 4096)) fail("F3 a no-space giant must hard-split under 4096");
  else ok("F3 no-space giant hard-splits under the limit");
}

// ---- F4: never silently drops content ----
{
  // reconstruct: strip the (i/n) markers and the bullet/format noise is N/A here
  // (plain paragraphs in, plain paragraphs out), so all source words must survive.
  const paras = Array.from({ length: 120 }, (_, i) => `Unique token ZZ${i} sits inside paragraph number ${i} with filler words around it.`);
  const long = paras.join("\n\n");
  const chunks = splitForWhatsApp(long);
  const joined = chunks.map((c) => c.replace(/\n\n\(\d+\/\d+\)\s*$/, "")).join("\n\n");
  const missing = paras.filter((_, i) => !joined.includes(`ZZ${i}`));
  if (missing.length) fail(`F4 split dropped ${missing.length} paragraphs silently (e.g. ZZ${paras.findIndex((_, i) => !joined.includes("ZZ" + i))})`);
  else ok("F4 every paragraph survives the split (no silent loss)");
}
{
  // pathological flood: enough content to blow past the safety cap must end with an
  // honest "ask me to continue", never a silent truncation.
  const flood = Array.from({ length: 4000 }, (_, i) => `Sentence ${i} with several words here to force many chunks.`).join("\n\n");
  const chunks = splitForWhatsApp(flood);
  if (chunks.length > 12) fail("F4 the safety cap must bound the bubble count");
  else if (chunks.length === 12 && !/too long to send in full/i.test(chunks[chunks.length - 1])) fail("F4 a capped flood must say so honestly, not drop silently");
  else ok(`F4 flood bounded to ${chunks.length} bubbles with an honest tail (no silent drop)`);
}

// ---- F5: the send seam actually wires format + split ----
{
  if (!/import \{ formatWhatsApp, splitForWhatsApp \} from "\.\/whatsapp-format\.mjs"/.test(W)) fail("F5 whatsapp.ts must import the formatter");
  const i = W.indexOf("export async function sendText");
  const region = i >= 0 ? W.slice(i, i + 2200) : "";
  if (!region) fail("F5 sendText must exist");
  else if (!/splitForWhatsApp\(formatWhatsApp\(String\(body\)\)\)/.test(region)) fail("F5 sendText must format THEN split the body before send()");
  else if (!/chunks\.length <= 1/.test(region)) fail("F5 sendText must single-send when one chunk, loop when many");
  else if (!/partial_send:/.test(region)) fail("F5 a mid-sequence chunk failure must return an honest partial_send error, never report chunk-1 as full success");
  else if (!/sasa\.partial_chunk_send/.test(region)) fail("F5 a partial send must emit an observable event for the soak watch");
  else if (!/\.slice\(0, 4096\)/.test(region)) fail("F5 each sent body must keep the 4096 hard floor as belt-and-suspenders");
  else ok("F5 send seam: sendText formats + splits, single-or-loop, partial-send is honest, 4096 floor");
}

// sanity: formatAndSplit is the composed transform
eq("F5 formatAndSplit composes", formatAndSplit("**hi**")[0], "*hi*");

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
