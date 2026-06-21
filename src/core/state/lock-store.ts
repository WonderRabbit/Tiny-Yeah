// Tiny-Yeah directory-based advisory lock (SPEC-TINY-YEAH-001 REQ-TY-009/010, plan.md §2 Phase 1).
//
// Ported from Tiny-Chu `src/state/lock-store.ts` and generalized:
//   - Tiny-Chu domain helpers (tinyState*LockName) REMOVED — only the generic lock mechanism
//     remains; callers pass an arbitrary `name`.
//   - resolveTinyChuPaths -> resolveTinyYeahPaths (.tiny/ -> .tiny-yeah/).
//   - Exported names Tiny-State -> Tiny-Yeah.
//
// CAVEAT (REQ-TY-010): This is a local-filesystem advisory lock. It relies on POSIX/local-FS
// advisory semantics (mkdir exclusivity + mtime staleness). It is safe ONLY on a single-host
// local filesystem — NOT NFS/SMB/distributed. The stale/timeout/poll/renew constants and the
// reaper/lease lifecycle are the load-bearing contract (characterization tests pin them).

import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureDir } from "./file-store.js";
import { resolveTinyYeahPaths } from "./paths.js";

export const TINY_YEAH_LOCK_STALE_MS = 30_000;
export const TINY_YEAH_LOCK_TIMEOUT_MS = 10_000;
export const TINY_YEAH_LOCK_POLL_MS = 25;
export const TINY_YEAH_LOCK_RENEW_MS = 5_000;

interface LockOwner {
  readonly lockId: string;
  readonly pid: number;
  readonly hostname: string;
  readonly createdAt: string;
  readonly renewedAt: string;
  readonly expiresAt: string;
}

export interface TinyYeahLockOptions {
  readonly staleMs?: number;
  readonly timeoutMs?: number;
  readonly pollMs?: number;
  readonly renewMs?: number;
  readonly nonBlocking?: boolean;
}

export interface TinyYeahLock {
  readonly name: string;
  readonly path: string;
  readonly lockId: string;
  readonly compromisedError: Error | undefined;
  readonly assertActive: () => Promise<void>;
  readonly release: () => Promise<void>;
}

export class TinyYeahLockTimeoutError extends Error {
  readonly code = "TINY_YEAH_LOCK_TIMEOUT";
  override readonly name = "TinyYeahLockTimeoutError";

  constructor(name: string) {
    super(`Timed out waiting for Tiny-Yeah state lock: ${name}`);
  }
}

export class TinyYeahLockCompromisedError extends Error {
  readonly code = "TINY_YEAH_LOCK_COMPROMISED";
  override readonly name = "TinyYeahLockCompromisedError";

  constructor(name: string, cause: unknown) {
    super(`Tiny-Yeah state lock was compromised: ${name}`, { cause });
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as { code: unknown }).code === code;
}

function assertLockName(name: string): void {
  if (!/^[A-Za-z0-9._-]+\.lock$/.test(name) || name.includes("..")) {
    throw new Error(`Invalid Tiny-Yeah lock name: ${name}`);
  }
}

function lockOptions(options: TinyYeahLockOptions): Required<TinyYeahLockOptions> {
  return {
    staleMs: options.staleMs ?? TINY_YEAH_LOCK_STALE_MS,
    timeoutMs: options.timeoutMs ?? TINY_YEAH_LOCK_TIMEOUT_MS,
    pollMs: options.pollMs ?? TINY_YEAH_LOCK_POLL_MS,
    renewMs: options.renewMs ?? TINY_YEAH_LOCK_RENEW_MS,
    nonBlocking: options.nonBlocking ?? false,
  };
}

function ownerFor(lockId: string, now: Date, staleMs: number): LockOwner {
  const iso = now.toISOString();
  return {
    lockId,
    pid: process.pid,
    hostname: os.hostname(),
    createdAt: iso,
    renewedAt: iso,
    expiresAt: new Date(now.getTime() + staleMs).toISOString(),
  };
}

function renewOwner(owner: LockOwner, now: Date, staleMs: number): LockOwner {
  return {
    ...owner,
    renewedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + staleMs).toISOString(),
  };
}

