// Tiny-Yeah installer advisory lock (SPEC-TINY-YEAH-002 REQ-TY2-003, strategy §4/§7, MAJOR #4).
//
// Directory-based advisory lock at <projectRoot>/.opencode/.tiny-yeah-install.lock/ serializing
// concurrent install/update runs against the SAME target project. This is a NEW lightweight
// utility — it does NOT use core/state/lock-store.ts, which is hardwired to `.tiny-yeah/locks/`
// (MAJOR #4: reusing it would either break serialization or create installer locks INSIDE the
// model-state domain, violating INV-1). The lock mechanics mirror lock-store.ts (mkdir
// exclusivity + mtime-based staleness + owner.json metadata) but accept an EXPLICIT lockDir so
// they are not bound to `.tiny-yeah/`.
//
// CRITICAL FIREWALL (REQ-TY2-003 AC + INV-1): the default lock path resolves to
// `<projectRoot>/.opencode/.tiny-yeah-install.lock/` and is NEVER created under `.tiny-yeah/`.
// The installer domain and the model-state domain (.tiny-yeah/) must stay structurally separate.
//
// Semantics (NF2 — non-blocking, fail-fast):
//   - On EEXIST with a LIVE owner (dir mtime within stale window) → throw INSTALL_LOCKED.
//   - On EEXIST with a STALE owner (dir mtime older than stale window) → reap + retry once.
//   - No wait queue, no renewal timer (install is short; stale-reap covers crashed holders).
//
// This util reuses node: built-ins + path-safety + errors.ts only. It does NOT import
// core/state/lock-store.ts and does NOT import core/checkpoint/**.

import { randomUUID } from "node:crypto";
import { lstat, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolvePathInsideRoot } from "../../core/state/path-safety.js";
import { InstallerError } from "./errors.js";

/**
 * Lock directory name (relative to the resolved lock root). The lock IS this directory — its
 * atomic mkdir is the exclusivity primitive, mirroring core/state/lock-store.ts.
 */
export const INSTALLER_LOCK_DIR_NAME = ".tiny-yeah-install.lock";

/**
 * Stale threshold. A lock whose directory mtime is older than this is considered held by a
 * crashed/abandoned process and is reaped. Matches TINY_YEAH_LOCK_STALE_MS (30s) for parity,
 * but defined locally so this module does not import lock-store.ts.
 */
export const INSTALLER_LOCK_STALE_MS = 30_000;

interface LockOwner {
  readonly lockId: string;
  readonly pid: number;
  readonly hostname: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface AcquireInstallerLockOptions {
  /**
   * Explicit lock root directory. When provided, the lock is created at
   * `<lockDir>/<INSTALLER_LOCK_DIR_NAME>/` instead of the default `<projectRoot>/.opencode/...`.
   * Used by tests and (future) non-standard layouts. MUST be inside projectRoot (path-confined).
   */
  readonly lockDir?: string;
  /** Override the stale threshold (tests use this to simulate time passing). */
  readonly staleMs?: number;
}

export interface InstallerLockHandle {
  /** Absolute path to the lock directory (the atomic-mkdir artifact). */
  readonly lockDir: string;
  /** Unique id of this lock acquisition (written into owner.json). */
  readonly lockId: string;
  /** Release the lock: rm the lock directory. Idempotent. */
  readonly release: () => Promise<void>;
}

function hasFsErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as { code?: unknown }).code === code;
}

function ownerFor(lockId: string, now: Date, staleMs: number): LockOwner {
  return {
    lockId,
    pid: process.pid,
    hostname: os.hostname(),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + staleMs).toISOString(),
  };
}

async function writeOwner(lockDir: string, owner: LockOwner): Promise<void> {
  await writeFile(path.join(lockDir, "owner.json"), `${JSON.stringify(owner, null, 2)}\n`, "utf8");
  const now = new Date(owner.createdAt);
  await utimes(lockDir, now, now);
}

/**
 * Resolve the lock directory for a project root. Default: `<projectRoot>/.opencode/<NAME>/`.
 * When `opts.lockDir` is provided, it must resolve INSIDE projectRoot (path confinement,
 * REQ-TY2-007) and the lock is created at `<lockDir>/<NAME>/`.
 *
 * The default NEVER produces a path under `.tiny-yeah/` — this is the MAJOR #4 firewall.
 */
function resolveLockDir(projectRoot: string, opts: AcquireInstallerLockOptions): string {
  if (opts.lockDir !== undefined) {
    const confined = resolvePathInsideRoot(projectRoot, opts.lockDir);
    if (confined === undefined) {
      throw new InstallerError({
        code: "PATH_ESCAPES_PROJECT",
        message: `lockDir '${opts.lockDir}' escapes project root '${projectRoot}'`,
        recoveryHint: "Pass a lockDir that resolves inside the project root.",
      });
    }
    return path.join(confined, INSTALLER_LOCK_DIR_NAME);
  }
  return path.join(projectRoot, ".opencode", INSTALLER_LOCK_DIR_NAME);
}

