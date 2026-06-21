// Tiny-Yeah install-time writer domain (SPEC-TINY-YEAH-002 REQ-TY2-003/006/007, strategy §4).
//
// The installer's OWN write pathway. Per the SPEC central design proposition (strategy §3,
// Option C — Two-Domain), install writes are an ADMIN-TIME concern: they reuse atomic PRIMITIVES
// from core/ (withWriteRetry, writeCreateOnlyFile, writeJsonAtomic) but do NOT route through
// core/checkpoint preview/apply. The model-state domain (.tiny-yeah/) stays exclusively governed
// by universal-write-path; the installer domain writes only under the target project's `.opencode/`.
//
// Primitives reused (the ALLOWED direction — installer → core atomic primitive):
//   - core/checkpoint/atomic-write.ts: withWriteRetry (Defender EPERM/EBUSY backoff),
//     writeCreateOnlyFile (O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW).
//   - core/state/file-store.ts: writeJsonAtomic (temp+rename JSON).
//   - core/state/path-safety.ts: resolvePathInsideRoot (path confinement).
//
// What this module does NOT import: core/checkpoint/preview.ts, apply.ts, universal-write-path.ts
// (the lifecycle). That separation is enforced by tests/unit/installer-firewall.test.ts (Phase 5).
//
// Two write modes serve the two install paths:
//   - atomicCopyFile (create-only): first install — rejects an existing dest (REQ-TY2-005 c).
//   - atomicOverwriteFile (temp+rename): update path — atomically replaces.
// backupAndWrite layers a timestamped `.backup-<ts>` copy before overwrite (REQ-TY2-006, donor
// backup-config.ts pattern).

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, link, mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  type WriteRetryOptions,
  withWriteRetry,
  writeCreateOnlyFile,
} from "../../core/checkpoint/atomic-write.js";
import { writeJsonAtomic, writeTextAtomic } from "../../core/state/file-store.js";
import { resolvePathInsideRoot } from "../../core/state/path-safety.js";
import { InstallerError } from "./errors.js";

export type { WriteRetryOptions } from "../../core/checkpoint/atomic-write.js";

/**
 * ISO-8601 timestamp with filesystem-unsafe characters (`:`) replaced. Used for `.backup-<ts>`
 * suffixes so a backup name is sortable and cross-platform (Windows forbids `:` in paths).
 */
function fsSafeTimestamp(now = new Date()): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

/**
 * Create-only binary copy. Reads the source as a Buffer (NOT utf8 text — utf8 decoding corrupts
 * binary tarballs) and writes it to a uniquely-named temp sibling with O_CREAT|O_EXCL|O_NOFOLLOW,
 * fsync, then hard-link over the dest. On EEXIST the dest is reported as
 * CREATE_ONLY_TARGET_EXISTS so callers can branch to the overwrite path.
 *
 * Used for the vendor tarball (potentially large + binary). Text-mode atomicCopyFile is
 * unsuitable because readFile(src, "utf8") + writeFile(dest, "utf8") is a lossy round trip for
 * non-UTF-8 byte sequences.
 */