async function ensureLockRoot(root: string | undefined): Promise<string> {
  const paths = resolveTinyYeahPaths(root);
  await ensureDir(paths.tinyYeahDir);
  const tinyInfo = await lstat(paths.tinyYeahDir);
  if (tinyInfo.isSymbolicLink() || !tinyInfo.isDirectory()) {
    throw new Error(`Tiny-Yeah state directory is not a safe directory: ${paths.tinyYeahDir}`);
  }
  await ensureDir(paths.locksDir);
  const locksInfo = await lstat(paths.locksDir);
  if (locksInfo.isSymbolicLink() || !locksInfo.isDirectory()) {
    throw new Error(`Tiny-Yeah locks directory is not a safe directory: ${paths.locksDir}`);
  }
  return paths.locksDir;
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readOwner(ownerFile: string): Promise<LockOwner | undefined> {
  let raw: string;
  try {
    raw = await readFile(ownerFile, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
  const value: unknown = JSON.parse(raw);
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { lockId?: unknown }).lockId === "string" &&
    typeof (value as { pid?: unknown }).pid === "number" &&
    typeof (value as { hostname?: unknown }).hostname === "string" &&
    typeof (value as { createdAt?: unknown }).createdAt === "string" &&
    typeof (value as { renewedAt?: unknown }).renewedAt === "string" &&
    typeof (value as { expiresAt?: unknown }).expiresAt === "string"
  ) {
    return value as LockOwner;
  }
  throw new Error(`Malformed Tiny-Yeah lock owner: ${ownerFile}`);
}

async function writeOwner(lockDir: string, owner: LockOwner): Promise<void> {
  await writeFile(path.join(lockDir, "owner.json"), `${JSON.stringify(owner, null, 2)}\n`, "utf8");
  const now = new Date(owner.renewedAt);
  await utimes(lockDir, now, now);
}

async function tryAcquireReaperLock(reaperDir: string, staleMs: number): Promise<boolean> {
  for (;;) {
    try {
      await mkdir(reaperDir, { recursive: false });
      return true;
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
      const snapshot = await lstat(reaperDir).catch((statError: unknown) => {
        if (hasErrorCode(statError, "ENOENT")) return undefined;
        throw statError;
      });
      if (!snapshot) continue;
      if (snapshot.isSymbolicLink() || !snapshot.isDirectory()) {
        throw new Error(`Tiny-Yeah lock reaper path is not a safe directory: ${reaperDir}`);
      }
      if (Date.now() - snapshot.mtimeMs <= staleMs) return false;
      await rm(reaperDir, { recursive: true, force: true });
    }
  }
}

async function withLifecycleLock<T>(
  lockDir: string,
  staleMs: number,
  pollMs: number,
  wait: boolean,
  operation: () => Promise<T>,
): Promise<T | undefined> {
  const reaperDir = `${lockDir}.reaper`;
  for (;;) {
    if (await tryAcquireReaperLock(reaperDir, staleMs)) break;
    if (!wait) return undefined;
    await sleep(pollMs);
  }
  try {
    return await operation();
  } finally {
    await rm(reaperDir, { recursive: true, force: true });
  }
}

async function tryRemoveStaleLock(
  lockDir: string,
  staleMs: number,
  pollMs: number,
): Promise<boolean> {
  return (
    (await withLifecycleLock(lockDir, staleMs, pollMs, false, async () => {
      try {
        const snapshot = await lstat(lockDir);
        if (snapshot.isSymbolicLink() || !snapshot.isDirectory()) {
          throw new Error(`Tiny-Yeah lock path is not a safe directory: ${lockDir}`);
        }
        if (Date.now() - snapshot.mtimeMs <= staleMs) return false;
        await rm(lockDir, { recursive: true, force: true });
        return true;
      } catch (error) {
        if (hasErrorCode(error, "ENOENT")) return true;
        throw error;
      }
    })) ?? false
  );
}

async function releaseLock(
  lockDir: string,
  owner: LockOwner,
  staleMs: number,
  pollMs: number,
): Promise<void> {
  await withLifecycleLock(lockDir, staleMs, pollMs, true, async () => {
    try {
      await verifyOwner(lockDir, owner);
    } catch (error) {
      if (hasErrorCode(error, "ENOENT") || error instanceof SyntaxError) return;
      return;
    }
    await rm(lockDir, { recursive: true, force: true });
  });
}

function assertOwnerLeaseActive(owner: LockOwner): void {
  const expiresAtMs = Date.parse(owner.expiresAt);
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) {
    throw new Error(`Tiny-Yeah lock lease expired: ${owner.lockId}`);
  }
}

async function assertOwnerActive(lockDir: string, owner: LockOwner): Promise<void> {
  const current = await readOwner(path.join(lockDir, "owner.json"));
  if (!current || current.lockId !== owner.lockId) {
    throw new Error(`Tiny-Yeah lock owner changed: ${lockDir}`);
  }
  assertOwnerLeaseActive(current);
}

