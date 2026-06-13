// nisria platform transcribe primary-with-fallback test.
//
// The adapter at lib/transcribe.ts wraps @sinanagency/intake's transcribeAudio
// primitive with:
//   - 5s timeout race on the primary URL (TRANSCRIBE_PRIMARY_URL)
//   - fallback to hosted OpenAI on timeout / error / empty
//   - structured console.info log { kind, path, elapsed_ms, ok }
//   - existing base64-in / Promise<string>-out signature preserved
//
// We can't execute the .ts directly without tsx, so this test does two things:
//   1) Behaviorally: replicates the adapter logic against the *real* intake
//      dist/transcribe.js with a mocked fetch.
//   2) Structurally: asserts the adapter source includes the same control
//      flow markers (TRANSCRIBE_PRIMARY_URL read, withTimeout race, path
//      labels, no key leak in logs, return signature preserved).
//
// Skeptic-pass: remove the fallback or the primary branch from lib/transcribe.ts
// and re-run; this script must fail red.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { transcribeAudio as intakeTranscribeAudio } from "../lib/intake/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const adapterPath = path.resolve(here, "../lib/transcribe.ts");
const adapterSrc = readFileSync(adapterPath, "utf8");

const PRIMARY_TIMEOUT_MS = 5000;

async function withTimeout(p, ms) {
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve({ text: "", timedOut: true }), ms);
  });
  const main = p.then((text) => ({ text, timedOut: false }));
  try {
    return await Promise.race([main, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// Mirror of the nisria adapter: base64 in, string out, empty on failure.
async function adapterRun(base64, mime, opts) {
  const { key, primaryUrl, timeoutMs } = opts;
  if (!key) return { result: "", calls: [] };
  const calls = [];
  const safeMime = mime || "audio/ogg";

  if (primaryUrl) {
    const { text, timedOut } = await withTimeout(
      intakeTranscribeAudio(base64, safeMime, { openaiKey: key, baseUrl: primaryUrl }),
      timeoutMs ?? PRIMARY_TIMEOUT_MS
    );
    const trimmed = (text || "").trim();
    calls.push({ path: "primary", ok: !!trimmed && !timedOut, timedOut });
    if (trimmed && !timedOut) {
      return { result: trimmed, calls };
    }
  }

  const out = await intakeTranscribeAudio(base64, safeMime, { openaiKey: key });
  calls.push({ path: primaryUrl ? "fallback" : "openai", ok: !!(out || "").trim() });
  return { result: out || "", calls };
}

const origFetch = global.fetch;
function setFetch(handler) {
  const observed = [];
  global.fetch = async (url, init) => {
    observed.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return observed;
}
function ok(text) { return { ok: true, json: async () => ({ text }) }; }
function err(status, msg) { return { ok: false, status, json: async () => ({ error: { message: msg || "bad" } }) }; }
function hang() { return new Promise(() => {}); }

const FAKE_B64 = Buffer.from("fake").toString("base64");

// ---------- Behavioral ----------

test("primary success skips fallback", async () => {
  const observed = setFetch((url) => {
    if (url.startsWith("https://primary.example/")) return ok("local hello");
    return ok("openai hello");
  });
  const { result, calls } = await adapterRun(FAKE_B64, "audio/ogg", {
    key: "k", primaryUrl: "https://primary.example",
  });
  assert.equal(result, "local hello");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "primary");
  assert.equal(observed.length, 1);
});

test("primary timeout triggers fallback to OpenAI", async () => {
  let n = 0;
  const observed = setFetch((url) => {
    n++;
    if (n === 1) return hang();
    return ok("openai rescued");
  });
  const { result, calls } = await adapterRun(FAKE_B64, "audio/ogg", {
    key: "k", primaryUrl: "https://primary.example", timeoutMs: 30,
  });
  assert.equal(result, "openai rescued");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].timedOut, true);
  assert.equal(calls[1].path, "fallback");
  assert.ok(observed[1].url.startsWith("https://api.openai.com/"));
});

test("primary 500 triggers fallback", async () => {
  setFetch((url) => {
    if (url.startsWith("https://primary.example/")) return err(500);
    return ok("openai rescued");
  });
  const { result, calls } = await adapterRun(FAKE_B64, "audio/ogg", {
    key: "k", primaryUrl: "https://primary.example",
  });
  assert.equal(result, "openai rescued");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].path, "fallback");
});

test("primary network error triggers fallback", async () => {
  let n = 0;
  setFetch(() => {
    n++;
    if (n === 1) throw new Error("ENOTFOUND");
    return ok("openai rescued");
  });
  const { result, calls } = await adapterRun(FAKE_B64, "audio/ogg", {
    key: "k", primaryUrl: "https://primary.example",
  });
  assert.equal(result, "openai rescued");
  assert.equal(calls[1].path, "fallback");
});

test("no primary URL configured -> direct OpenAI", async () => {
  const observed = setFetch(() => ok("openai direct"));
  const { result, calls } = await adapterRun(FAKE_B64, "audio/ogg", {
    key: "k", primaryUrl: "",
  });
  assert.equal(result, "openai direct");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "openai");
  assert.ok(observed[0].url.startsWith("https://api.openai.com/"));
});

test("primary tried FIRST when configured", async () => {
  const observed = setFetch((url) => {
    if (url.startsWith("https://primary.example/")) return ok("primary first");
    return ok("openai");
  });
  await adapterRun(FAKE_B64, "audio/ogg", {
    key: "k", primaryUrl: "https://primary.example",
  });
  assert.ok(observed[0].url.startsWith("https://primary.example/"));
});

test("missing key returns '' without any fetch", async () => {
  const observed = setFetch(() => ok("nope"));
  const { result, calls } = await adapterRun(FAKE_B64, "audio/ogg", {
    key: "", primaryUrl: "https://primary.example",
  });
  assert.equal(result, "");
  assert.equal(calls.length, 0);
  assert.equal(observed.length, 0);
});

// ---------- Structural ----------

test("adapter source reads TRANSCRIBE_PRIMARY_URL env var", () => {
  assert.match(adapterSrc, /TRANSCRIBE_PRIMARY_URL/);
});

test("adapter source declares a 5-second timeout constant", () => {
  assert.match(adapterSrc, /PRIMARY_TIMEOUT_MS\s*=\s*5000/);
});

test("adapter source uses Promise.race / withTimeout for the timeout", () => {
  const hasRace = /Promise\.race/.test(adapterSrc) || /withTimeout\(/.test(adapterSrc);
  assert.ok(hasRace);
});

test("adapter source labels 'primary' and 'fallback' paths", () => {
  assert.match(adapterSrc, /["']primary["']/);
  assert.match(adapterSrc, /["']fallback["']/);
});

test("adapter source includes elapsed_ms in structured log", () => {
  assert.match(adapterSrc, /elapsed_ms/);
});

test("adapter source passes baseUrl to the intake primitive", () => {
  assert.match(adapterSrc, /baseUrl:\s*primaryUrl/);
});

test("adapter source does not log the openai key", () => {
  const dangerous = /console\.[a-z]+\([^)]*openaiKey/.test(adapterSrc) ||
                    /console\.[a-z]+\([^)]*key:/.test(adapterSrc);
  assert.ok(!dangerous);
});

test("adapter preserves Promise<string> return signature", () => {
  assert.match(adapterSrc, /Promise<string>/);
});

test.after(() => { global.fetch = origFetch; });
