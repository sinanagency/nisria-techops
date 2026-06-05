// tool-schema-audit.eval.ts
//
// STATIC negative-eval over the actual tool definitions shipped to the model.
// No network, no DB, no platform-source import. Reads the source files at
// `platform/lib/smart-tools.ts` and `platform/lib/brain.ts` as PLAIN TEXT and
// extracts:
//
//   - enum value strings:                  enum: ["q1","q2","q3","q4"]
//   - param descriptions:                  description: "Never surface ..."
//   - tool descriptions:                   description: "Open tasks across ..."
//   - parameter names (top-level keys):    properties: { quadrant: { ... } }
//
// Each extracted string is scanned with the §7.1 forbidden-pattern suite from
// patterns.ts. Style-only patterns (em-dashes inside engineer-facing prose)
// are dropped — the model does not repeat engineer prose verbatim; the wall
// is around what the model SEES as a usable code, not what humans write in a
// code comment.
//
// Catches the "4Q" class of bug at its source: the leaked `enum: ["q1","q2","q3","q4"]`
// in smart-tools.ts:144 fires the storage-codes regex in CI and blocks the
// deploy. Per project_sasa_4q_leak_audit memory: "Sasa's own tool layer ...
// the leaked Q1/Q2 codes came from Claude seeing the enum, despite the 'never
// surface' description."
//
// Exit codes:
//   0 — clean
//   1 — at least one leak in tool-schema surface
//   2 — file missing / parse error

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { PATTERNS, compile, type ForbiddenPattern, type Severity } from "./patterns";

// ---------- types ----------

type SurfaceKind = "enum-value" | "description" | "param-name";

interface Surface {
  file: string;
  line: number;
  kind: SurfaceKind;
  text: string;
}

interface Hit {
  pattern_id: string;
  pattern_label: string;
  severity: Severity;
  spec_anchor: string;
  file: string;
  line: number;
  kind: SurfaceKind;
  text: string;
}

interface Report {
  bot: string;
  files_scanned: string[];
  surfaces_extracted: number;
  patterns_checked: number;
  hits: Hit[];
  summary: Record<Severity, number>;
  generated_at: string;
}

// ---------- config ----------

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const BOT_NAME = process.env.BOT_NAME ?? "nisria-sasa";

// Allow override for repo-relocation, default to the canonical paths per
// SPEC §1 (`Repo path: /Users/milaaj/Code/nisria-techops/platform`).
const PLATFORM_ROOT =
  process.env.NISRIA_PLATFORM_ROOT ??
  "/Users/milaaj/Code/nisria-techops/platform";

const TARGET_FILES = [
  join(PLATFORM_ROOT, "lib", "smart-tools.ts"),
  join(PLATFORM_ROOT, "lib", "brain.ts"),
];

const BLOCK_MEDIUM = process.env.NEG_EVAL_BLOCK_MEDIUM === "1";

// Style-only patterns are dropped from the static pass (they would false-fire
// inside engineer comments + JSDoc). The model only repeats VALUES (enums)
// and TEXT it is told to use (descriptions), not source-file prose.
const SCHEMA_PATTERNS: ForbiddenPattern[] = PATTERNS.filter(
  (p: ForbiddenPattern) => !p.id.startsWith("style."),
);

// ---------- surface extraction (regex over source text) ----------
//
// We deliberately use targeted regex over plain text instead of a TS parser.
// Reason: this eval lives in /Users/milaaj/Code/bots/ outside the platform's
// tsconfig; we cannot type-check platform code from here, and we do not want
// to require a build step just to run a safety check. The patterns below are
// chosen to be tight enough that false positives in non-tool-source files are
// rare; the cost of a false positive is a SPEC-trace investigation, the cost
// of a false negative is a production leak. We accept that cost asymmetry.

// enum: ["q1", "q2", "q3", "q4"]  → captures the array body, then split values.
const ENUM_RE = /\benum\s*:\s*\[([^\]]+)\]/g;

// description: "Open tasks ..."  → captures double-quoted value, ignoring
// escaped quotes. Sasa's source uses double-quoted strings exclusively.
const DESCRIPTION_RE = /\bdescription\s*:\s*"((?:\\.|[^"\\])*)"/g;

// properties: { quadrant: { ... }, status: { ... } }  →  capture top-level
// property keys inside a properties block. We match the open brace and walk
// to the matching close brace by counting depth, then pull bare-word keys.
const PROPERTIES_RE = /\bproperties\s*:\s*\{/g;

function lineOf(text: string, offset: number): number {
  // 1-based line number of `offset` inside `text`. Cheap and good-enough.
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function extractEnumValues(file: string, text: string): Surface[] {
  const out: Surface[] = [];
  ENUM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ENUM_RE.exec(text)) !== null) {
    const line = lineOf(text, m.index);
    const body = m[1];
    // Split on commas, then strip quotes/whitespace.
    for (const raw of body.split(",")) {
      const v = raw.trim();
      // Accept double- or single-quoted enum values.
      const q = v.match(/^["'](.+)["']$/);
      if (!q) continue;
      out.push({ file, line, kind: "enum-value", text: q[1] });
    }
  }
  return out;
}

function extractDescriptions(file: string, text: string): Surface[] {
  const out: Surface[] = [];
  DESCRIPTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DESCRIPTION_RE.exec(text)) !== null) {
    const line = lineOf(text, m.index);
    // Unescape \" and \\ so the regex sees what the model would see.
    const txt = m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    out.push({ file, line, kind: "description", text: txt });
  }
  return out;
}

