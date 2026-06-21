// UNIT: installer advisory lock (SPEC-TINY-YEAH-002 REQ-TY2-003, strategy §4/§7, MAJOR #4).
//
// The installer lock serializes concurrent install/update runs against the SAME target project.
// It is a NEW directory-based advisory lock at <project>/.opencode/.tiny-yeah-install.lock/ —
// NOT core/state/lock-store.ts (which is hardwired to .tiny-yeah/locks/, MAJOR #4). CRITICAL
// firewall: the lock path is ALWAYS under .opencode/, NEVER under .tiny-yeah/ (INV-1 regression
// guard — model-state domain must stay separate from installer domain).

import { lstat, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hasInstallerErrorCode } from "../../../src/head/installer/errors.js";
import {
  acquireInstallerLock,
  INSTALLER_LOCK_DIR_NAME,
  INSTALLER_LOCK_STALE_MS,
} from "../../../src/head/installer/lock.js";

/**
 * Default lock path resolution: <projectRoot>/.opencode/.tiny-yeah-install.lock (a DIRECTORY).
 * This is the load-bearing MAJOR #4 firewall assertion — never under .tiny-yeah/.
 */
describe("installer lock — path resolution (REQ-TY2-003 MAJOR #4 firewall)", () => {
  it("default lock path is under <projectRoot>/.opencode/", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ty2-lock-path-"));
    try {
      const handle = await acquireInstallerLock(projectRoot);
      try {
        expect(handle.lockDir).toBe(path.join(projectRoot, ".opencode", INSTALLER_LOCK_DIR_NAME));
        // The lock directory physically exists.
        const info = await lstat(handle.lockDir);
        expect(info.isDirectory()).toBe(true);
      } finally {
        await handle.release();
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("FIREWALL: the lock path NEVER resides under .tiny-yeah/ (INV-1 guard)", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ty2-lock-firewall-"));
    try {
      const handle = await acquireInstallerLock(projectRoot);
      try {
        const rel = path.relative(projectRoot, handle.lockDir);
        // The resolved relative path must start with .opencode/ and must NOT have `.tiny-yeah` as
        // a PATH SEGMENT (the lock's own name `.tiny-yeah-install.lock` legitimately contains the
        // substring, which is fine — what is forbidden is residing INSIDE a `.tiny-yeah/` dir).
        expect(rel.startsWith(`.opencode${path.sep}`)).toBe(true);
        const segments = rel.split(path.sep);
        // No parent segment is `.tiny-yeah` (the model-state root must not contain installer locks).
        expect(segments.slice(0, -1)).not.toContain(".tiny-yeah");
        // No `.tiny-yeah/locks/` path is created at all.
        expect(segments).not.toContain("locks");
        // Defensive: no lock directory is created under .tiny-yeah/ at all.
        const tinyYeahLocks = path.join(projectRoot, ".tiny-yeah", "locks");
        let exists = false;
        try {
          const stat = await lstat(tinyYeahLocks);
          exists = stat.isDirectory();
        } catch {
          exists = false;
        }
        expect(exists).toBe(false);
      } finally {
        await handle.release();
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("accepts an explicit lockDir override (for testing / non-default layouts)", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ty2-lock-explicit-"));
    const custom = path.join(projectRoot, "custom-locks");
    try {
      const handle = await acquireInstallerLock(projectRoot, { lockDir: custom });
      try {
        expect(handle.lockDir).toBe(path.join(custom, INSTALLER_LOCK_DIR_NAME));
      } finally {
        await handle.release();
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

describe("installer lock — acquire / release (REQ-TY2-003)", () => {
  it("acquires, then release removes the lock directory", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ty2-lock-acqrel-"));
    try {
      const handle = await acquireInstallerLock(projectRoot);
      const lockDir = handle.lockDir;
      expect(await lstat(lockDir).then((s) => s.isDirectory())).toBe(true);
      // owner.json is written inside the lock dir.
      const ownerRaw = await readFile(path.join(lockDir, "owner.json"), "utf8");
      const owner = JSON.parse(ownerRaw);
      expect(typeof owner.lockId).toBe("string");
      expect(typeof owner.pid).toBe("number");
      expect(typeof owner.hostname).toBe("string");
      expect(typeof owner.createdAt).toBe("string");
      expect(typeof owner.expiresAt).toBe("string");
      await handle.release();
      // After release the lock directory is gone.
      await expect(lstat(lockDir)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("a second concurrent acquire fails fast with INSTALL_LOCKED (non-blocking, no wait queue)", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ty2-lock-concurrent-"));
    try {
      const first = await acquireInstallerLock(projectRoot);
      try {
        await expect(acquireInstallerLock(projectRoot)).rejects.toSatisfy((err: unknown) =>
          hasInstallerErrorCode(err, "INSTALL_LOCKED"),
        );
      } finally {
        await first.release();
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("after release, a new acquire succeeds (lock is reusable)", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ty2-lock-reuse-"));
    try {
      const first = await acquireInstallerLock(projectRoot);
      await first.release();
      const second = await acquireInstallerLock(projectRoot);
      await second.release();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

describe("installer lock — stale reap (mtime > INSTALLER_LOCK_STALE_MS)", () => {
  it("reaps a stale lock dir (old mtime) and acquires fresh", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ty2-lock-stale-"));
    try {
      const handle = await acquireInstallerLock(projectRoot);
      const lockDir = handle.lockDir;
      // DO NOT release — simulate a crashed previous holder by backdating the mtime beyond stale.
      const ancient = new Date(Date.now() - (INSTALLER_LOCK_STALE_MS + 10_000));
      await utimes(lockDir, ancient, ancient);
      // A new acquire should reap the stale lock and succeed.
      const second = await acquireInstallerLock(projectRoot);
      try {
        const info = await lstat(lockDir);
        expect(info.isDirectory()).toBe(true);
      } finally {
        await second.release();
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("does NOT reap a live (recent mtime) lock — INSTALL_LOCKED persists", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ty2-lock-live-"));
    try {
      const handle = await acquireInstallerLock(projectRoot);
      try {
        // Touch the mtime to "now" so it is definitively fresh.
        const fresh = new Date();
        await utimes(handle.lockDir, fresh, fresh);
        await expect(acquireInstallerLock(projectRoot)).rejects.toSatisfy((err: unknown) =>
          hasInstallerErrorCode(err, "INSTALL_LOCKED"),
        );
      } finally {
        await handle.release();
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

describe("installer lock — parent dir creation", () => {
  it("creates the .opencode/ parent if it does not exist", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ty2-lock-mkdir-"));
    // Pre-create a stray file to ensure mkdir recursive handles a fresh tree.
    await mkdir(path.join(projectRoot, "unrelated"), { recursive: true });
    try {
      const handle = await acquireInstallerLock(projectRoot);
      try {
        expect(handle.lockDir.startsWith(path.join(projectRoot, ".opencode"))).toBe(true);
      } finally {
        await handle.release();
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects a non-directory lockDir occupation (defensive: symlink/file collision)", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ty2-lock-collide-"));
    try {
      // Pre-create a FILE at the lock path to simulate a collision.
      const lockDir = path.join(projectRoot, ".opencode", INSTALLER_LOCK_DIR_NAME);
      await mkdir(path.dirname(lockDir), { recursive: true });
      await writeFile(lockDir, "not a dir");
      await expect(acquireInstallerLock(projectRoot)).rejects.toBeInstanceOf(Error);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
