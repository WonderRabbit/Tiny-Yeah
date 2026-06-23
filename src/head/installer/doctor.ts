// Tiny-Yeah doctor — categorized install diagnostics (SPEC-TINY-YEAH-002 REQ-TY2-013).
//
// READ-ONLY by construction: doctor NEVER writes to the project. It only reads state and dynamic-
// imports the vendored package's three exports (smoke import). The only output is the returned
// DoctorReport (and whatever the bin prints to stdout). This is enforced by a test that snapshots
// project file mtimes before/after a doctor run.
//
// Categories (REQ-TY2-013):
//   - system           : node-version (>=22.5.0), powershell-version (7+, warn-tolerated off-
//                         Windows), opencode-version (>=MIN_OPENCODE_VERSION=1.4.0, warn-tolerated
//                         when `opencode` is not on PATH).
//   - config           : opencode-config-parse, plugin-entry-present, jsonc-valid (JSONC facets).
//   - integration      : exports-smoke-import of `.`,`./opencode`,`./tui` from
//                         <project>/.opencode/node_modules/tiny-yeah (NOT vendor). This is the ONLY
//                         runtime check — the full fast-check property suite is dev-time territory.
//   - bundle-integrity : stamp-bundle-hash (recompute managed-file SHA-256 vs stamp), stamp-
//                         consistency (schemaVersion + managedPaths accounted for).
//
// Timeout (F5 binary AC): the whole run is wrapped in Promise.race against a timer. On timeout a
// DOCTOR_TIMEOUT typed result is emitted and overall is set to "degraded" (NEVER a hang). The
// timeout is configurable via DOCTOR_TIMEOUT_MS env (default 10000ms) or the timeoutMs option.
//
// --json schema: doctorReportSchema (schemaVersion "tiny-yeah.doctor.v1"). The bin emits the report
// as JSON when --json is passed.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { isInstallerError } from "./errors.js";
import { locateOpenCodeConfig, readPluginEntry } from "./opencode-config.js";
import { compareSemver } from "./semver.js";
import { computeManagedFileHashes, INSTALL_STAMP_SCHEMA_VERSION, readStamp } from "./stamp.js";

const execFileAsync = promisify(execFile);

/** Minimum required Node version (constraint §5 / assumption 4). */
const MIN_NODE_VERSION = "22.5.0";

/** Minimum required OpenCode version (assumption 1 / user decision 1). */
export const MIN_OPENCODE_VERSION = "1.4.0";

/** Doctor report schemaVersion. */
export const DOCTOR_SCHEMA_VERSION = "tiny-yeah.doctor.v1" as const;

/** Default doctor timeout (ms). Overridable via DOCTOR_TIMEOUT_MS env or the timeoutMs option. */
export const DEFAULT_DOCTOR_TIMEOUT_MS = 10000;

/** Doctor mode: standard runs the baseline checks; full adds deeper checks (e.g. bundle SHA256SUMS). */
export type DoctorMode = "standard" | "full";

export type CheckStatus = "pass" | "warn" | "fail";

export type CheckCategory = "system" | "config" | "integration" | "bundle-integrity";

/** A single doctor check result. */
export interface CheckResult {
  readonly id: string;
  readonly category: CheckCategory;
  readonly status: CheckStatus;
  readonly detail: string;
  readonly recoveryHint?: string;
}

/** Overall health derived from the per-check statuses. */
export type OverallHealth = "healthy" | "degraded" | "broken";

export interface DoctorSummary {
  readonly overall: OverallHealth;
  readonly pass: number;
  readonly warn: number;
  readonly fail: number;
}

/** Zod schema for one check result. */
export const checkResultSchema = z
  .object({
    id: z.string().min(1),
    category: z.enum(["system", "config", "integration", "bundle-integrity"]),
    status: z.enum(["pass", "warn", "fail"]),
    detail: z.string(),
    recoveryHint: z.string().optional(),
  })
  .strict();

/** Zod schema for the summary. */
export const doctorSummarySchema = z
  .object({
    overall: z.enum(["healthy", "degraded", "broken"]),
    pass: z.number().int().nonnegative(),
    warn: z.number().int().nonnegative(),
    fail: z.number().int().nonnegative(),
  })
  .strict();

