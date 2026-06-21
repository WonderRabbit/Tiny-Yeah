// Tiny-Yeah state file-store (SPEC-TINY-YEAH-001 REQ-TY-008/029, plan.md §2 Phase 1).
//
// Ported from Tiny-Chu `src/state/file-store.ts` (writeJsonAtomic temp+rename, readJsonFile,
// readJsonLines, MalformedJsonError fail-closed) PLUS the REQ-TY-029 schemaVersion layer:
//   - readStateJson(file, expectedSchemaVersion, fallback): validates a `schemaVersion` field
//     and throws StateSchemaVersionError (distinct from MalformedJsonError) on missing/unknown.
//   - writeStateJson(file, value, schemaVersion): injects schemaVersion then atomic write.
//
// All Tiny-Yeah `.tiny-yeah/**/*.json` runtime state MUST flow through readStateJson/writeStateJson
// so schema drift is detected as a typed error rather than a silent zod field-drop.
// (Kernel-internal state I/O, layer B — NOT subject to REQ-TY-004 universal-write-path.)

import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export class MalformedJsonError extends Error {
  override readonly name = "MalformedJsonError";

  constructor(
    readonly file: string,
    cause: SyntaxError,
  ) {
    super(`Malformed JSON in ${file}`, { cause });
  }
}

export class StateSchemaVersionError extends Error {
  // @MX:NOTE: [AUTO] REQ-TY-029 distinct typed error for schemaVersion mismatch (vs MalformedJsonError).
  // @MX:REASON: allows callers to branch on schema-drift recovery without parsing JSON syntax errors.
  readonly code = "STATE_SCHEMA_VERSION_MISMATCH" as const;
  override readonly name = "StateSchemaVersionError";

  constructor(
    readonly file: string,
    readonly expected: string,
    readonly actual: string | undefined,
  ) {
    const actualDesc = actual === undefined ? "missing" : `'${actual}'`;
    super(`Schema version mismatch in ${file}: expected '${expected}', got ${actualDesc}`);
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as { code: unknown }).code === code;
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return fallback;
    throw error;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    if (error instanceof SyntaxError) throw new MalformedJsonError(file, error);
    throw error;
  }
}

export async function writeJsonAtomic(
  file: string,
  value: unknown,
  options: { readonly compact?: boolean } = {},
): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`,
  );
  await writeFile(tmp, `${JSON.stringify(value, null, options.compact ? 0 : 2)}\n`, "utf8");
  await rename(tmp, file);
}

export async function writeTextAtomic(file: string, text: string): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`,
  );
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
}

export async function appendJsonLine(file: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  await appendFile(file, `${JSON.stringify(value)}\n`, "utf8");
}

export async function readJsonLines<T>(file: string, fallback: readonly T[]): Promise<T[]> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [...fallback];
    throw error;
  }
  const records: T[] = [];
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    try {
      records.push(JSON.parse(line) as T);
    } catch (error) {
      throw new Error(
        `Malformed JSONL in ${file} at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return records;
}

export async function removeIfExists(file: string): Promise<boolean> {
  try {
    await unlink(file);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

function readSchemaVersion(parsed: unknown): string | undefined {
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    "schemaVersion" in parsed &&
    typeof (parsed as { schemaVersion?: unknown }).schemaVersion === "string"
  ) {
    return (parsed as { schemaVersion: string }).schemaVersion;
  }
  return undefined;
}

export async function readStateJson<T>(
  file: string,
  expectedSchemaVersion: string,
  fallback: T,
): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return fallback;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) throw new MalformedJsonError(file, error);
    throw error;
  }
  const actual = readSchemaVersion(parsed);
  if (actual !== expectedSchemaVersion) {
    throw new StateSchemaVersionError(file, expectedSchemaVersion, actual);
  }
  return parsed as T;
}

export async function writeStateJson<T extends { schemaVersion: string }>(
  file: string,
  value: T,
): Promise<void> {
  await writeJsonAtomic(file, value);
}