/**
 * Try to acquire the lock by atomically creating the lock directory. Returns true on success.
 * On EEXIST, inspects staleness: if the existing dir's mtime is older than staleMs, reaps it and
 * signals the caller to retry. Otherwise the lock is held by a live owner.
 */
async function tryAcquireOrClassify(
  lockDir: string,
  staleMs: number,
): Promise<
  { acquired: true; lockId: string } | { acquired: false; reason: "live" | "stale-reaped" }
> {
  try {
    await mkdir(lockDir, { recursive: false });
  } catch (error) {
    if (!hasFsErrorCode(error, "EEXIST")) {
      // A non-directory occupying the path (file/symlink) surfaces here — propagate as a
      // generic Error; callers/tests treat it as a failed acquire.
      throw error;
    }
    // EEXIST: inspect staleness.
    let info: { isDirectory: () => boolean; mtimeMs: number };
    try {
      const stat = await lstat(lockDir);
      info = { isDirectory: () => stat.isDirectory(), mtimeMs: stat.mtimeMs };
    } catch (statError) {
      if (hasFsErrorCode(statError, "ENOENT")) {
        // Raced — the dir vanished between mkdir and lstat. Treat as reapable.
        return { acquired: false, reason: "stale-reaped" };
      }
      throw statError;
    }
    if (!info.isDirectory()) {
      throw new Error(`Installer lock path is not a directory: ${lockDir}`);
    }
    if (Date.now() - info.mtimeMs > staleMs) {
      // Stale — reap and signal retry.
      await rm(lockDir, { recursive: true, force: true });
      return { acquired: false, reason: "stale-reaped" };
    }
    return { acquired: false, reason: "live" };
  }
  // Freshly created — write owner metadata.
  const lockId = randomUUID();
  const owner = ownerFor(lockId, new Date(), staleMs);
  try {
    await writeOwner(lockDir, owner);
  } catch (error) {
    // Best-effort cleanup so a failed owner-write does not leave a live-looking lock.
    await rm(lockDir, { recursive: true, force: true });
    throw error;
  }
  return { acquired: true, lockId };
}

/**
 * Acquire the installer advisory lock for a target project. Non-blocking fail-fast: if the lock
 * is held by a LIVE owner, throws INSTALL_LOCKED immediately (NF2 — no wait queue).
 *
 * @param projectRoot the target project root (the `--project` value).
 * @param opts optional explicit lockDir / staleMs override.
 * @returns InstallerLockHandle whose `release()` removes the lock directory.
 * @throws InstallerError(INSTALL_LOCKED) if a live owner holds the lock.
 *         InstallerError(PATH_ESCAPES_PROJECT) if an explicit lockDir escapes projectRoot.
 */
export async function acquireInstallerLock(
  projectRoot: string,
  opts: AcquireInstallerLockOptions = {},
): Promise<InstallerLockHandle> {
  const staleMs = opts.staleMs ?? INSTALLER_LOCK_STALE_MS;
  const lockDir = resolveLockDir(projectRoot, opts);

  // Ensure the parent directory exists (e.g. <projectRoot>/.opencode/).
  await mkdir(path.dirname(lockDir), { recursive: true });

  // Try once; on stale-reap, retry once. (Stale-reap can race, so cap at one retry.)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await tryAcquireOrClassify(lockDir, staleMs);
    if (result.acquired) {
      const lockId = result.lockId;
      return {
        lockDir,
        lockId,
        release: async () => {
          try {
            await rm(lockDir, { recursive: true, force: true });
          } catch (error) {
            if (hasFsErrorCode(error, "ENOENT")) return;
            throw error;
          }
        },
      };
    }
    if (result.reason === "live") {
      throw new InstallerError({
        code: "INSTALL_LOCKED",
        message: `Another tiny-yeah install/update is in progress for this project (lock held at ${lockDir}).`,
        recoveryHint:
          "Wait for the other install/update to finish, or remove the lock directory manually if the holder crashed: " +
          lockDir,
      });
    }
    // stale-reaped — loop and retry.
  }
  // Two consecutive stale-reaps without acquisition: treat as live (defensive against a reap race).
  throw new InstallerError({
    code: "INSTALL_LOCKED",
    message: `Could not acquire installer lock after stale-reap retry: ${lockDir}`,
    recoveryHint: `Remove the lock directory manually and retry: ${lockDir}`,
  });
}