/** Zod schema for the full doctor report (--json output contract). */
export const doctorReportSchema = z
  .object({
    schemaVersion: z.literal(DOCTOR_SCHEMA_VERSION),
    projectRoot: z.string().min(1),
    mode: z.enum(["standard", "full"]),
    ranAt: z.string().min(1),
    durationMs: z.number().nonnegative(),
    summary: doctorSummarySchema,
    checks: z.array(checkResultSchema),
  })
  .strict();

export type DoctorReport = z.infer<typeof doctorReportSchema>;

/** Options for {@link doctor}. */
export interface DoctorOptions {
  /** Absolute path to the target project root. */
  readonly projectRoot: string;
  /** Diagnostic mode (default "standard"). */
  readonly mode?: DoctorMode;
  /**
   * Offline bundle directory for mode:"full" deeper checks (bundle SHA256SUMS recompute). When
   * omitted in full mode, the full-only checks are skipped with a warn.
   */
  readonly bundleDir?: string;
  /** Override the timeout (default: DOCTOR_TIMEOUT_MS env or {@link DEFAULT_DOCTOR_TIMEOUT_MS}). */
  readonly timeoutMs?: number;
  /**
   * Extra checks to run AFTER the built-in checks. TEST HOOK + extensibility — used by the
   * timeout AC to inject a slow check. Each must return a CheckResult.
   */
  readonly extraChecks?: ReadonlyArray<() => Promise<CheckResult>>;
}