// Walk balanced braces starting at `from` (position of the open '{').
// Returns the slice between { and matching }, exclusive.
function sliceBalanced(text: string, from: number): { body: string; end: number } | null {
  if (text[from] !== "{") return null;
  let depth = 0;
  let inStr: '"' | "'" | "`" | null = null;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c as '"' | "'" | "`";
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        return { body: text.slice(from + 1, i), end: i };
      }
    }
  }
  return null;
}

// Top-level bare-word keys inside a `properties: { ... }` body. Bare-word
// only (matches `quadrant: { ... }`, skips `"some thing": { ... }` since
// JSON-style keys are not used in Sasa's source).
function extractParamNamesFromProperties(file: string, text: string): Surface[] {
  const out: Surface[] = [];
  PROPERTIES_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PROPERTIES_RE.exec(text)) !== null) {
    const open = m.index + m[0].length - 1; // position of the '{'
    const sl = sliceBalanced(text, open);
    if (!sl) continue;
    const body = sl.body;
    // Walk top-level keys: a bare-word identifier at depth 0 followed by ':'.
    let depth = 0;
    let inStr: '"' | "'" | "`" | null = null;
    let token = "";
    let tokenStart = -1;
    const bodyOffset = open + 1;
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (inStr) {
        if (c === "\\") {
          i++;
          continue;
        }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        inStr = c as '"' | "'" | "`";
        token = "";
        continue;
      }
      if (c === "{") {
        depth++;
        token = "";
        continue;
      }
      if (c === "}") {
        depth--;
        token = "";
        continue;
      }
      if (depth !== 0) continue;
      if (/[A-Za-z0-9_]/.test(c)) {
        if (token === "") tokenStart = i;
        token += c;
        continue;
      }
      if (c === ":" && token) {
        // Emit token as a key. Filter common non-key words; Sasa's source
        // does not use these as top-level prop names.
        if (!/^(type|enum|description|required|properties|items|default)$/.test(token)) {
          const absOffset = bodyOffset + tokenStart;
          out.push({
            file,
            line: lineOf(text, absOffset),
            kind: "param-name",
            text: token,
          });
        }
        token = "";
        continue;
      }
      token = "";
    }
  }
  return out;
}

function extractSurfaces(file: string, text: string): Surface[] {
  return [
    ...extractEnumValues(file, text),
    ...extractDescriptions(file, text),
    ...extractParamNamesFromProperties(file, text),
  ];
}

// ---------- main ----------

function main(): void {
  const files: string[] = [];
  const surfaces: Surface[] = [];

  for (const f of TARGET_FILES) {
    if (!existsSync(f)) {
      console.error(`[tool-schema-audit] target file missing: ${f}`);
      console.error(
        `[tool-schema-audit] (set NISRIA_PLATFORM_ROOT to override the platform path)`,
      );
      process.exit(2);
    }
    const text = readFileSync(f, "utf8");
    files.push(f);
    surfaces.push(...extractSurfaces(f, text));
  }

  const hits: Hit[] = [];
  const compiled = SCHEMA_PATTERNS.map((p) => ({ p, ...compile(p) }));

  for (const s of surfaces) {
    for (const { p, re, allow } of compiled) {
      if (allow && allow.test(s.text)) continue;
      if (!re.test(s.text)) continue;
      hits.push({
        pattern_id: p.id,
        pattern_label: p.label,
        severity: p.severity,
        spec_anchor: p.spec_anchor,
        file: s.file,
        line: s.line,
        kind: s.kind,
        text: s.text.length > 200 ? s.text.slice(0, 200) + "…" : s.text,
      });
    }
  }

  const summary: Record<Severity, number> = { critical: 0, high: 0, medium: 0 };
  for (const h of hits) summary[h.severity]++;

  const report: Report = {
    bot: BOT_NAME,
    files_scanned: files,
    surfaces_extracted: surfaces.length,
    patterns_checked: SCHEMA_PATTERNS.length,
    hits,
    summary,
    generated_at: new Date().toISOString(),
  };

  const outDir = join(REPO_ROOT, "eval", "out");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "tool-schema-audit-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.error(
    `[tool-schema-audit] bot=${BOT_NAME} files=${files.length} surfaces=${surfaces.length} patterns=${SCHEMA_PATTERNS.length}`,
  );
  console.error(
    `[tool-schema-audit] hits: critical=${summary.critical} high=${summary.high} medium=${summary.medium}`,
  );
  console.error(`[tool-schema-audit] report: ${outPath}`);

  if (hits.length > 0) {
    for (const h of hits.slice(0, 30)) {
      console.error(
        `  [${h.severity}] ${h.pattern_id} (${h.spec_anchor}) :: ${h.file}:${h.line} (${h.kind})`,
      );
      console.error(`    "${h.text}"`);
    }
  }

  const blocking = BLOCK_MEDIUM ? hits : hits.filter((h) => h.severity !== "medium");
  if (blocking.length > 0) {
    process.exit(1);
  }
}

try {
  main();
} catch (e) {
  console.error(`[tool-schema-audit] FATAL: ${(e as Error).stack ?? e}`);
  process.exit(2);
}
