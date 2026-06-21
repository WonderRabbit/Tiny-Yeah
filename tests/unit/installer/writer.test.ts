// UNIT: install-time writer domain (SPEC-TINY-YEAH-002 REQ-TY2-003/006/007, strategy §4 writer.ts).
//
// The installer's own write pathway. Reuses atomic PRIMITIVES (withWriteRetry, writeCreateOnlyFile,
// writeJsonAtomic) but does NOT route through core/checkpoint preview/apply (the two-domain
// firewall). Verifies:
//   - atomicCopyFile: create-only (rejects existing dest) wrapped in withWriteRetry.
//   - atomicOverwriteFile: temp+rename, replaces atomically, no partial files remain.
//   - backupAndWrite: creates <dest>.backup-<ts> then overwrites; returns backup path.
//   - withWriteRetry: retries simulated EPERM then succeeds (REQ-TY2-006 Defender scenario).
//   - path confinement: dest escaping project root → PATH_ESCAPES_PROJECT.

import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  WriteLockContentionError,
  withWriteRetry,
} from "../../../src/core/checkpoint/atomic-write.js";
import { hasInstallerErrorCode } from "../../../src/head/installer/errors.js";
import {
  atomicCopyFile,
  atomicOverwriteFile,
  atomicWriteJson,
  backupAndWrite,
} from "../../../src/head/installer/writer.js";