/** Resolve the effective timeout: option > env > default. */
function resolveTimeoutMs(option: number | undefined): number {
  if (typeof option === "number" && Number.isFinite(option) && option > 0) return option;
  const envRaw = process.env.DOCTOR_TIMEOUT_MS;
  if (envRaw !== undefined) {
    const parsed = Number.parseInt(envRaw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_DOCTOR_TIMEOUT_MS;
}

/** Aggregate per-check statuses into a summary + overall health. */
function summarize(checks: readonly CheckResult[]): DoctorSummary {
  let pass = 0;
  let warn = 0;
  let fail = 0;
  for (const c of checks) {
    if (c.status === "pass") pass += 1;
    else if (c.status === "warn") warn += 1;
    else fail += 1;
  }
  let overall: OverallHealth;
  if (fail > 0) overall = "broken";
  else if (warn > 0) overall = "degraded";
  else overall = "healthy";
  return { overall, pass, warn, fail };
}

// ============================================================================
// SYSTEM CHECKS
// ============================================================================

/** Compare the running Node version to MIN_NODE_VERSION. */
async function checkNodeVersion(): Promise<CheckResult> {
  const running = process.versions.node;
  let cmp: -1 | 0 | 1;
  try {
    cmp = compareSemver(running, MIN_NODE_VERSION);
  } catch {
    // Non-semver Node version string — treat as fail with the observed version in detail.
    return {
      id: "node-version",
      category: "system",
      status: "fail",
      detail: `Could not parse running Node version '${running}'.`,
      recoveryHint: `Install Node >= ${MIN_NODE_VERSION}.`,
    };
  }
  if (cmp >= 0) {
    return {
      id: "node-version",
      category: "system",
      status: "pass",
      detail: `Node ${running} (>= ${MIN_NODECODE_VERSION_STRING()}).`,
    };
  }
  return {
    id: "node-version",
    category: "system",
    status: "fail",
    detail: `Node ${running} is older than the required ${MIN_NODE_VERSION}.`,
    recoveryHint: `Upgrade Node to >= ${MIN_NODE_VERSION}.`,
  };
}

// Trivial indirection so the pass-detail string stays in one place; avoids a magic constant.
function MIN_NODECODE_VERSION_STRING(): string {
  return MIN_NODE_VERSION;
}

/** Best-effort PowerShell version probe. */
async function checkPowershellVersion(): Promise<CheckResult> {
  try {
    const { stdout } = await execFileAsync("pwsh", ["--version"], { timeout: 3000 });
    const trimmed = stdout.trim();
    // Expected: "PowerShell 7.4.1" or similar.
    const majorMatch = /\b(\d+)\./.exec(trimmed);
    const major = majorMatch?.[1] !== undefined ? Number.parseInt(majorMatch[1], 10) : NaN;
    if (Number.isFinite(major) && major >= 7) {
      return {
        id: "powershell-version",
        category: "system",
        status: "pass",
        detail: `PowerShell ${trimmed} detected.`,
      };
    }
    if (process.platform === "win32") {
      return {
        id: "powershell-version",
        category: "system",
        status: "fail",
        detail: `Detected '${trimmed}' but PowerShell 7+ is required on Windows.`,
        recoveryHint: "Install PowerShell 7+ (https://aka.ms/powershell).",
      };
    }
    return {
      id: "powershell-version",
      category: "system",
      status: "warn",
      detail: `pwsh present but version '${trimmed}' is below 7.`,
      recoveryHint: "Install PowerShell 7+ for full installer support.",
    };
  } catch {
    // pwsh probe failed (ENOENT, timeout, etc.). On Windows this is a hard fail; on non-Windows
    // it is a tolerated warn (PowerShell-only runtime; the user may install pwsh before install).
    if (process.platform === "win32") {
      return {
        id: "powershell-version",
        category: "system",
        status: "fail",
        detail: "PowerShell 7+ (pwsh) was not detected on Windows.",
        recoveryHint: "Install PowerShell 7+ (https://aka.ms/powershell).",
      };
    }
    // Non-Windows: pwsh not on PATH is tolerated as a warn (the runtime is PowerShell-only at
    // install time; the user may install pwsh before running install).
    return {
      id: "powershell-version",
      category: "system",
      status: "warn",
      detail: "PowerShell-only runtime; pwsh not detected (non-Windows dev machine tolerated).",
      recoveryHint: "Install PowerShell 7+ before running `tiny-yeah install`.",
    };
  }
}

/** Best-effort OpenCode version probe. Warns when `opencode` is absent (install can still proceed). */
async function checkOpencodeVersion(): Promise<CheckResult> {
  let stdout = "";
  try {
    const result = await execFileAsync("opencode", ["--version"], { timeout: 3000 });
    stdout = result.stdout.trim();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("ENOENT") || msg.includes("not found") || msg.includes("spawn")) {
      return {
        id: "opencode-version",
        category: "system",
        status: "warn",
        detail: "`opencode` is not on PATH; runtime plugin load would fail at startup.",
        recoveryHint: `Install OpenCode >= ${MIN_OPENCODE_VERSION}.`,
      };
    }
    return {
      id: "opencode-version",
      category: "system",
      status: "warn",
      detail: `Could not probe opencode version: ${msg}`,
      recoveryHint: `Ensure OpenCode >= ${MIN_OPENCODE_VERSION} is installed.`,
    };
  }
  if (stdout.length === 0) {
    return {
      id: "opencode-version",
      category: "system",
      status: "warn",
      detail: "`opencode --version` produced no output.",
      recoveryHint: `Ensure OpenCode >= ${MIN_OPENCODE_VERSION} is installed.`,
    };
  }
  // Extract the first semver-looking token from the version string.
  const semverMatch = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?)/.exec(stdout);
  if (semverMatch?.[1] === undefined) {
    return {
      id: "opencode-version",
      category: "system",
      status: "warn",
      detail: `opencode reported '${stdout}' — could not parse a semver.`,
      recoveryHint: `Ensure OpenCode >= ${MIN_OPENCODE_VERSION} is installed.`,
    };
  }
  const detected = semverMatch[1];
  try {
    const cmp = compareSemver(detected, MIN_OPENCODE_VERSION);
    if (cmp >= 0) {
      return {
        id: "opencode-version",
        category: "system",
        status: "pass",
        detail: `OpenCode ${detected} (>= ${MIN_OPENCODE_VERSION}).`,
      };
    }
    return {
      id: "opencode-version",
      category: "system",
      status: "fail",
      detail: `OpenCode ${detected} is older than the required ${MIN_OPENCODE_VERSION}.`,
      recoveryHint: `Upgrade OpenCode to >= ${MIN_OPENCODE_VERSION}.`,
    };
  } catch {
    return {
      id: "opencode-version",
      category: "system",
      status: "warn",
      detail: `opencode reported '${detected}' — could not compare to ${MIN_OPENCODE_VERSION}.`,
    };
  }
}

