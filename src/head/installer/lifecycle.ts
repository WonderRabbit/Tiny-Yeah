// Tiny-Yeah install lifecycle (SPEC-TINY-YEAH-002 REQ-TY2-009/010/013/014/015/017,
// strategy §5/§6/§7).
//
// THE INSTALL ORCHESTRATOR. Sequences:
//   1. Resolve projectRoot (default CWD); path-confinement check.
//   2. readBundle(bundleDir) → fail-closed integrity verify (REQ-TY2-002). ZERO writes if fails.
//   3. acquireInstallerLock(projectRoot) → INSTALL_LOCKED if held.
//   4. computeInstallPlan(bundle, projectRoot).
//   5. Idempotency: readStamp(projectRoot) — same-version not-forced → noop (REQ-TY2-009 a).
//   6. Existing-dep conflict: different version in .opencode/package.json without --force →
//      EXISTING_DEP_CONFLICT (REQ-TY2-009).
//   7. dryRun → return {kind:"dry-run"} (zero writes).
//   8. Backup + write: copy entries via atomicCopyFile / backupAndWrite (REQ-TY2-006).
//   9. Merge: addPluginEntry into opencode.json[c] (REQ-TY2-008); create-if-absent.
//  10. npm install --offline --ignore-scripts --no-audit --fund=false (REQ-TY2-017, skipNpmInstall
//      for unit tests).
//  11. managedFileHashes; resolve plugin-cache path at RUNTIME (REQ-TY2-014, CRITICAL #1).
//  12. Detect OpenCode version (best-effort) for stamp.
//  13. Smoke import (REQ-TY2-013): dynamic import of `.`, `./opencode`, `./tui` from
//      .opencode/node_modules/tiny-yeah (skipSmokeImport for unit tests).
//  14. writeStamp(projectRoot, stamp).
//  15. Append structured log to .opencode/.tiny-yeah-install.log (REQ-TY2-009 AC).
//  16. Release lock (finally). Return {kind:"installed"}.
//
// Non-TTY → --yes (REQ-TY2-010 AC): when !process.stdout.isTTY and !yes, behave as --yes.
// On ANY InstallerError: release lock (finally), throw with stable code + recoveryHint.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { readBundle, type VerifiedBundle } from "./bundle-reader.js";
import { InstallerError } from "./errors.js";
import { acquireInstallerLock, type InstallerLockHandle } from "./lock.js";
import {
  addPluginEntry,
  assertParsable,
  createInitialConfig,
  locateOpenCodeConfig,
  removePluginEntry,
} from "./opencode-config.js";
import { computeInstallPlan, type InstallPlan } from "./plan.js";
import { compareSemver } from "./semver.js";
import {
  computeManagedFileHashes,
  INSTALL_STAMP_SCHEMA_VERSION,
  type InstallStamp,
  readStamp,
  writeStamp,
} from "./stamp.js";
import { atomicCopyFile, atomicCopyFileBinary, backupAndWrite } from "./writer.js";

/**
 * Binary-safe backupAndWrite: back up the prior file (if any) then atomically overwrite with a
 * Buffer. Mirrors {@link backupAndWrite} for text but reads+writes raw bytes so binary tarballs
 * are not corrupted by a utf8 round-trip.
 */