describe("writer — atomicCopyFile (create-only, REQ-TY2-005/006)", () => {
  it("copies a source file to a non-existent dest (create-only)", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-writer-copy-"));
    try {
      const src = path.join(tmp, "src.txt");
      const dest = path.join(tmp, "out", "dest.txt");
      await writeFile(src, "hello-bundle\n");
      await atomicCopyFile(tmp, path.join("out", "dest.txt"), src);
      expect(await readFile(dest, "utf8")).toBe("hello-bundle\n");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects when dest already exists (create-only invariant, REQ-TY2-005 c)", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-writer-copyexists-"));
    try {
      const src = path.join(tmp, "src.txt");
      await mkdir(path.join(tmp, "out"), { recursive: true });
      const dest = path.join(tmp, "out", "dest.txt");
      await writeFile(src, "new\n");
      await writeFile(dest, "original\n");
      await expect(atomicCopyFile(tmp, path.join("out", "dest.txt"), src)).rejects.toSatisfy(
        (err: unknown) => hasInstallerErrorCode(err, "CREATE_ONLY_TARGET_EXISTS"),
      );
      // Original content preserved (no clobber).
      expect(await readFile(dest, "utf8")).toBe("original\n");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("writer — atomicOverwriteFile (temp+rename, REQ-TY2-006)", () => {
  it("overwrites an existing file atomically (content replaced)", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-writer-overwrite-"));
    try {
      const dest = path.join(tmp, "out", "f.txt");
      await mkdir(path.join(tmp, "out"), { recursive: true });
      await writeFile(dest, "v1\n");
      await atomicOverwriteFile(tmp, path.join("out", "f.txt"), "v2\n");
      expect(await readFile(dest, "utf8")).toBe("v2\n");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("writes to a non-existent dest (create via overwrite)", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-writer-overwritecreate-"));
    try {
      await atomicOverwriteFile(tmp, path.join("deep", "f.txt"), "fresh\n");
      expect(await readFile(path.join(tmp, "deep", "f.txt"), "utf8")).toBe("fresh\n");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("leaves NO temp files behind after success", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-writer-notmp-"));
    try {
      await atomicOverwriteFile(tmp, path.join("out", "f.txt"), "content\n");
      const outDir = path.join(tmp, "out");
      const remaining = await readdir(outDir);
      // Only the final dest file should remain — no `.tmp` siblings.
      expect(remaining).toEqual(["f.txt"]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("writer — atomicWriteJson (temp+rename via writeJsonAtomic)", () => {
  it("writes JSON with trailing newline, sorted-key round-trip", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-writer-json-"));
    try {
      const dest = path.join(tmp, "out", "obj.json");
      await atomicWriteJson(tmp, path.join("out", "obj.json"), { b: 2, a: 1 });
      const raw = await readFile(dest, "utf8");
      const parsed = JSON.parse(raw);
      expect(parsed).toEqual({ a: 1, b: 2 });
      expect(raw.endsWith("\n")).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("writer — backupAndWrite (REQ-TY2-006 backup before overwrite)", () => {
  it("creates a timestamped backup then overwrites; returns the backup path", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-writer-backup-"));
    try {
      const dest = path.join(tmp, "out", "cfg.json");
      await mkdir(path.join(tmp, "out"), { recursive: true });
      await writeFile(dest, "ORIGINAL\n");
      const backupPath = await backupAndWrite(tmp, path.join("out", "cfg.json"), "NEW\n");
      expect(backupPath).toBeDefined();
      // Backup file exists and contains the original content.
      const backupInfo = await lstat(backupPath as string);
      expect(backupInfo.isFile()).toBe(true);
      expect(await readFile(backupPath as string, "utf8")).toBe("ORIGINAL\n");
      // Backup name follows the .backup-<timestamp> convention.
      expect(path.basename(backupPath as string)).toMatch(/^cfg\.json\.backup-.+$/);
      // Dest now has the new content.
      expect(await readFile(dest, "utf8")).toBe("NEW\n");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("returns undefined when no prior file exists (nothing to back up)", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-writer-nobackup-"));
    try {
      const backupPath = await backupAndWrite(tmp, path.join("out", "cfg.json"), "FRESH\n");
      expect(backupPath).toBeUndefined();
      expect(await readFile(path.join(tmp, "out", "cfg.json"), "utf8")).toBe("FRESH\n");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("writer — path confinement (REQ-TY2-007)", () => {
  it("atomicOverwriteFile rejects a dest that escapes project root (.. )", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-writer-escape-"));
    try {
      await expect(
        atomicOverwriteFile(tmp, path.join("..", "escape.txt"), "x\n"),
      ).rejects.toSatisfy((err: unknown) => hasInstallerErrorCode(err, "PATH_ESCAPES_PROJECT"));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("atomicCopyFile rejects a dest that escapes project root", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-writer-copyescape-"));
    try {
      const src = path.join(tmp, "src.txt");
      await writeFile(src, "x\n");
      await expect(atomicCopyFile(tmp, path.join("..", "escape.txt"), src)).rejects.toSatisfy(
        (err: unknown) => hasInstallerErrorCode(err, "PATH_ESCAPES_PROJECT"),
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("withWriteRetry — Defender EPERM backoff (REQ-TY2-006)", () => {
  it("retries a transient EPERM then succeeds (no user-visible failure)", async () => {
    let calls = 0;
    const result = await withWriteRetry(
      async () => {
        calls += 1;
        if (calls < 3) {
          const err = Object.assign(new Error("EPERM simulation"), { code: "EPERM" });
          throw err;
        }
        return "ok";
      },
      // Deterministic: no real sleeping, generous budget so the deadline never trips.
      { sleep: async () => undefined, now: () => 0, budgetMs: 1_000_000 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("escalates to WriteLockContentionError when the budget is exhausted", async () => {
    let calls = 0;
    // now() advances past the budget on the first check after a retry.
    let clock = 0;
    await expect(
      withWriteRetry(
        async () => {
          calls += 1;
          throw Object.assign(new Error("EPERM"), { code: "EPERM" });
        },
        {
          sleep: async () => {
            clock += 10_000;
          },
          now: () => clock,
          budgetMs: 1_000,
          baseMs: 1,
          capMs: 1,
        },
      ),
    ).rejects.toBeInstanceOf(WriteLockContentionError);
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  it("does NOT retry non-EPERM errors (propagates immediately)", async () => {
    let calls = 0;
    await expect(
      withWriteRetry(
        async () => {
          calls += 1;
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        },
        { sleep: async () => undefined, now: () => 0, budgetMs: 1_000_000 },
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(calls).toBe(1);
  });
});
