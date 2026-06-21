// UNIT: Tiny-Yeah file-store (SPEC-TINY-YEAH-001 REQ-TY-008/029, plan.md §2 Phase 1).
// Pins fail-closed JSON (MalformedJsonError), atomic writes (temp+rename, no leftovers),
// and the REQ-TY-029 schemaVersion layer (StateSchemaVersionError, distinct class).

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MalformedJsonError,
  readJsonFile,
  readJsonLines,
  readStateJson,
  StateSchemaVersionError,
  writeJsonAtomic,
  writeStateJson,
} from "../../src/core/state/file-store.js";

describe("file-store — writeJsonAtomic (temp + rename)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ty-yeah-filestore-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes valid JSON with a trailing newline and no leftover temp files", async () => {
    const target = path.join(dir, "task.json");
    await writeJsonAtomic(target, { ok: true, n: 3 });
    const raw = await readFile(target, "utf8");
    expect(raw).toBe(`${JSON.stringify({ ok: true, n: 3 }, null, 2)}\n`);
    const leftovers = (await readdir(dir)).filter((e) => e.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("respects the compact option", async () => {
    const target = path.join(dir, "compact.json");
    await writeJsonAtomic(target, { a: [1, 2] }, { compact: true });
    expect(await readFile(target, "utf8")).toBe(`${JSON.stringify({ a: [1, 2] })}\n`);
  });
});

describe("file-store — readJsonFile fail-closed", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ty-yeah-filestore-read-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the fallback when the file does not exist (ENOENT)", async () => {
    expect(await readJsonFile(path.join(dir, "missing.json"), { ok: false })).toEqual({
      ok: false,
    });
  });

  it("throws MalformedJsonError (name + path in message) on bad JSON", async () => {
    const target = path.join(dir, "broken.json");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "{ not valid json", "utf8");
    let caught: unknown;
    try {
      await readJsonFile(target, { fallback: null });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MalformedJsonError);
    expect((caught as MalformedJsonError).name).toBe("MalformedJsonError");
    expect((caught as MalformedJsonError).message).toContain(target);
  });
});

describe("file-store — readJsonLines", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ty-yeah-filestore-jsonl-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("throws on a malformed line and reports the 1-based line number", async () => {
    const target = path.join(dir, "broken.jsonl");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `{"ok":true}\n{bad}\n`, "utf8");
    await expect(readJsonLines(target, [])).rejects.toThrow(/line 2/);
  });
});

describe("file-store — REQ-TY-029 schemaVersion layer", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ty-yeah-filestore-schema-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writeStateJson/readStateJson round-trip a value with its schemaVersion", async () => {
    const file = path.join(dir, "task.json");
    const value = { schemaVersion: "tiny-yeah.task.v1", id: "t1", done: false };
    await writeStateJson(file, value);
    const back = await readStateJson(file, "tiny-yeah.task.v1", { schemaVersion: "fallback" });
    expect(back).toEqual(value);
  });

  it("throws StateSchemaVersionError when schemaVersion is missing", async () => {
    const file = path.join(dir, "no-version.json");
    await mkdir(dir, { recursive: true });
    await writeFile(file, `${JSON.stringify({ id: "t1" })}\n`, "utf8");
    let caught: unknown;
    try {
      await readStateJson(file, "tiny-yeah.task.v1", { schemaVersion: "fallback" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(StateSchemaVersionError);
    expect((caught as StateSchemaVersionError).code).toBe("STATE_SCHEMA_VERSION_MISMATCH");
    expect((caught as StateSchemaVersionError).expected).toBe("tiny-yeah.task.v1");
    expect((caught as StateSchemaVersionError).actual).toBeUndefined();
  });

  it("throws StateSchemaVersionError on an unknown/future schemaVersion", async () => {
    const file = path.join(dir, "future.json");
    await mkdir(dir, { recursive: true });
    await writeFile(
      file,
      `${JSON.stringify({ schemaVersion: "tiny-yeah.task.v999", id: "t1" })}\n`,
      "utf8",
    );
    let caught: unknown;
    try {
      await readStateJson(file, "tiny-yeah.task.v1", { schemaVersion: "fallback" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(StateSchemaVersionError);
    expect((caught as StateSchemaVersionError).actual).toBe("tiny-yeah.task.v999");
  });

  it("StateSchemaVersionError is a DISTINCT class from MalformedJsonError", () => {
    expect(StateSchemaVersionError).not.toBe(MalformedJsonError);
    const a = new StateSchemaVersionError("f", "tiny-yeah.task.v1", undefined);
    expect(a).toBeInstanceOf(StateSchemaVersionError);
    expect(a).not.toBeInstanceOf(MalformedJsonError);
  });

  it("returns the fallback when the state file does not exist (ENOENT)", async () => {
    const fallback = { schemaVersion: "tiny-yeah.task.v1", id: "default" };
    const back = await readStateJson(path.join(dir, "missing.json"), "tiny-yeah.task.v1", fallback);
    expect(back).toBe(fallback);
  });
});
