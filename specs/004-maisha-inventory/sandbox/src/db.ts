// PGlite in-process Postgres. Real CHECK constraints, jsonb, arrays — so the
// sandbox reproduces the live traps. db.query() mirrors the shape Sasa's data
// layer uses, so tool modules port to platform with minimal change.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, "..", "schema.sql");

export type DB = PGlite;

let _seq = 0;
// Deterministic ids (Math.random/Date.now are banned in this codebase's harness
// discipline; deterministic ids also make tests stable).
export function id(prefix = "id"): string {
  _seq += 1;
  return `${prefix}_${_seq.toString().padStart(6, "0")}`;
}

// Fixed clock for the sandbox so ordering/windows are deterministic in tests.
let _now = Date.parse("2026-06-21T08:00:00Z");
export function now(): string {
  return new Date(_now).toISOString();
}
export function tick(ms: number): void {
  _now += ms;
}
export function resetClock(): void {
  _now = Date.parse("2026-06-21T08:00:00Z");
  _seq = 0;
}

export async function freshDb(): Promise<DB> {
  resetClock();
  const db = new PGlite();
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  await db.exec(schema);
  return db;
}

// Thin helper that returns rows[] like the platform's db.from(...).select().
export async function q<T = any>(db: DB, sql: string, params: any[] = []): Promise<T[]> {
  const res = await db.query(sql, params);
  return res.rows as T[];
}
export async function one<T = any>(db: DB, sql: string, params: any[] = []): Promise<T | null> {
  const rows = await q<T>(db, sql, params);
  return rows[0] ?? null;
}