// ============================================================================
// CONFIG CHECKS
// ============================================================================

interface ConfigProbe {
  readonly locatedPath: string;
  readonly exists: boolean;
  readonly text: string | undefined;
  /** True when the config parsed as JSONC; false when malformed; undefined when no config. */
  readonly parsable: boolean | undefined;
}

async function probeConfig(projectRoot: string): Promise<ConfigProbe> {
  const located = await locateOpenCodeConfig(projectRoot);
  if (!located.exists) {
    return { locatedPath: located.path, exists: false, text: undefined, parsable: undefined };
  }
  let text: string;
  try {
    text = await readFile(located.path, "utf8");
  } catch {
    return { locatedPath: located.path, exists: true, text: undefined, parsable: false };
  }
  // JSONC parse via the same jsonc-parser path opencode-config uses. Import lazily to keep doctor's
  // static surface small; jsonc-parser is already a dependency confined to this directory.
  // JSONC parse via the same jsonc-parser path opencode-config uses. parseTree populates the
  // errors array with non-zero codes for GENUINE syntax errors (unclosed brace, bad escape, etc.)
  // while tolerating JSONC facets (comments, trailing comma). An empty errors array = clean parse.
  let parsable = true;
  try {
    const { parseTree } = await import("jsonc-parser");
    const errors: Array<{ error: number }> = [];
    const root = parseTree(text, errors as never, { allowTrailingComma: true });
    parsable = root !== undefined && errors.length === 0;
  } catch {
    parsable = false;
  }
  return { locatedPath: located.path, exists: true, text, parsable };
}

async function checkConfigParse(probe: ConfigProbe): Promise<CheckResult> {
  if (!probe.exists) {
    return {
      id: "opencode-config-parse",
      category: "config",
      status: "warn",
      detail: "No opencode.json[c] found yet (pre-install state).",
      recoveryHint: "Run `tiny-yeah install` to create the config with the plugin entry.",
    };
  }
  if (probe.parsable === true) {
    return {
      id: "opencode-config-parse",
      category: "config",
      status: "pass",
      detail: `opencode config at ${probe.locatedPath} parsed cleanly.`,
    };
  }
  return {
    id: "opencode-config-parse",
    category: "config",
    status: "fail",
    detail: `opencode config at ${probe.locatedPath} failed JSONC parse.`,
    recoveryHint: "Fix the JSONC syntax or remove the file so install can recreate it.",
  };
}

async function checkPluginEntry(probe: ConfigProbe): Promise<CheckResult> {
  if (!probe.exists || probe.text === undefined) {
    return {
      id: "plugin-entry-present",
      category: "config",
      status: "warn",
      detail: "No opencode config — tiny-yeah plugin entry not registered yet.",
      recoveryHint: "Run `tiny-yeah install` to register the plugin.",
    };
  }
  const entry = readPluginEntry(probe.text, "tiny-yeah");
  if (entry !== undefined) {
    return {
      id: "plugin-entry-present",
      category: "config",
      status: "pass",
      detail: "tiny-yeah plugin entry is present in the opencode config.",
    };
  }
  return {
    id: "plugin-entry-present",
    category: "config",
    status: "warn",
    detail: "tiny-yeah plugin entry is absent from the opencode config.",
    recoveryHint: "Run `tiny-yeah install` (or reinstall) to register the plugin.",
  };
}

async function checkJsoncValid(probe: ConfigProbe): Promise<CheckResult> {
  if (!probe.exists) {
    return {
      id: "jsonc-valid",
      category: "config",
      status: "warn",
      detail: "No opencode config to validate.",
    };
  }
  if (probe.parsable === true) {
    return {
      id: "jsonc-valid",
      category: "config",
      status: "pass",
      detail: "JSONC (comments, trailing comma) tolerated by the parser.",
    };
  }
  return {
    id: "jsonc-valid",
    category: "config",
    status: "fail",
    detail: "opencode config is not valid JSONC.",
    recoveryHint: "Fix the JSONC syntax in the existing opencode.json[c].",
  };
}