async function backupAndWriteBinary(
  projectRoot: string,
  dest: string,
  content: Buffer,
): Promise<string | undefined> {
  // The text backupAndWrite is in writer.ts and uses backupAndWrite's internal stat+copyFile. For
  // binary content, we replicate the pattern here: stat for prior, copyFile to backup, then
  // atomicOverwrite the dest with the Buffer via a temp-file write. Since atomicOverwriteFile is
  // text-only, write the Buffer directly via fs.writeFile + rename.
  const { stat, copyFile, mkdir, writeFile, rename } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  const absoluteDest = path.join(projectRoot, dest);
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
    // No prior file — write the Buffer atomically via temp + rename.
    await mkdir(dirname(absoluteDest), { recursive: true });
    const tmp = `${absoluteDest}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmp, content);
    await rename(tmp, absoluteDest);
    return undefined;
  }
  const backupPath = `${absoluteDest}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await copyFile(absoluteDest, backupPath);
  // Overwrite via temp + rename (Buffer content).
  const tmp = `${absoluteDest}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, absoluteDest);
  return backupPath;
}

const execFileAsync = promisify(execFile);

/** Plugin name (single source of truth; matches templates/opencode/plugins/tiny-yeah.ts). */
const PLUGIN_NAME = "tiny-yeah";

/** Structured-log path relative to project root. */
const INSTALL_LOG_REL_PATH = path.join(".opencode", ".tiny-yeah-install.log");

/** Default runtime options added in the tuple-form plugin entry. Empty for MVP. */
const DEFAULT_PLUGIN_OPTIONS: Record<string, unknown> | undefined = undefined;

/**
 * Input to {@link install}. The bin passes the resolved bundle + project roots + flags; tests
 * pass `skipNpmInstall` / `skipSmokeImport` to keep the unit test hermetic.
 */
export interface InstallOptions {
  /** Absolute path to the unpacked offline bundle (the directory containing manifest.json). */
  readonly bundleDir: string;
  /** Absolute path to the target project root. */
  readonly projectRoot: string;
  /** Force overwrite / bypass version guards. */
  readonly force?: boolean;
  /** Dry-run: compute + return the plan, write nothing. */
  readonly dryRun?: boolean;
  /** Emit machine-readable JSON output (informational for the bin; lifecycle just runs). */
  readonly json?: boolean;
  /** Skip interactive confirmation (also implied in non-TTY per REQ-TY2-010). */
  readonly yes?: boolean;
  /** TEST HOOK: skip `npm install --offline` (covered by bin E2E). */
  readonly skipNpmInstall?: boolean;
  /** TEST HOOK: skip the smoke-import check (covered by bin E2E). */
  readonly skipSmokeImport?: boolean;
}

/** Discriminated union of install outcomes. The bin maps these to exit codes + output. */
export type InstallResult =
  | {
      readonly kind: "installed";
      readonly version: string;
      readonly managedPaths: readonly string[];
      readonly stampPath: string;
    }
  | { readonly kind: "noop"; readonly version: string }
  | { readonly kind: "dry-run"; readonly version: string };

interface ResolvedConfig {
  readonly absPath: string;
  readonly exists: boolean;
}

/**
 * Resolve the OpenCode config location for write. When the user has `.opencode/opencode.jsonc`
 * or `.opencode/opencode.json`, we update that file IN PLACE (preserving JSONC). When neither
 * exists, we CREATE `.opencode/opencode.json` with the plugin entry (REQ-TY2-010 step 5 —
 * installer creates `.opencode/opencode.json`).
 *
 * Note: the plan currently hardcodes `opencode.jsonc` as the merge dest (plan.ts). The lifecycle
 * overrides that with the actual located path so the managedPaths[] reflects reality.
 */
async function resolveConfigForWrite(projectRoot: string): Promise<ResolvedConfig> {
  const located = await locateOpenCodeConfig(projectRoot);
  if (located.exists) {
    return { absPath: located.path, exists: true };
  }
  // Create-if-absent: prefer .opencode/opencode.json (REQ-TY2-010 step 5 says ".json").
  return {
    absPath: path.join(projectRoot, ".opencode", "opencode.json"),
    exists: false,
  };
}

/**
 * Check for an existing tiny-yeah dependency declaration in .opencode/package.json. Returns
 * the declared version string (e.g. "file:./vendor/tiny-yeah-v0.6.0-bundled.tgz") or undefined
 * when no .opencode/package.json or no tiny-yeah dependency is present.
 */
async function existingDepDeclaration(projectRoot: string): Promise<string | undefined> {
  const pkgPath = path.join(projectRoot, ".opencode", "package.json");
  try {
    const raw = await readFile(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string> };
    return pkg.dependencies?.[PLUGIN_NAME];
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Detect whether the bundle version differs from an existing dep declaration. Returns true when
 * the existing declaration's tarball filename differs from the bundle's tarball filename.
 */
function declaresDifferentVersion(
  existing: string | undefined,
  bundleTarballName: string,
): boolean {
  if (existing === undefined) return false;
  // Extract the basename from "file:./vendor/<name>" form.
  const match = /\/([^/]+)$/.exec(existing);
  const declaredName = match?.[1];
  return declaredName !== undefined && declaredName !== bundleTarballName;
}

/** Resolve the OpenCode plugin-cache path at RUNTIME (REQ-TY2-014, CRITICAL #1). */
function resolvePluginCachePath(): string {
  const cacheRoot = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
  return path.join(cacheRoot, "opencode", "packages");
}

function resolveNpmCachePath(projectRoot: string): string {
  const explicit = process.env.TINY_YEAH_NPM_CACHE;
  if (explicit !== undefined && explicit.length > 0) return path.resolve(explicit);
  return path.join(projectRoot, ".opencode", ".tiny-yeah-npm-cache");
}

/** Best-effort `opencode --version`. Returns "unknown" if the command is unavailable. */
async function detectOpenCodeVersion(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("opencode", ["--version"], {
      timeout: 5000,
    }).catch(() => ({ stdout: "" }));
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : "unknown";
  } catch {
    return "unknown";
  }
}

/** Append a structured log line (one JSON object per line) to the install log. */
async function appendInstallLog(
  projectRoot: string,
  entry: Record<string, unknown>,
): Promise<void> {
  const logPath = path.join(projectRoot, INSTALL_LOG_REL_PATH);
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(
    logPath,
    `${JSON.stringify({ ...entry, ts: new Date().toISOString() })}\n`,
    "utf8",
  );
}

/**
 * Execute the install lifecycle. See module-level doc for the step-by-step sequence. On any
 * InstallerError the lock is released (finally) and the error re-thrown with stable code +
 * recoveryHint intact.
 */
export async function install(options: InstallOptions): Promise<InstallResult> {
  const projectRoot = path.resolve(options.projectRoot);
  // (1) Path confinement: projectRoot must be a real, accessible directory.
  try {
    const info = await stat(projectRoot);
    if (!info.isDirectory()) {
      throw new InstallerError({
        code: "PATH_ESCAPES_PROJECT",
        message: `Project root is not a directory: ${projectRoot}`,
        recoveryHint: "Pass a valid directory via --project.",
      });
    }
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      throw new InstallerError({
        code: "PATH_ESCAPES_PROJECT",
        message: `Project root does not exist: ${projectRoot}`,
        recoveryHint: "Pass an existing directory via --project.",
        cause: error,
      });
    }
    throw error;
  }

  // Non-TTY implies --yes (REQ-TY2-010 AC). No-op today since install has no interactive prompt,
  // but the detection is wired so future prompts honor it.
  const effectiveYes = options.yes === true || process.stdout.isTTY === false;

  // (2) Verify bundle integrity BEFORE any writes (REQ-TY2-002 fail-closed). readBundle throws
  // InstallerError on integrity failures — the throw propagates and zero writes happened.
  const bundle: VerifiedBundle = await readBundle(options.bundleDir);

  // (3) Acquire the installer lock (NF2 non-blocking).
  let lock: InstallerLockHandle | undefined;
  try {
    lock = await acquireInstallerLock(projectRoot);

    // (4) Compute the install plan.
    const plan: InstallPlan = await computeInstallPlan({
      verifiedBundle: bundle,
      projectRoot,
    });

    // (5) Idempotency: same-version re-install = noop (REQ-TY2-009 a).
    // (Stamp read is done lazily to avoid importing stamp on the verify-only path.)
    const priorStamp = await readStamp(projectRoot);
    if (priorStamp !== null && priorStamp.version === plan.version && options.force !== true) {
      await appendInstallLog(projectRoot, {
        command: "install",
        version: plan.version,
        status: "noop",
      });
      return { kind: "noop", version: plan.version };
    }

    // (6) Existing-dep conflict: different version in .opencode/package.json without --force.
    if (options.force !== true) {
      const existing = await existingDepDeclaration(projectRoot);
      const bundleTarballName = path.basename(bundle.manifest.packageTarball);
      if (declaresDifferentVersion(existing, bundleTarballName)) {
        throw new InstallerError({
          code: "EXISTING_DEP_CONFLICT",
          message: `.opencode/package.json already declares ${PLUGIN_NAME} as '${existing}' but the bundle is '${bundleTarballName}'.`,
          recoveryHint:
            "Re-run with --force to back up the existing declaration and replace it with the bundle version.",
        });
      }
    }

    // (7) Dry-run: return the plan, ZERO writes.
    if (options.dryRun === true) {
      return { kind: "dry-run", version: plan.version };
    }

    // (8) Backup + write copy entries (REQ-TY2-006).
    // Create-only on first install (atomicCopyFile rejects existing). On --force, back up the
    // prior file then atomic-overwrite. The plan's copy entries are:
    //   vendor tarball, package.json, plugins/tiny-yeah.ts, tui.json.
    // The vendor tarball is BINARY — use atomicCopyFileBinary (utf8 round-trip corrupts it).
    // The text templates (package.json, plugins/*.ts, tui.json) use atomicCopyFile.
    const managedWritten: string[] = [];
    for (const entry of plan.entries) {
      if (entry.kind !== "copy") continue;
      const relDest = path.relative(projectRoot, entry.dest);
      const isBinary = entry.src.endsWith(".tgz") || entry.src.endsWith(".tar.gz");
      const copyFn = isBinary ? atomicCopyFileBinary : atomicCopyFile;
      if (options.force === true) {
        // Force path: back up prior file (if any), then atomic overwrite. Text overwrite via
        // backupAndWrite (text-only); binary overwrite via raw Buffer read + atomicOverwrite.
        if (isBinary) {
          const content = await readFile(entry.src);
          await backupAndWriteBinary(projectRoot, relDest, content);
        } else {
          const content = await readFile(entry.src, "utf8");
          await backupAndWrite(projectRoot, relDest, content);
        }
      } else {
        try {
          await copyFn(projectRoot, relDest, entry.src);
        } catch (error) {
          // If the file already exists (CREATE_ONLY_TARGET_EXISTS), this is a re-install of the
          // SAME managed file — treat as idempotent overwrite ONLY when a stamp indicates a prior
          // tiny-yeah install. Otherwise propagate (don't clobber user files silently).
          if (
            error instanceof InstallerError &&
            error.code === "CREATE_ONLY_TARGET_EXISTS" &&
            priorStamp?.managedPaths.includes(relDest) === true
          ) {
            if (isBinary) {
              const content = await readFile(entry.src);
              await backupAndWriteBinary(projectRoot, relDest, content);
            } else {
              const content = await readFile(entry.src, "utf8");
              await backupAndWrite(projectRoot, relDest, content);
            }
          } else {
            throw error;
          }
        }
      }
      managedWritten.push(relDest);
    }

    // (9) Merge the plugin entry into opencode.json[c] (REQ-TY2-008).
    const configResolved = await resolveConfigForWrite(projectRoot);
    const configRelDest = path.relative(projectRoot, configResolved.absPath);
    let mergedText: string;
    // Conditionally build the options bag so exactOptionalPropertyTypes is respected (an
    // explicit `undefined` for `options` would be a type error under strict TS).
    const entryOpts: { pluginName: string; options?: Record<string, unknown> } = {
      pluginName: PLUGIN_NAME,
    };
    if (DEFAULT_PLUGIN_OPTIONS !== undefined) entryOpts.options = DEFAULT_PLUGIN_OPTIONS;
    if (configResolved.exists) {
      const existing = await readFile(configResolved.absPath, "utf8");
      assertParsable(existing, configResolved.absPath);
      mergedText = addPluginEntry(existing, entryOpts);
    } else {
      mergedText = createInitialConfig(entryOpts);
    }
    // Backup prior config + atomic write the merged text. JSONC preservation handled by
    // addPluginEntry; the write itself goes through atomicOverwrite (NOT writeJsonAtomic, which
    // would destroy JSONC — REQ-TY2-008 AC).
    await backupAndWrite(projectRoot, configRelDest, mergedText);
    managedWritten.push(configRelDest);

    // (10) npm install --offline (REQ-TY2-017). Skipped in unit tests.
    if (options.skipNpmInstall !== true) {
      await runNpmInstallOffline(projectRoot);
    }

    // (11) Compute managedFileHashes; resolve plugin-cache path at RUNTIME (REQ-TY2-014).
    const managedFileHashes = await computeManagedFileHashes(projectRoot, managedWritten);
    const resolvedPluginCachePath = resolvePluginCachePath();

    // (12) Detect OpenCode version (best-effort, don't fail install if absent).
    const opencodeVersionAtInstall = await detectOpenCodeVersion();

    // (13) Smoke import (REQ-TY2-013). Skipped in unit tests.
    if (options.skipSmokeImport !== true) {
      await smokeImportExports(projectRoot);
    }

    // (14) Write the stamp.
    // bundleSha256 is the SHA-256 of the vendored tarball (manifest.packageTarball is the
    // relative path under the bundle dir). Recompute here — the reader's `entries` only cover
    // distHashes, not the tarball.
    const tarballAbs = path.join(bundle.bundleDir, bundle.manifest.packageTarball);
    let bundleSha256 = "";
    try {
      const tarballBytes = await readFile(tarballAbs);
      bundleSha256 = createHash("sha256").update(tarballBytes).digest("hex");
    } catch {
      // Best-effort — leave empty if the tarball disappeared between verify and stamp write.
    }
    const stamp: InstallStamp = {
      schemaVersion: INSTALL_STAMP_SCHEMA_VERSION,
      version: plan.version,
      installedAt: new Date().toISOString(),
      bundleSha256,
      managedPaths: managedWritten,
      managedFileHashes,
      resolvedPluginCachePath,
      opencodeVersionAtInstall,
    };
    await writeStamp(projectRoot, stamp);

    // (15) Append structured log.
    await appendInstallLog(projectRoot, {
      command: "install",
      version: plan.version,
      status: "installed",
      managedPaths: managedWritten,
      forced: options.force === true,
      yes: effectiveYes,
    });

    return {
      kind: "installed",
      version: plan.version,
      managedPaths: managedWritten,
      stampPath: path.join(projectRoot, ".opencode", ".tiny-yeah-install.json"),
    };
  } finally {
    // (16) Release lock on success AND failure.
    if (lock !== undefined) {
      await lock.release();
    }
  }
}

/**
 * Run `npm install --offline --ignore-scripts --no-audit --fund=false` in
 * <projectRoot>/.opencode/. Air-gap enforcement (REQ-TY2-017).
 */
async function runNpmInstallOffline(projectRoot: string): Promise<void> {
  const cwd = path.join(projectRoot, ".opencode");
  const npmCachePath = resolveNpmCachePath(projectRoot);
  await mkdir(npmCachePath, { recursive: true });
  try {
    await execFileAsync(
      "npm",
      [
        "install",
        "--offline",
        "--cache",
        npmCachePath,
        "--legacy-peer-deps",
        "--ignore-scripts",
        "--no-audit",
        "--fund=false",
      ],
      {
        cwd,
        env: {
          ...process.env,
          npm_config_cache: npmCachePath,
          npm_config_legacy_peer_deps: "true",
          npm_config_audit: "false",
          npm_config_fund: "false",
        },
        timeout: 120_000,
        // npm emits voluminous tar warnings (TAR_ENTRY_INVALID for vendored bundles). The
        // default 1MB maxBuffer overflows on those — bump to 32MB so the install completes
        // and the warnings are captured for diagnostics without aborting the run.
        maxBuffer: 1024 * 1024 * 32,
      },
    );
  } catch (error) {
    throw new InstallerError({
      code: "WRITE_FAILED",
      message: `npm install --offline failed in ${cwd}`,
      recoveryHint:
        "Ensure the offline bundle is air-gap complete (manifest.airGapComplete === true) and the vendored tarball is intact.",
      cause: error,
    });
  }
}

/**
 * Smoke import (REQ-TY2-013): dynamically import `.`, `./opencode`, `./tui` from
 * <projectRoot>/.opencode/node_modules/tiny-yeah. Verifies the three exports resolve after the
 * install. NOT the full fast-check property suite (that is dev-time `npm test` territory).
 *
 * Reads the package's `exports` map and dynamic-imports each `import` resolution via a file://
 * URL. Direct file paths are used instead of bare-specifier resolution because Node's
 * `require.resolve` does not honor conditional `exports` (import/types) — only the ESM
 * resolver does, and ESM bare-specifier resolution from a script context is fragile. Pointing
 * at the resolved file URL is the robust path and matches what OpenCode loads at runtime.
 */
async function smokeImportExports(projectRoot: string): Promise<void> {
  const { pathToFileURL } = await import("node:url");
  const { readFile } = await import("node:fs/promises");
  const packageRoot = path.join(projectRoot, ".opencode", "node_modules", PLUGIN_NAME);
  const pkgJsonPath = path.join(packageRoot, "package.json");
  let exportsMap: Record<string, { import?: string; default?: string }>;
  try {
    const raw = await readFile(pkgJsonPath, "utf8");
    exportsMap = (
      JSON.parse(raw) as { exports: Record<string, { import?: string; default?: string }> }
    ).exports;
  } catch (error) {
    throw new InstallerError({
      code: "WRITE_FAILED",
      message: `Smoke import could not read package.json exports at ${pkgJsonPath}`,
      recoveryHint: "Rebuild the offline bundle; the vendored package may be corrupt.",
      cause: error,
    });
  }
  const subpaths = [".", "./opencode", "./tui"];
  for (const sub of subpaths) {
    const entry = exportsMap[sub];
    const resolvedRel = entry?.import ?? entry?.default;
    if (typeof resolvedRel !== "string") {
      throw new InstallerError({
        code: "WRITE_FAILED",
        message: `Smoke import: package.json has no exports['${sub}'].import target`,
        recoveryHint: "Rebuild the offline bundle; the exports map is incomplete.",
      });
    }
    const resolvedAbs = path.join(packageRoot, resolvedRel);
    try {
      await import(pathToFileURL(resolvedAbs).href);
    } catch (error) {
      throw new InstallerError({
        code: "WRITE_FAILED",
        message: `Smoke import failed for '${sub}' from ${packageRoot} (target: ${resolvedAbs})`,
        recoveryHint:
          "The vendored package may be incomplete. Rebuild the offline bundle with `npm run release:offline`.",
        cause: error,
      });
    }
  }
}

// ============================================================================
// UPDATE LIFECYCLE (SPEC-TINY-YEAH-002 REQ-TY2-011, strategy §5 update).
// ============================================================================

/**
 * Input to {@link update}. The bin passes the resolved bundle + project roots + flags; tests pass
 * `skipNpmInstall` / `skipSmokeImport` to keep the unit test hermetic.
 */
export interface UpdateOptions {
  /** Absolute path to the unpacked offline bundle (the directory containing manifest.json). */
  readonly bundleDir: string;
  /** Absolute path to the target project root. */
  readonly projectRoot: string;
  /** Allow updating to an older bundle version (REQ-TY2-011 downgrade). */
  readonly allowDowngrade?: boolean;
  /** Dry-run: compute + return the result, write nothing. */
  readonly dryRun?: boolean;
  /** Emit machine-readable JSON output (informational for the bin). */
  readonly json?: boolean;
  /** Skip interactive confirmation (also implied in non-TTY). */
  readonly yes?: boolean;
  /** TEST HOOK: skip `npm install --offline`. */
  readonly skipNpmInstall?: boolean;
  /** TEST HOOK: skip the smoke-import check. */
  readonly skipSmokeImport?: boolean;
}

/** Discriminated union of update outcomes. */
export type UpdateResult =
  | {
      readonly kind: "updated";
      readonly from: string;
      readonly to: string;
      readonly managedPaths: readonly string[];
      /** True when the plugin-cache invalidation completed; false when best-effort partial. */
      readonly cacheInvalidated: boolean;
    }
  | { readonly kind: "noop"; readonly version: string }
  | { readonly kind: "dry-run"; readonly version: string };

/**
 * Invalidate the OpenCode plugin-cache entries for tiny-yeah under the given resolved cache path
 * (REQ-TY2-014). Deletes every `<cachePath>/tiny-yeah@*` subdirectory. Best-effort: a missing or
 * unwritable cache path is NOT fatal — returns false so the caller records it in the result.
 *
 * Only `tiny-yeah@*` entries are removed; other packages' cache directories are untouched.
 */
async function invalidatePluginCache(cachePath: string): Promise<boolean> {
  let entries: string[];
  try {
    entries = await readdir(cachePath);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      // Cache dir does not exist — nothing to invalidate. Best-effort false.
      return false;
    }
    // Unexpected error — best-effort, do not fail the update.
    return false;
  }
  let invalidated = false;
  for (const entry of entries) {
    if (entry.startsWith(`${PLUGIN_NAME}@`)) {
      try {
        await rm(path.join(cachePath, entry), { recursive: true, force: true });
        invalidated = true;
      } catch {
        // Best-effort: continue removing other entries even if one fails.
      }
    }
  }
  return invalidated;
}

/**
 * Execute the update lifecycle (REQ-TY2-011). Requires a prior install (an install stamp); throws
 * INSTALL_STAMP_MISSING otherwise. Sequences:
 *   1. Resolve projectRoot; path-confinement.
 *   2. readBundle → fail-closed verify.
 *   3. acquireInstallerLock.
 *   4. readStamp → INSTALL_STAMP_MISSING if absent.
 *   5. compareSemver(bundle.version, stamp.version): equal=noop; newer=proceed;
 *      older → DOWNGRADE_REJECTED unless allowDowngrade.
 *   6. dryRun → return {kind:"dry-run"} (zero writes).
 *   7. Backup + overwrite managed paths (vendor tarball via binary, text via backupAndWrite).
 *   8. Deep-merge opencode.json[c] (preserve user edits — REQ-TY2-011).
 *   9. npm install --offline (skipNpmInstall for unit tests).
 *  10. Invalidate plugin-cache at stamp.resolvedPluginCachePath (best-effort).
 *  11. Smoke import (skipSmokeImport for unit tests).
 *  12. writeStamp with refreshed managedFileHashes + version + resolvedPluginCachePath.
 *  13. Append structured log {event:"updated", from, to, at}.
 *  14. Release lock (finally). Return {kind:"updated"}.
 */
export async function update(options: UpdateOptions): Promise<UpdateResult> {
  const projectRoot = path.resolve(options.projectRoot);
  await assertProjectRoot(projectRoot);

  const bundle: VerifiedBundle = await readBundle(options.bundleDir);

  let lock: InstallerLockHandle | undefined;
  try {
    lock = await acquireInstallerLock(projectRoot);

    const priorStamp = await readStamp(projectRoot);
    if (priorStamp === null) {
      throw new InstallerError({
        code: "INSTALL_STAMP_MISSING",
        message: `Cannot update: no prior install found at ${projectRoot}.`,
        recoveryHint: "Run `tiny-yeah install` first to establish an install.",
      });
    }

    const cmp = compareSemver(bundle.manifest.version, priorStamp.version);
    if (cmp === 0) {
      await appendInstallLog(projectRoot, {
        command: "update",
        version: priorStamp.version,
        status: "noop",
      });
      return { kind: "noop", version: priorStamp.version };
    }
    if (cmp < 0 && options.allowDowngrade !== true) {
      throw new InstallerError({
        code: "DOWNGRADE_REJECTED",
        message: `Refusing to downgrade from ${priorStamp.version} to ${bundle.manifest.version}.`,
        recoveryHint:
          "Re-run with --allow-downgrade to permit the downgrade (the stamp version will be updated and a warning emitted).",
      });
    }

    // Dry-run: zero writes.
    if (options.dryRun === true) {
      return { kind: "dry-run", version: bundle.manifest.version };
    }

    const plan: InstallPlan = await computeInstallPlan({
      verifiedBundle: bundle,
      projectRoot,
    });

    // Backup + overwrite every copy entry (the update path always overwrites, with backup).
    const managedWritten: string[] = [];
    for (const entry of plan.entries) {
      if (entry.kind !== "copy") continue;
      const relDest = path.relative(projectRoot, entry.dest);
      const isBinary = entry.src.endsWith(".tgz") || entry.src.endsWith(".tar.gz");
      if (isBinary) {
        const content = await readFile(entry.src);
        await backupAndWriteBinary(projectRoot, relDest, content);
      } else {
        const content = await readFile(entry.src, "utf8");
        await backupAndWrite(projectRoot, relDest, content);
      }
      managedWritten.push(relDest);
    }

    // Deep-merge opencode.json[c] — preserve user edits (other entries, comments, JSONC facets).
    // addPluginEntry is idempotent: ensures tiny-yeah is present exactly once. If the user
    // customized other entries or added comments, those survive (jsonc-parser AST modify only
    // touches the tiny-yeah entry index).
    const configResolved = await resolveConfigForWrite(projectRoot);
    const configRelDest = path.relative(projectRoot, configResolved.absPath);
    let mergedText: string;
    if (configResolved.exists) {
      const existing = await readFile(configResolved.absPath, "utf8");
      assertParsable(existing, configResolved.absPath);
      mergedText = addPluginEntry(existing, { pluginName: PLUGIN_NAME });
    } else {
      mergedText = createInitialConfig({ pluginName: PLUGIN_NAME });
    }
    await backupAndWrite(projectRoot, configRelDest, mergedText);
    managedWritten.push(configRelDest);

    if (options.skipNpmInstall !== true) {
      await runNpmInstallOffline(projectRoot);
    }

    // Plugin-cache invalidation (REQ-TY2-014) — best-effort at the stamp's recorded path.
    const cacheInvalidated = await invalidatePluginCache(priorStamp.resolvedPluginCachePath);

    if (options.skipSmokeImport !== true) {
      await smokeImportExports(projectRoot);
    }

    // Refreshed stamp: recompute hashes, new version + timestamp, keep the resolved cache path.
    const managedFileHashes = await computeManagedFileHashes(projectRoot, managedWritten);
    const opencodeVersionAtInstall = await detectOpenCodeVersion();
    const tarballAbs = path.join(bundle.bundleDir, bundle.manifest.packageTarball);
    let bundleSha256 = "";
    try {
      const tarballBytes = await readFile(tarballAbs);
      bundleSha256 = createHash("sha256").update(tarballBytes).digest("hex");
    } catch {
      // Best-effort.
    }
    const stamp: InstallStamp = {
      schemaVersion: INSTALL_STAMP_SCHEMA_VERSION,
      version: plan.version,
      installedAt: new Date().toISOString(),
      bundleSha256,
      managedPaths: managedWritten,
      managedFileHashes,
      resolvedPluginCachePath: priorStamp.resolvedPluginCachePath,
      opencodeVersionAtInstall,
    };
    await writeStamp(projectRoot, stamp);

    await appendInstallLog(projectRoot, {
      command: "update",
      from: priorStamp.version,
      to: plan.version,
      status: "updated",
      cacheInvalidated,
      downgrade: cmp < 0,
    });

    return {
      kind: "updated",
      from: priorStamp.version,
      to: plan.version,
      managedPaths: managedWritten,
      cacheInvalidated,
    };
  } finally {
    if (lock !== undefined) {
      await lock.release();
    }
  }
}

// ============================================================================
// UNINSTALL LIFECYCLE (SPEC-TINY-YEAH-002 REQ-TY2-012, strategy §7 uninstall safety).
// ============================================================================

/**
 * Input to {@link uninstall}. The bin passes the project root + flags; tests pass nothing extra
 * (uninstall is Phase-1-only and needs no bundle).
 */
export interface UninstallOptions {
  /** Absolute path to the target project root. */
  readonly projectRoot: string;
  /** Remove .backup-<ts> files for managed paths too (default PRESERVES them — REQ-TY2-012 F6). */
  readonly purgeBackups?: boolean;
  /** Dry-run: return the removal plan, write/delete nothing. */
  readonly dryRun?: boolean;
  /** Emit machine-readable JSON output (informational for the bin). */
  readonly json?: boolean;
  /** Skip interactive confirmation (also implied in non-TTY). */
  readonly yes?: boolean;
}

/** Discriminated union of uninstall outcomes. */
export type UninstallResult =
  | {
      readonly kind: "uninstalled";
      readonly version: string;
      /** Managed paths that were removed (hash matched, unmodified). */
      readonly removed: readonly string[];
      /** Managed paths SKIPPED because the user modified them (hash mismatch) — NEVER deleted. */
      readonly skippedUserModified: readonly string[];
      /** Managed paths that were already absent (not an error). */
      readonly alreadyAbsent: readonly string[];
      /** Backup files purged by --purge-backups (empty when the flag is absent). */
      readonly purgedBackups: readonly string[];
    }
  | { readonly kind: "noop"; readonly reason: "not-installed" }
  | { readonly kind: "dry-run" };

/**
 * Compute the current SHA-256 of a file. Returns undefined when the file does not exist
 * (ENOENT). Any other read error propagates.
 */
async function sha256IfExists(absPath: string): Promise<string | undefined> {
  try {
    const content = await readFile(absPath);
    return createHash("sha256").update(content).digest("hex");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Execute the uninstall lifecycle (REQ-TY2-012). The LOAD-BEARING safety property: a managed file
 * whose current SHA-256 no longer matches the stamp's recorded hash is SKIPPED (user edited it),
 * NEVER deleted. User-owned files (not in managedPaths[]) are NEVER touched.
 *
 * Sequences:
 *   1. Resolve projectRoot; path-confinement.
 *   2. acquireInstallerLock.
 *   3. readStamp → noop {kind:"noop",reason:"not-installed"} if absent (idempotent, exit 0).
 *   4. dryRun → return {kind:"dry-run"}.
 *   5. HASH-COMPARE removal: for each managedPath, compute current hash, compare to stamp's.
 *      Match → remove; mismatch → skip + report; ENOENT → alreadyAbsent (not an error).
 *   6. Strip plugin entry from opencode.json[c] via removePluginEntry → backupAndWrite if changed.
 *   7. Remove the install stamp file.
 *   8. --purge-backups → also rm .backup-<ts> for managed paths (default PRESERVES — F6).
 *   9. Append structured log {event:"uninstalled", version, skippedUserModified}.
 *  10. Release lock (finally).
 *
 * NEVER deletes: user-owned files, .opencode/ itself, .opencode/node_modules/ wholesale. Only the
 * managed paths + the stamp are removed.
 */
export async function uninstall(options: UninstallOptions): Promise<UninstallResult> {
  const projectRoot = path.resolve(options.projectRoot);
  await assertProjectRoot(projectRoot);

  let lock: InstallerLockHandle | undefined;
  try {
    lock = await acquireInstallerLock(projectRoot);

    const stamp = await readStamp(projectRoot);
    if (stamp === null) {
      // Idempotent: uninstalling when not installed is a no-op (exit 0).
      return { kind: "noop", reason: "not-installed" };
    }

    if (options.dryRun === true) {
      return { kind: "dry-run" };
    }

    // HASH-COMPARE removal (REQ-TY2-012 MAJOR #2 — the load-bearing safety property).
    // NOTE: the opencode.json[c] config is EXCLUDED from raw hash-compare deletion. It is a managed
    // path (install overwrote it) but uninstall must SURGICALLY strip only the tiny-yeah entry,
    // preserving the rest of the user's config. It is handled separately below via removePluginEntry.
    const located = await locateOpenCodeConfig(projectRoot);
    const configRelForExclusion =
      located.exists === true ? path.relative(projectRoot, located.path) : undefined;

    const removed: string[] = [];
    const skippedUserModified: string[] = [];
    const alreadyAbsent: string[] = [];
    for (const relPath of stamp.managedPaths) {
      // Skip the opencode config — handled surgically below (strip entry, preserve the rest).
      if (relPath === configRelForExclusion) continue;
      const abs = path.join(projectRoot, relPath);
      const currentHash = await sha256IfExists(abs);
      if (currentHash === undefined) {
        // File is already gone — not an error.
        alreadyAbsent.push(relPath);
        continue;
      }
      const recordedHash = stamp.managedFileHashes[relPath];
      if (recordedHash !== undefined && currentHash !== recordedHash) {
        // USER MODIFIED the managed file — SKIP, NEVER delete.
        skippedUserModified.push(relPath);
        continue;
      }
      // Hash matches (or no recorded hash — treat as unmodified-managed, remove).
      try {
        await rm(abs, { force: true });
        removed.push(relPath);
      } catch {
        // Best-effort: report as alreadyAbsent if removal failed (e.g. race).
        alreadyAbsent.push(relPath);
      }
    }

    // Strip the tiny-yeah plugin entry from opencode.json[c] (surgical, preserves the rest).
    if (located.exists) {
      const existing = await readFile(located.path, "utf8");
      const result = removePluginEntry(existing, PLUGIN_NAME);
      if (result.changed) {
        const configRelDest = path.relative(projectRoot, located.path);
        await backupAndWrite(projectRoot, configRelDest, result.text);
      }
    }

    // Remove the install stamp file.
    const stampPath = path.join(projectRoot, ".opencode", ".tiny-yeah-install.json");
    await rm(stampPath, { force: true });

    // --purge-backups: also remove .backup-<ts> files for the managed paths (F6 — default PRESERVES).
    const purgedBackups: string[] = [];
    if (options.purgeBackups === true) {
      for (const relPath of stamp.managedPaths) {
        const dirAbs = path.dirname(path.join(projectRoot, relPath));
        const baseName = path.basename(relPath);
        let names: string[];
        try {
          names = await readdir(dirAbs);
        } catch {
          continue;
        }
        const backupPrefix = `${baseName}.backup-`;
        for (const name of names) {
          if (name.startsWith(backupPrefix)) {
            const backupAbs = path.join(dirAbs, name);
            try {
              await rm(backupAbs, { force: true });
              purgedBackups.push(path.relative(projectRoot, backupAbs));
            } catch {
              // Best-effort: a locked backup is not fatal.
            }
          }
        }
      }
    }

    await appendInstallLog(projectRoot, {
      command: "uninstall",
      version: stamp.version,
      status: "uninstalled",
      removed,
      skippedUserModified,
      alreadyAbsent,
      purgedBackups,
    });

    return {
      kind: "uninstalled",
      version: stamp.version,
      removed,
      skippedUserModified,
      alreadyAbsent,
      purgedBackups,
    };
  } finally {
    if (lock !== undefined) {
      await lock.release();
    }
  }
}

/**
 * Assert that projectRoot is a real, accessible directory (REQ-TY2-007 path confinement baseline).
 * Shared by install/update/uninstall so the three entry points agree on the projectRoot contract.
 * Throws InstallerError(PATH_ESCAPES_PROJECT) when the path is missing or not a directory.
 */
async function assertProjectRoot(projectRoot: string): Promise<void> {
  try {
    const info = await stat(projectRoot);
    if (!info.isDirectory()) {
      throw new InstallerError({
        code: "PATH_ESCAPES_PROJECT",
        message: `Project root is not a directory: ${projectRoot}`,
        recoveryHint: "Pass a valid directory via --project.",
      });
    }
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      throw new InstallerError({
        code: "PATH_ESCAPES_PROJECT",
        message: `Project root does not exist: ${projectRoot}`,
        recoveryHint: "Pass an existing directory via --project.",
        cause: error,
      });
    }
    throw error;
  }
}