async function assertLockActive(
  name: string,
  lockDir: string,
  owner: LockOwner,
  compromised: Error | undefined,
): Promise<void> {
  if (compromised) throw compromised;
  try {
    await assertOwnerActive(lockDir, owner);
  } catch (error) {
    throw new TinyYeahLockCompromisedError(name, error);
  }
}

async function verifyOwner(lockDir: string, owner: LockOwner): Promise<void> {
  const current = await readOwner(path.join(lockDir, "owner.json"));
  if (!current || current.lockId !== owner.lockId) {
    throw new Error(`Tiny-Yeah lock owner changed: ${lockDir}`);
  }
}

async function renewLock(
  lockDir: string,
  owner: LockOwner,
  staleMs: number,
  pollMs: number,
): Promise<LockOwner> {
  const renewed = await withLifecycleLock(lockDir, staleMs, pollMs, true, async () => {
    await assertOwnerActive(lockDir, owner);
    const next = renewOwner(owner, new Date(), staleMs);
    await writeOwner(lockDir, next);
    return next;
  });
  if (!renewed) throw new Error(`Tiny-Yeah lock renewal was interrupted: ${lockDir}`);
  return renewed;
}

function startRenewal(
  name: string,
  lockDir: string,
  initialOwner: LockOwner,
  staleMs: number,
  renewMs: number,
  pollMs: number,
): {
  readonly stop: () => Promise<void>;
  readonly compromisedError: () => Error | undefined;
  readonly owner: () => LockOwner;
} {
  let owner = initialOwner;
  let renewalPromise: Promise<void> | undefined;
  let compromised: Error | undefined;
  const timer = setInterval(() => {
    if (renewalPromise || compromised) return;
    renewalPromise = renewLock(lockDir, owner, staleMs, pollMs)
      .then((next) => {
        owner = next;
      })
      .catch((error: unknown) => {
        compromised = new TinyYeahLockCompromisedError(name, error);
      })
      .finally(() => {
        renewalPromise = undefined;
      });
  }, renewMs);
  const maybeUnref = timer as { unref?: () => void };
  if (
    typeof maybeUnref === "object" &&
    maybeUnref !== null &&
    typeof maybeUnref.unref === "function"
  ) {
    maybeUnref.unref();
  }
  return {
    stop: async () => {
      clearInterval(timer);
      await renewalPromise;
    },
    compromisedError: () => compromised,
    owner: () => owner,
  };
}

export async function acquireTinyYeahLock(
  root: string | undefined,
  name: string,
  options: TinyYeahLockOptions = {},
): Promise<TinyYeahLock | undefined> {
  assertLockName(name);
  const resolved = lockOptions(options);
  const locksDir = await ensureLockRoot(root);
  const lockDir = path.join(locksDir, name);
  const startedAt = Date.now();
  for (;;) {
    const lockId = randomUUID();
    const owner = ownerFor(lockId, new Date(), resolved.staleMs);
    try {
      await mkdir(lockDir, { recursive: false });
      try {
        await writeOwner(lockDir, owner);
      } catch (error) {
        await rm(lockDir, { recursive: true, force: true });
        throw error;
      }
      const renewal = startRenewal(
        name,
        lockDir,
        owner,
        resolved.staleMs,
        resolved.renewMs,
        resolved.pollMs,
      );
      return {
        name,
        path: lockDir,
        lockId,
        get compromisedError() {
          return renewal.compromisedError();
        },
        assertActive: async () => {
          await assertLockActive(name, lockDir, renewal.owner(), renewal.compromisedError());
        },
        release: async () => {
          await renewal.stop();
          await releaseLock(lockDir, owner, resolved.staleMs, resolved.pollMs);
        },
      };
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
      if (await tryRemoveStaleLock(lockDir, resolved.staleMs, resolved.pollMs)) continue;
      if (resolved.nonBlocking) return undefined;
      if (Date.now() - startedAt > resolved.timeoutMs) throw new TinyYeahLockTimeoutError(name);
      await sleep(resolved.pollMs);
    }
  }
}

export async function withTinyYeahLock<T>(
  root: string | undefined,
  name: string,
  operation: (lock: TinyYeahLock) => Promise<T>,
  options: TinyYeahLockOptions = {},
): Promise<T> {
  const lock = await acquireTinyYeahLock(root, name, options);
  if (!lock) throw new TinyYeahLockTimeoutError(name);
  try {
    await lock.assertActive();
    const result = await operation(lock);
    await lock.assertActive();
    return result;
  } finally {
    await lock.release();
  }
}