// ============================================================================
// INTEGRATION CHECK (smoke import — READ-ONLY)
// ============================================================================

/**
 * Smoke-import the three exports from <project>/.opencode/node_modules/tiny-yeah. READ-ONLY: only
 * dynamic import() + reads the package.json exports. Mirrors lifecycle.smokeImportExports but is
 * intentional about NEVER touching vendor/ (REQ-TY2-013 MINOR #5).
 */
async function checkExportsSmokeImport(projectRoot: string): Promise<CheckResult> {
  const { pathToFileURL } = await import("node:url");
  const packageRoot = path.join(projectRoot, ".opencode", "node_modules", "tiny-yeah");
  const pkgJsonPath = path.join(packageRoot, "package.json");
  let exportsMap: Record<string, { import?: string; default?: string }>;
  try {
    const raw = await readFile(pkgJsonPath, "utf8");
    exportsMap = (
      JSON.parse(raw) as { exports: Record<string, { import?: string; default?: string }> }
    ).exports;
  } catch (error) {
    const enoent =
      error instanceof Error && "code" in error && (error as { code?: unknown }).code === "ENOENT";
    if (enoent) {
      return {
        id: "exports-smoke-import",
        category: "integration",
        status: "warn",
        detail: "No .opencode/node_modules/tiny-yeah yet (install not completed).",
        recoveryHint: "Run `tiny-yeah install` to materialize the vendored package.",
      };
    }
    return {
      id: "exports-smoke-import",
      category: "integration",
      status: "fail",
      detail: `Could not read package.json exports at ${pkgJsonPath}.`,
      recoveryHint: "Rebuild the offline bundle; the vendored package may be corrupt.",
    };
  }
  const subpaths = [".", "./opencode", "./tui"];
  for (const sub of subpaths) {
    const entry = exportsMap[sub];
    const resolvedRel = entry?.import ?? entry?.default;
    if (typeof resolvedRel !== "string") {
      return {
        id: "exports-smoke-import",
        category: "integration",
        status: "fail",
        detail: `package.json has no exports['${sub}'] target.`,
        recoveryHint: "Rebuild the offline bundle; the exports map is incomplete.",
      };
    }
    const resolvedAbs = path.join(packageRoot, resolvedRel);
    try {
      await import(pathToFileURL(resolvedAbs).href);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        id: "exports-smoke-import",
        category: "integration",
        status: "fail",
        detail: `Smoke import failed for '${sub}' from .opencode/node_modules/tiny-yeah (target ${resolvedRel}): ${msg}`,
        recoveryHint:
          "The vendored package may be incomplete. Rebuild the offline bundle with `npm run release:offline`.",
      };
    }
  }
  return {
    id: "exports-smoke-import",
    category: "integration",
    status: "pass",
    detail:
      "All three exports (., ./opencode, ./tui) resolved from .opencode/node_modules/tiny-yeah.",
  };
}

// ============================================================================
// BUNDLE-INTEGRITY CHECKS
// ============================================================================

/** Read the stamp, converting InstallerError(INSTALL_STAMP_SCHEMA_MISMATCH) into a warn probe. */
async function probeStamp(
  projectRoot: string,
): Promise<
  | { kind: "ok"; stamp: NonNullable<Awaited<ReturnType<typeof readStamp>>> }
  | { kind: "absent" }
  | { kind: "corrupt"; message: string }
> {
  try {
    const stamp = await readStamp(projectRoot);
    if (stamp === null) return { kind: "absent" };
    return { kind: "ok", stamp };
  } catch (error) {
    if (isInstallerError(error)) {
      return { kind: "corrupt", message: error.message };
    }
    return { kind: "corrupt", message: error instanceof Error ? error.message : String(error) };
  }
}

