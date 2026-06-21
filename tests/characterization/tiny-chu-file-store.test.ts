// CHARACTERIZATION: Tiny-Chu donor file-store invariant (fail-closed JSON).
// Source: ../../Tiny-Chu/src/state/file-store.ts
//
// REQ-TY-008: malformed `.tiny-yeah/**/*.json` MUST throw MalformedJsonError — never silently
// dropped, quarantined, or rewritten. writeJsonAtomic MUST be atomic (temp + rename) so a
// crash mid-write cannot corrupt an existing file. These tests pin that observed contract.

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendJsonLine,
  readJsonFile,
  readJsonLines,
  writeJsonAtomic,
} from "../../../Tiny-Chu/src/state/file-store.ts";

describe("Tiny-Chu donor file-store — writeJsonAtomic (temp + rename)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ty-filestore-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes valid JSON with a trailing newline and no leftover temp files", async () => {
    const target = path.join(dir, "task.json");
    await writeJsonAtomic(target, { ok: true, n: 3 });

    const raw = await readFile(target, "utf8");
    expect(raw).toBe(`${JSON.stringify({ ok: true, n: 3 }, null, 2)}\n`);

    // No `.<basename>.<pid>.<uuid>.tmp` siblings remain (atomic rename completed).
    const entries = await readdir(dir);
    const leftovers = entries.filter((e) => e.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("creates parent directories as needed", async () => {
    const target = path.join(dir, "nested", "deep", "task.json");
    await writeJsonAtomic(target, { x: 1 });
    const raw = await readFile(target, "utf8");
    expect(JSON.parse(raw)).toEqual({ x: 1 });
  });

  it("respects the compact option (no indentation)", async () => {
    const target = path.join(dir, "compact.json");
    await writeJsonAtomic(target, { a: [1, 2] }, { compact: true });
    const raw = await readFile(target, "utf8");
    expect(raw).toBe(`${JSON.stringify({ a: [1, 2] })}\n`);
  });
});

describe("Tiny-Chu donor file-store — readJsonFile fail-closed", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ty-filestore-read-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the fallback when the file does not exist (ENOENT)", async () => {
    // Donor signature: readJsonFile(file, fallback) — fallback is a positional value, NOT an
    // options object. Missing file yields the fallback verbatim.
    const value = await readJsonFile(path.join(dir, "missing.json"), { ok: false });
    expect(value).toEqual({ ok: false });
  });

  it("throws an error whose name is MalformedJsonError and message contains the path", async () => {
    const target = path.join(dir, "broken.json");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "{ not valid json", "utf8");

    let caught: unknown;
    try {
      await readJsonFile(target, { fallback: null });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe("MalformedJsonError");
    expect((caught as Error).message).toContain(target);
  });
});

describe("Tiny-Chu donor file-store — readJsonLines line-by-line validation", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ty-filestore-jsonl-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("appends JSONL records and reads them back in order", async () => {
    const target = path.join(dir, "events.jsonl");
    await appendJsonLine(target, { seq: 1 });
    await appendJsonLine(target, { seq: 2 });
    const records = await readJsonLines<{ seq: number }>(target, []);
    expect(records.map((r) => r.seq)).toEqual([1, 2]);
  });

  it("throws on a malformed line and reports the 1-based line number", async () => {
    const target = path.join(dir, "broken.jsonl");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `{"ok":true}\n{bad}\n`, "utf8");
    await expect(readJsonLines(target, [])).rejects.toThrow(/line 2/);
  });

  it("returns the fallback for a missing JSONL file", async () => {
    const records = await readJsonLines<{ x: number }>(path.join(dir, "nope.jsonl"), [{ x: 0 }]);
    expect(records).toEqual([{ x: 0 }]);
  });
});