async function writeCreateOnlyBinary(
  targetPath: string,
  content: Buffer,
  retryOptions: WriteRetryOptions,
): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  const tempPath = join(
    dirname(targetPath),
    `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await withWriteRetry(async () => {
      const handle = await open(
        tempPath,
        // Mirror writeCreateOnlyFile's flags (O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW).
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await handle.writeFile(content);
        await handle.sync();
      } finally {
        await handle.close();
      }
    }, retryOptions);
    try {
      await withWriteRetry(async () => {
        await link(tempPath, targetPath);
      }, retryOptions);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code?: unknown }).code === "EEXIST"
      ) {
        throw new InstallerError({
          code: "CREATE_ONLY_TARGET_EXISTS",
          message: `Create-only target already exists: ${targetPath}`,
          recoveryHint: "Use the update/overwrite path, or pass --force to back up and replace.",
          cause: error,
        });
      }
      throw error;
    }
  } finally {
    await rm(tempPath, { recursive: true, force: true });
  }
}

/**
 * Resolve a project-root-relative dest to an absolute path, fail-closed on escape (REQ-TY2-007).
 * All installer writes flow through this so path confinement is structurally enforced.
 */
function resolveConfinedDest(projectRoot: string, dest: string): string {
  const absolute = resolvePathInsideRoot(projectRoot, dest);
  if (absolute === undefined) {
    throw new InstallerError({
      code: "PATH_ESCAPES_PROJECT",
      message: `Destination '${dest}' escapes project root '${projectRoot}'.`,
      recoveryHint: "Installer writes must target paths inside the project root (no `..` escapes).",
    });
  }
  return absolute;
}

/**
 * Copy a bundle source file to a project-root-relative dest using CREATE-ONLY semantics
 * (O_CREAT|O_EXCL|O_NOFOLLOW via writeCreateOnlyFile, wrapped in withWriteRetry). First-install
 * path: rejects an existing dest with CREATE_ONLY_TARGET_EXISTS (REQ-TY2-005 c). The update path
 * uses {@link atomicOverwriteFile} instead.
 *
 * The source is read once into memory (bundle files are small: shim, tui.json, package.json).
 * For the vendor tarball (potentially large), {@link atomicCopyFileStreamed} or a streamed copy
 * would be used by Phase 2; Phase 1 ships the in-memory variant which suffices for all template
 * files and the install stamp.
 */
export async function atomicCopyFile(
  projectRoot: string,
  dest: string,
  src: string,
  retryOptions: WriteRetryOptions = {},
): Promise<void> {
  const absoluteDest = resolveConfinedDest(projectRoot, dest);
  const content = await readFile(src, "utf8");
  try {
    await writeCreateOnlyFile(absoluteDest, content, retryOptions);
  } catch (error) {
    // writeCreateOnlyFile raises YeahError(APPLY_TARGET_EXISTS) on EEXIST; translate to the
    // installer-domain code CREATE_ONLY_TARGET_EXISTS so callers branch on the installer surface.
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: unknown }).code === "APPLY_TARGET_EXISTS"
    ) {
      throw new InstallerError({
        code: "CREATE_ONLY_TARGET_EXISTS",
        message: `Create-only target already exists: ${absoluteDest}`,
        recoveryHint: "Use the update/overwrite path, or pass --force to back up and replace.",
        cause: error,
      });
    }
    throw error;
  }
}

/**
 * Binary-safe create-only copy. Reads the source as a Buffer (no utf8 decode) and writes via the
 * O_CREAT|O_EXCL|O_NOFOLLOW + fsync + link path. Used for the vendor tarball — `atomicCopyFile`
 * is unsafe for binary files because its utf8 read+write round-trip corrupts non-UTF-8 bytes.
 *
 * The same CREATE_ONLY_TARGET_EXISTS error code is used so callers branch identically.
 */
export async function atomicCopyFileBinary(
  projectRoot: string,
  dest: string,
  src: string,
  retryOptions: WriteRetryOptions = {},
): Promise<void> {
  const absoluteDest = resolveConfinedDest(projectRoot, dest);
  const content = await readFile(src);
  await writeCreateOnlyBinary(absoluteDest, content, retryOptions);
}

/**
 * Atomically overwrite (or create) a project-root-relative dest with the given string content.
 * Writes to a uniquely-named temp sibling, fsyncs, then renames over the dest — all wrapped in
 * withWriteRetry (REQ-TY2-006 Defender backoff). The temp uses O_CREAT|O_EXCL|O_NOFOLLOW
 * (symlink-attack resistant, REQ-TY2-005). On any failure the temp is removed (no partial files).
 */
export async function atomicOverwriteFile(
  projectRoot: string,
  dest: string,
  content: string,
  retryOptions: WriteRetryOptions = {},
): Promise<void> {
  const absoluteDest = resolveConfinedDest(projectRoot, dest);
  // writeTextAtomic is temp+rename over raw text (mirrors writeJsonAtomic's atomicity without
  // JSON.stringify). Wrapped in withWriteRetry for Defender EPERM/EBUSY backoff (REQ-TY2-006).
  await withWriteRetry(async () => writeTextAtomic(absoluteDest, content), retryOptions);
}

/**
 * Atomically write a JSON value to a project-root-relative dest (temp+rename via writeJsonAtomic).
 * Used for the install stamp and `.opencode/package.json` (JSON only — NOT for opencode.json[c]
 * deep-merge, which must preserve JSONC and uses jsonc-parser in Phase 2). The atomic part reuses
 * writeJsonAtomic; backup (if needed) happens at the caller via {@link backupAndWrite} or here.
 */
export async function atomicWriteJson(
  projectRoot: string,
  dest: string,
  value: unknown,
  retryOptions: WriteRetryOptions = {},
): Promise<void> {
  const absoluteDest = resolveConfinedDest(projectRoot, dest);
  await withWriteRetry(async () => writeJsonAtomic(absoluteDest, value), retryOptions);
}

/**
 * Back up an existing file to `<dest>.backup-<ts>` THEN atomically overwrite it (REQ-TY2-006).
 *
 * Decision: the BACKUP happens HERE (not at the caller) so every overwrite path is uniformly safe.
 * A caller that wants to overwrite a user file routes through this function and gets backup +
 * atomic-overwrite as one transactional unit. If no prior file exists, no backup is created and
 * the function behaves like {@link atomicOverwriteFile}; returns `undefined` in that case.
 *
 * @returns the absolute backup path, or `undefined` if no prior file existed.
 */
export async function backupAndWrite(
  projectRoot: string,
  dest: string,
  content: string,
  retryOptions: WriteRetryOptions = {},
): Promise<string | undefined> {
  const absoluteDest = resolveConfinedDest(projectRoot, dest);
  // Check for a prior file (fs.access-style: stat, ENOENT → no backup).
  let priorExists = false;
  try {
    const info = await stat(absoluteDest);
    priorExists = info.isFile();
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT"
      )
    ) {
      throw error;
    }
    priorExists = false;
  }

  if (!priorExists) {
    await atomicOverwriteFile(projectRoot, dest, content, retryOptions);
    return undefined;
  }

  const backupPath = `${absoluteDest}.backup-${fsSafeTimestamp()}`;
  // Copy the prior file to the backup (wrapped in withWriteRetry for Defender resilience).
  await withWriteRetry(async () => {
    await copyFile(absoluteDest, backupPath);
  }, retryOptions);
  // Now overwrite the dest atomically.
  await atomicOverwriteFile(projectRoot, dest, content, retryOptions);
  return backupPath;
}