async function checkStampBundleHash(
  projectRoot: string,
  probe: Awaited<ReturnType<typeof probeStamp>>,
): Promise<CheckResult> {
  if (probe.kind === "absent") {
    return {
      id: "stamp-bundle-hash",
      category: "bundle-integrity",
      status: "warn",
      detail: "No install stamp — nothing to hash-compare yet.",
    };
  }
  if (probe.kind === "corrupt") {
    return {
      id: "stamp-bundle-hash",
      category: "bundle-integrity",
      status: "warn",
      detail: `Install stamp unreadable: ${probe.message}`,
    };
  }
  const current = await computeManagedFileHashes(projectRoot, probe.stamp.managedPaths);
  const mismatches: string[] = [];
  let allPresent = true;
  for (const relPath of probe.stamp.managedPaths) {
    const recorded = probe.stamp.managedFileHashes[relPath];
    const now = current[relPath];
    if (now === undefined) {
      allPresent = false;
      mismatches.push(`${relPath} (missing)`);
    } else if (recorded !== now) {
      mismatches.push(`${relPath} (modified since install)`);
    }
  }
  if (mismatches.length === 0) {
    return {
      id: "stamp-bundle-hash",
      category: "bundle-integrity",
      status: "pass",
      detail: `All ${probe.stamp.managedPaths.length} managed file hashes match the stamp.`,
    };
  }
  // Mismatches are WARNS, not fails — user edits are allowed; doctor only flags them.
  return {
    id: "stamp-bundle-hash",
    category: "bundle-integrity",
    status: "warn",
    detail: `Managed file hash mismatches: ${mismatches.join("; ")}${allPresent ? "" : " (some files missing)"}.`,
    recoveryHint:
      "This is informational (user edits are allowed). Re-run `tiny-yeah install --force` to refresh the stamp.",
  };
}

async function checkStampConsistency(
  probe: Awaited<ReturnType<typeof probeStamp>>,
): Promise<CheckResult> {
  if (probe.kind === "absent") {
    return {
      id: "stamp-consistency",
      category: "bundle-integrity",
      status: "warn",
      detail: "No install stamp — consistency check skipped.",
    };
  }
  if (probe.kind === "corrupt") {
    return {
      id: "stamp-consistency",
      category: "bundle-integrity",
      status: "warn",
      detail: `Install stamp corrupt: ${probe.message}`,
      recoveryHint: "Re-run `tiny-yeah install --force` to rewrite the stamp.",
    };
  }
  const stamp = probe.stamp;
  if (stamp.schemaVersion !== INSTALL_STAMP_SCHEMA_VERSION) {
    return {
      id: "stamp-consistency",
      category: "bundle-integrity",
      status: "warn",
      detail: `Stamp schemaVersion '${stamp.schemaVersion}' != expected '${INSTALL_STAMP_SCHEMA_VERSION}'.`,
    };
  }
  // Every managedPath must have a hash recorded.
  const unaccounted = stamp.managedPaths.filter((p) => stamp.managedFileHashes[p] === undefined);
  if (unaccounted.length > 0) {
    return {
      id: "stamp-consistency",
      category: "bundle-integrity",
      status: "warn",
      detail: `Managed paths without a recorded hash: ${unaccounted.join("; ")}.`,
    };
  }
  return {
    id: "stamp-consistency",
    category: "bundle-integrity",
    status: "pass",
    detail: `Stamp schemaVersion consistent; all ${stamp.managedPaths.length} managed paths accounted for.`,
  };
}

// ============================================================================
// FULL-MODE CHECKS
// ============================================================================

