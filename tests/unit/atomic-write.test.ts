// UNIT: Tiny-Yeah atomic write primitives (SPEC-TINY-YEAH-001 REQ-TY-005, plan.md §3.5).
// Pins the create-only primitive (O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW + 0o600, NOT bare "wx"),
// the EEXIST -> APPLY_TARGET_EXISTS behavior, and the C5 Defender retry wrapper.

import { constants, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  WriteLockContentionError,
  withWriteRetry,
  writeCreateOnlyFile,
} from "../../src/core/checkpoint/atomic-write.js";
import { YeahError } from "../../src/core/checkpoint/errors.js";

const atomicWriteSource = readFileSync(
  path.resolve(__dirname, "..", "..", "src", "core", "checkpoint", "atomic-write.ts"),
  "utf8",
);

describe("writeCreateOnlyFile — REQ-TY-005 NF1 (O_NOFOLLOW, not bare 'wx')", () => {
  it("source uses constants.O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW with 0o600", () => {
    expect(atomicWriteSource).toContain(
      "constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW",
    );
    expect(atomicWriteSource).toContain("0o600");
  });

  it("uses async node:fs/promises open() (not openSync)", () => {
    expect(atomicWriteSource).toMatch(/await open\(/);
  });

  it("the temp-file writeCreateOnlyFile body does NOT use the bare 'wx' shorthand", () => {
    // Only withWriteRetry / the lock sentinel may use other forms; the create-only body uses the
    // explicit constant combination.
    expect(atomicWriteSource).not.toMatch(/open\(\s*\w+,\s*"wx"\s*,\s*0o600\)/);
  });

  it("fs.constants.O_NOFOLLOW is a real constant on this platform", () => {
    expect(typeof constants.O_NOFOLLOW).toBe("number");
    expect(constants.O_NOFOLLOW).toBeGreaterThan(0);
  });
});

describe("writeCreateOnlyFile — create-only behavior", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ty-yeah-atomic-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes content to a fresh target", async () => {
    const target = path.join(dir, "fresh.txt");
    await writeCreateOnlyFile(target, "hello\n");
    expect(await readFile(target, "utf8")).toBe("hello\n");
  });

  it("creates parent directories as needed", async () => {
    const target = path.join(dir, "nested", "deep", "file.txt");
    await writeCreateOnlyFile(target, "x");
    expect(await readFile(target, "utf8")).toBe("x");
  });

  it("throws YeahError APPLY_TARGET_EXISTS when the target already exists", async () => {
    const target = path.join(dir, "exists.txt");
    await mkdir(dir, { recursive: true });
    await writeFile(target, "first", "utf8");
    let caught: unknown;
    try {
      await writeCreateOnlyFile(target, "second");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YeahError);
    expect((caught as YeahError).code).toBe("APPLY_TARGET_EXISTS");
    // The original content is untouched (no-clobber).
    expect(await readFile(target, "utf8")).toBe("first");
  });

  it("leaves no leftover temp files after a successful write", async () => {
    const target = path.join(dir, "clean.txt");
    await writeCreateOnlyFile(target, "data");
    const entries = await readdir(dir);
    expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
  });
});

describe("withWriteRetry — C5 Defender/indexer retry (EPERM/EBUSY/EACCES)", () => {
  it("retries on simulated EPERM then succeeds (no escalation)", async () => {
    let calls = 0;
    const result = await withWriteRetry(
      async () => {
        calls += 1;
        if (calls < 3) {
          const error = new Error("EPERM") as Error & { code: string };
          error.code = "EPERM";
          throw error;
        }
        return "ok";
      },
      {
        // Deterministic time + no real sleeping so the test is fast.
        now: (() => {
          let t = 0;
          return () => (t += 10);
        })(),
        sleep: async () => {},
      },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("throws WriteLockContentionError after the retry budget is exhausted", async () => {
    let calls = 0;
    let caught: unknown;
    try {
      await withWriteRetry(
        async () => {
          calls += 1;
          const error = new Error("EPERM") as Error & { code: string };
          error.code = "EPERM";
          throw error;
        },
        {
          budgetMs: 100,
          baseMs: 200, // first backoff already overshoots the budget
          now: (() => {
            let t = 0;
            return () => (t += 10);
          })(),
          sleep: async () => {},
        },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WriteLockContentionError);
    expect((caught as WriteLockContentionError).code).toBe("WRITE_LOCK_CONTENTION");
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  it("does NOT retry non-contention errors (immediate throw)", async () => {
    let calls = 0;
    let caught: unknown;
    try {
      await withWriteRetry(async () => {
        calls += 1;
        const error = new Error("ENOENT") as Error & { code: string };
        error.code = "ENOENT";
        throw error;
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("ENOENT");
    expect(calls).toBe(1);
  });
});
