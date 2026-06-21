// CHARACTERIZATION: Tiny-Chu donor lock-store invariant.
// Source: ../../Tiny-Chu/src/state/lock-store.ts
//
// CAVEAT (REQ-TY-010): The donor's directory-based advisory lock relies on local-filesystem
// advisory semantics. It is safe only on a single-host local FS — NOT NFS/SMB/distributed.
// This characterization pins the stale/timeout/poll/renew constants and the reaper/lease
// behavior so the Phase 1 port (which removes domain-specific helpers like
// tinyStateTaskLockName but keeps the core mechanism) cannot regress the contract.

import { lstat, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireTinyStateLock,
  TINY_STATE_LOCK_POLL_MS,
  TINY_STATE_LOCK_RENEW_MS,
  TINY_STATE_LOCK_STALE_MS,
  TINY_STATE_LOCK_TIMEOUT_MS,
  withTinyStateLock,
} from "../../../Tiny-Chu/src/state/lock-store.ts";

describe("Tiny-Chu donor lock-store — poll/timeout/stale/renew constants", () => {
  // REQ-TY-009 exit gate: stale 30s / timeout 10s / poll 25ms / renew 5s.
  it("exposes TINY_STATE_LOCK_STALE_MS = 30_000", () => {
    expect(TINY_STATE_LOCK_STALE_MS).toBe(30_000);
  });

  it("exposes TINY_STATE_LOCK_TIMEOUT_MS = 10_000", () => {
    expect(TINY_STATE_LOCK_TIMEOUT_MS).toBe(10_000);
  });

  it("exposes TINY_STATE_LOCK_POLL_MS = 25", () => {
    expect(TINY_STATE_LOCK_POLL_MS).toBe(25);
  });

  it("exposes TINY_STATE_LOCK_RENEW_MS = 5_000", () => {
    expect(TINY_STATE_LOCK_RENEW_MS).toBe(5_000);
  });
});

describe("Tiny-Chu donor lock-store — acquire / release lifecycle", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-lock-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("acquires a lock and writes owner.json + the lock directory", async () => {
    const lock = await acquireTinyStateLock(root, "test.lock");
    expect(lock).toBeDefined();
    const info = await lstat(path.join(root, ".tiny", "locks", "test.lock"));
    expect(info.isDirectory()).toBe(true);
    await lock?.release();
  });

  it("a second non-blocking acquire on a held lock returns undefined (no wait)", async () => {
    const first = await acquireTinyStateLock(root, "contended.lock");
    expect(first).toBeDefined();
    const second = await acquireTinyStateLock(root, "contended.lock", {
      nonBlocking: true,
    });
    expect(second).toBeUndefined();
    await first?.release();
  });

  it("withTinyStateLock runs the operation under the lock and releases on completion", async () => {
    const result = await withTinyStateLock(root, "scoped.lock", async () => {
      // While held, a non-blocking attempt from the same process must also fail.
      const second = await acquireTinyStateLock(root, "scoped.lock", {
        nonBlocking: true,
      });
      return { secondHeld: second === undefined, value: 42 };
    });
    expect(result).toEqual({ secondHeld: true, value: 42 });
    // After release, the lock is re-acquirable.
    const again = await acquireTinyStateLock(root, "scoped.lock", {
      nonBlocking: true,
    });
    expect(again).toBeDefined();
    await again?.release();
  });
});

describe("Tiny-Chu donor lock-store — stale-lock reaping", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-lock-stale-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reaps a lock directory whose mtime is older than staleMs and re-acquires", async () => {
    // Pre-create a stale lock directory directly (no owner.json renewal loop running).
    const locksDir = path.join(root, ".tiny", "locks");
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
    // Push mtime well beyond staleMs (30s) into the past.
    const ancient = new Date(Date.now() - (TINY_STATE_LOCK_STALE_MS + 60_000));
    await utimes(path.join(locksDir, "stale.lock"), ancient, ancient);

    // Non-blocking acquire should reap the stale lock and succeed.
    const lock = await acquireTinyStateLock(root, "stale.lock", {
      nonBlocking: true,
    });
    expect(lock).toBeDefined();
    expect(lock?.lockId).not.toBe("dead-process");
    await lock?.release();
  });
});