/** mode:"full" only — recompute the bundle's SHA256SUMS file (when --bundle provided). */
async function checkBundleSha256sums(
  bundleDir: string | undefined,
): Promise<CheckResult | undefined> {
  if (bundleDir === undefined) {
    return {
      id: "bundle-sha256sums-full",
      category: "bundle-integrity",
      status: "warn",
      detail: "mode:full but no --bundle provided; skipping bundle SHA256SUMS recompute.",
    };
  }
  const archiveInput = bundleDir.endsWith(".tar.gz") || bundleDir.endsWith(".tgz");
  const sumsBaseDir = archiveInput ? path.dirname(bundleDir) : bundleDir;
  const sumsPath = path.join(sumsBaseDir, "SHA256SUMS");
  const expectedArchiveName = archiveInput ? path.basename(bundleDir) : undefined;
  let raw: string;
  try {
    raw = await readFile(sumsPath, "utf8");
  } catch (error) {
    const enoent =
      error instanceof Error && "code" in error && (error as { code?: unknown }).code === "ENOENT";
    if (enoent) {
      return {
        id: "bundle-sha256sums-full",
        category: "bundle-integrity",
        status: "warn",
        detail: `No SHA256SUMS at ${sumsPath} (bundle may predate the integrity manifest).`,
      };
    }
    return {
      id: "bundle-sha256sums-full",
      category: "bundle-integrity",
      status: "fail",
      detail: `Could not read ${sumsPath}.`,
    };
  }
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const mismatches: string[] = [];
  let checked = 0;
  for (const line of lines) {
    // Format: "<sha256>  <path>"
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    const expected = match[1];
    const relPath = match[2].trim();
    if (expectedArchiveName !== undefined && path.basename(relPath) !== expectedArchiveName)
      continue;
    const abs = path.join(sumsBaseDir, relPath);
    try {
      const content = await readFile(abs);
      const actual = createHash("sha256").update(content).digest("hex");
      if (actual !== expected) mismatches.push(`${relPath}`);
      checked += 1;
    } catch {
      mismatches.push(`${relPath} (missing)`);
      checked += 1;
    }
  }
  if (expectedArchiveName !== undefined && checked === 0) {
    return {
      id: "bundle-sha256sums-full",
      category: "bundle-integrity",
      status: "fail",
      detail: `No SHA256SUMS entry found for ${expectedArchiveName}.`,
      recoveryHint: "Rebuild the offline bundle so SHA256SUMS is written beside the archive.",
    };
  }
  if (mismatches.length === 0) {
    return {
      id: "bundle-sha256sums-full",
      category: "bundle-integrity",
      status: "pass",
      detail: `All ${checked} SHA256SUMS entries verified against ${bundleDir}.`,
    };
  }
  return {
    id: "bundle-sha256sums-full",
    category: "bundle-integrity",
    status: "fail",
    detail: `Bundle SHA256SUMS mismatches: ${mismatches.join("; ")}.`,
    recoveryHint: "The bundle may be tampered or partially extracted. Rebuild or re-extract it.",
  };
}

/** mode:"full" only — check the resolvedPluginCachePath recorded in the stamp exists. */
async function checkResolvedPluginCachePath(
  probe: Awaited<ReturnType<typeof probeStamp>>,
): Promise<CheckResult | undefined> {
  if (probe.kind !== "ok") {
    return {
      id: "plugin-cache-path-full",
      category: "bundle-integrity",
      status: "warn",
      detail: "No readable install stamp — resolved plugin-cache path not checked.",
    };
  }
  const cachePath = probe.stamp.resolvedPluginCachePath;
  try {
    await stat(cachePath);
    return {
      id: "plugin-cache-path-full",
      category: "bundle-integrity",
      status: "pass",
      detail: `Resolved plugin-cache path exists: ${cachePath}`,
    };
  } catch {
    return {
      id: "plugin-cache-path-full",
      category: "bundle-integrity",
      status: "warn",
      detail: `Resolved plugin-cache path does not exist: ${cachePath} (will be created on next install).`,
    };
  }
}

/** mode:"full" only — verify the bundle's vendor tarball is referenced by the installed stamp. */
async function checkVendorTarballReferenced(
  projectRoot: string,
  probe: Awaited<ReturnType<typeof probeStamp>>,
): Promise<CheckResult | undefined> {
  if (probe.kind !== "ok") {
    return {
      id: "vendor-tarball-referenced-full",
      category: "bundle-integrity",
      status: "warn",
      detail: "No readable install stamp — vendor tarball reference not checked.",
    };
  }
  const pkgPath = path.join(projectRoot, ".opencode", "package.json");
  try {
    const raw = await readFile(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string> };
    const declared = pkg.dependencies?.["tiny-yeah"] ?? "(not declared)";
    return {
      id: "vendor-tarball-referenced-full",
      category: "bundle-integrity",
      status: "pass",
      detail: `.opencode/package.json declares tiny-yeah as '${declared}'.`,
    };
  } catch {
    return {
      id: "vendor-tarball-referenced-full",
      category: "bundle-integrity",
      status: "warn",
      detail: ".opencode/package.json missing or unreadable.",
    };
  }
}

// ============================================================================
// ORCHESTRATION
// ============================================================================

