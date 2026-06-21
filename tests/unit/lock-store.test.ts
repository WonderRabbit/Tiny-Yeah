// UNIT: Tiny-Yeah lock-store (SPEC-TINY-YEAH-001 REQ-TY-009/010, plan.md §2 Phase 1).
// Pins the stale/timeout/poll/renew constants and the acquire/release/reaper contract on
// Tiny-Yeah's own port (generalized from Tiny-Chu — domain helpers dropped).

import { lstat, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireTinyYeahLock,
  TINY_YEAH_LOCK_POLL_MS,
  TINY_YEAH_LOCK_RENEW_MS,
  TINY_YEAH_LOCK_STALE_MS,
  TINY_YEAH_LOCK_TIMEOUT_MS,
  withTinyYeahLock,
} from "../../src/core/state/lock-store.js";
import { resolveTinyYeahPaths } from "../../src/core/state/paths.js";

describe("lock-store — poll/timeout/stale/renew constants (REQ-TY-009)", () => {
  it("exposes TINY_YEAH_LOCK_STALE_MS = 30_000", () => {
    expect(TINY_YEAH_LOCK_STALE_MS).toBe(30_000);
  });
  it("exposes TINY_YEAH_LOCK_TIMEOUT_MS = 10_000", () => {
    expect(TINY_YEAH_LOCK_TIMEOUT_MS).toBe(10_000);
  });
  it("exposes TINY_YEAH_LOCK_POLL_MS = 25", () => {
    expect(TINY_YEAH_LOCK_POLL_MS).toBe(25);
  });
  it("exposes TINY_YEAH_LOCK_RENEW_MS = 5_000", () => {
    expect(TINY_YEAH_LOCK_RENEW_MS).toBe(5_000);
  });
});

describe("lock-store — acquire / release lifecycle", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-yeah-lock-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("acquires a lock and writes the lock directory under `.tiny-yeah/locks/`", async () => {
    const lock = await acquireTinyYeahLock(root, "test.lock");
    expect(lock).toBeDefined();
    const info = await lstat(path.join(root, ".tiny-yeah", "locks", "test.lock"));
    expect(info.isDirectory()).toBe(true);
    await lock?.release();
  });

  it("a second non-blocking acquire on a held lock returns undefined (no wait)", async () => {
    const first = await acquireTinyYeahLock(root, "contended.lock");
    expect(first).toBeDefined();
    const second = await acquireTinyYeahLock(root, "contended.lock", { nonBlocking: true });
    expect(second).toBeUndefined();
    await first?.release();
  });

  it("withTinyYeahLock runs under the lock and releases on completion", async () => {
    const result = await withTinyYeahLock(root, "scoped.lock", async () => {
      const second = await acquireTinyYeahLock(root, "scoped.lock", { nonBlocking: true });
      return { secondHeld: second === undefined, value: 42 };
    });
    expect(result).toEqual({ secondHeld: true, value: 42 });
    const again = await acquireTinyYeahLock(root, "scoped.lock", { nonBlocking: true });
    expect(again).toBeDefined();
    await again?.release();
  });
});

describe("lock-store — stale-lock reaping", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-yeah-lock-stale-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reaps a lock directory whose mtime is older than staleMs and re-acquires", async () => {
    const locksDir = resolveTinyYeahPaths(root).locksDir;
    await mkdir(path.join(locksDir, "stale.lock"), { recursive: true });
    await writeFile(
      path.join(locksDir, "stale.lock", "owner.json"),
      `${JSON.stringify({
        lockId: "dead-process",
        pid: 999999,
        hostname: "ghost",
        createdAt: "2000-01-01T00:00:00.000Z",
        renewedAt: "2000-01-01T00:00:00.000Z",
        expiresAt: "2000-01-01T00:00:00.000Z",
      })}\n`,
      "utf8",
    );
    const ancient = new Date(Date.now() - (TINY_YEAH_LOCK_STALE_MS + 60_000));
    await utimes(path.join(locksDir, "stale.lock"), ancient, ancient);

    const lock = await acquireTinyYeahLock(root, "stale.lock", { nonBlocking: true });
    expect(lock).toBeDefined();
    expect(lock?.lockId).not.toBe("dead-process");
    await lock?.release();
  });
});