/** Run all built-in checks (standard mode). Returns the checks array (no aggregation). */
async function runBuiltInChecks(
  projectRoot: string,
  mode: DoctorMode,
  bundleDir: string | undefined,
): Promise<CheckResult[]> {
  const configProbe = await probeConfig(projectRoot);
  const stampProbe = await probeStamp(projectRoot);

  const checks: CheckResult[] = [];
  // System
  checks.push(await checkNodeVersion());
  checks.push(await checkPowershellVersion());
  checks.push(await checkOpencodeVersion());
  // Config
  checks.push(await checkConfigParse(configProbe));
  checks.push(await checkPluginEntry(configProbe));
  checks.push(await checkJsoncValid(configProbe));
  // Integration (smoke import — the ONLY runtime check)
  checks.push(await checkExportsSmokeImport(projectRoot));
  // Bundle-integrity
  checks.push(await checkStampBundleHash(projectRoot, stampProbe));
  checks.push(await checkStampConsistency(stampProbe));

  if (mode === "full") {
    const sha = await checkBundleSha256sums(bundleDir);
    if (sha !== undefined) checks.push(sha);
    const cache = await checkResolvedPluginCachePath(stampProbe);
    if (cache !== undefined) checks.push(cache);
    const vendor = await checkVendorTarballReferenced(projectRoot, stampProbe);
    if (vendor !== undefined) checks.push(vendor);
  }
  return checks;
}

/** Build the timeout report (overall degraded, DOCTOR_TIMEOUT typed result). */
function buildTimeoutReport(
  projectRoot: string,
  mode: DoctorMode,
  startedAt: number,
  timeoutMs: number,
): DoctorReport {
  const timeoutCheck: CheckResult = {
    id: "DOCTOR_TIMEOUT",
    category: "system",
    status: "fail",
    detail: `doctor exceeded the timeout (${timeoutMs}ms); aborting to avoid a hang.`,
    recoveryHint: "Increase DOCTOR_TIMEOUT_MS or simplify the install state being diagnosed.",
  };
  // Per REQ-TY2-013 F5 AC: overall is "degraded" (not "broken") so the user gets a result, not a
  // hang. The DOCTOR_TIMEOUT check is status:"fail" but the overall is explicitly degraded.
  const summary: DoctorSummary = {
    overall: "degraded",
    pass: 0,
    warn: 0,
    fail: 1,
  };
  return {
    schemaVersion: DOCTOR_SCHEMA_VERSION,
    projectRoot: path.resolve(projectRoot),
    mode,
    ranAt: new Date(startedAt).toISOString(),
    durationMs: timeoutMs,
    summary,
    checks: [timeoutCheck],
  };
}

/**
 * Run the categorized install diagnostics. READ-ONLY: writes nothing to the project. Wraps the
 * whole run in a Promise.race timeout so the binary AC (F5) holds — no hang, DOCTOR_TIMEOUT result
 * on timeout, overall degraded.
 */
export async function doctor(options: DoctorOptions): Promise<DoctorReport> {
  const projectRoot = path.resolve(options.projectRoot);
  const mode: DoctorMode = options.mode ?? "standard";
  const timeoutMs = resolveTimeoutMs(options.timeoutMs);
  const startedAt = Date.now();

  const work = (async (): Promise<DoctorReport> => {
    const checks = await runBuiltInChecks(projectRoot, mode, options.bundleDir);
    if (options.extraChecks !== undefined) {
      for (const extra of options.extraChecks) {
        try {
          checks.push(await extra());
        } catch (error) {
          checks.push({
            id: "extra-check-error",
            category: "integration",
            status: "fail",
            detail: `An extra check threw: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    }
    const summary = summarize(checks);
    return {
      schemaVersion: DOCTOR_SCHEMA_VERSION,
      projectRoot,
      mode,
      ranAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      summary,
      checks,
    };
  })();

  const timer = new Promise<{ timedOut: true }>((resolve) => {
    setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });

  const settled = await Promise.race([
    work.then((report) => ({ timedOut: false as const, report })),
    timer,
  ]);
  if (settled.timedOut) {
    return buildTimeoutReport(projectRoot, mode, startedAt, timeoutMs);
  }
  return settled.report;
}
