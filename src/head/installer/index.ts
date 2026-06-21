// Tiny-Yeah installer domain — Phase 1 (SPEC-TINY-YEAH-002, strategy §4 module map).
//
// The install-time writer domain. Per the SPEC central design proposition (strategy §3, Option C —
// Two-Domain), install writes are an ADMIN-TIME concern and do NOT flow through the model-contract
// create-only path (universal-write-path). They reuse atomic primitives from core/ but live in
// their own domain, separated from model-contract by an architecture firewall
// (tests/unit/installer-firewall.test.ts).
//
// Phase 1 modules (this barrel):
//   - bundle-reader.ts  : offline-bundle read + multi-layer integrity verify (fail-closed).
//   - lock.ts           : installer advisory lock at <project>/.opencode/.tiny-yeah-install.lock/.
//   - writer.ts         : install-time writer (atomicCopyFile / atomicOverwriteFile / backupAndWrite
//                         / atomicWriteJson) reusing core/ atomic primitives, path-confined.
//   - plan.ts           : source→target install-plan computation + --dry-run formatters.
//   - errors.ts         : InstallerError typed contract (stable codes + recoveryHint).
//
// Phase 2+ adds: lifecycle.ts (install/update/uninstall orchestration), opencode-config.ts
// (jsonc-parser JSONC-preserving deep-merge, confined here), doctor.ts. bin/tiny-yeah.js remains
// dep-free (REQ-TY2-018) and is NOT imported by this barrel.
//
// Tail-assumption resolutions (SPEC §10), encoded here for Phase 2 implementers:
//   A — plugin-cache path: resolve at RUNTIME via
//       `process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache")` joined with
//       "opencode/packages" (REQ-TY2-014, CRITICAL #1). NOT hardcoded LOCALAPPDATA.
//   B — plugin entry form: opencode-config merge (Phase 2) supports BOTH "tiny-yeah" (string)
//       and ["tiny-yeah", {...}] (tuple). Schema decision lands in Phase 2.
//   C — jsonc-parser: Phase-2 runtime dep CONFINED to this directory. bin/tiny-yeah.js is
//       dep-free (REQ-TY2-018) and MUST NOT import it.

export {
  BUNDLE_AIR_GAP_INCOMPLETE,
  BUNDLE_FILE_MISSING,
  BUNDLE_HASH_MISMATCH,
  BUNDLE_INSTALLER_BLOCK_MISSING,
  BUNDLE_MANIFEST_INVALID,
  BUNDLE_MANIFEST_NOT_FOUND,
  BUNDLE_SHA256SUMS_INVALID,
  type BundleManifest,
  bundleManifestSchema,
  readBundle,
  type VerifiedBundle,
  type VerifiedBundleEntry,
} from "./bundle-reader.js";
// Phase 4 modules — categorized install diagnostics (READ-ONLY). doctor.ts is confined to this
// directory like the rest of the installer domain; jsonc-parser is reused via opencode-config.ts.
export {
  type CheckCategory,
  type CheckResult,
  type CheckStatus,
  DEFAULT_DOCTOR_TIMEOUT_MS,
  DOCTOR_SCHEMA_VERSION,
  type DoctorMode,
  type DoctorOptions,
  type DoctorReport,
  type DoctorSummary,
  doctor,
  doctorReportSchema,
  doctorSummarySchema,
  MIN_OPENCODE_VERSION,
  type OverallHealth,
} from "./doctor.js";
export {
  hasInstallerErrorCode,
  InstallerError,
  type InstallerErrorCode,
  isInstallerError,
} from "./errors.js";
export {
  type InstallOptions,
  type InstallResult,
  install,
  type UninstallOptions,
  type UninstallResult,
  type UpdateOptions,
  type UpdateResult,
  uninstall,
  update,
} from "./lifecycle.js";
export {
  type AcquireInstallerLockOptions,
  acquireInstallerLock,
  INSTALLER_LOCK_DIR_NAME,
  INSTALLER_LOCK_STALE_MS,
  type InstallerLockHandle,
} from "./lock.js";
// Phase 2 modules — JSONC-preserving merge, install stamp, install lifecycle.
// jsonc-parser is CONFINED to opencode-config.ts (firewall: tests/unit/installer-firewall).
export {
  addPluginEntry,
  assertParsable,
  createInitialConfig,
  type LocatedOpenCodeConfig,
  locateOpenCodeConfig,
  type OpenCodeConfigFormat,
  type PluginEntryValue,
  type RemovePluginEntryResult,
  readPluginEntry,
  removePluginEntry,
} from "./opencode-config.js";
export {
  type ComputeInstallPlanInput,
  computeInstallPlan,
  formatDryRun,
  formatDryRunJson,
  type InstallPlan,
  type InstallPlanEntry,
  type InstallPlanKind,
} from "./plan.js";
export {
  compareSemver,
  isDowngrade,
  parseSemver,
  type SemverParts,
} from "./semver.js";
export {
  computeManagedFileHashes,
  INSTALL_STAMP_REL_PATH,
  INSTALL_STAMP_SCHEMA_VERSION,
  type InstallStamp,
  installStampSchema,
  readStamp,
  stampPathFor,
  writeStamp,
} from "./stamp.js";
export {
  atomicCopyFile,
  atomicCopyFileBinary,
  atomicOverwriteFile,
  atomicWriteJson,
  backupAndWrite,
  type WriteRetryOptions,
} from "./writer.js";

/**
 * Installer domain version marker. Mirrors the package version. Phase 4 surfaces doctor
 * (categorized diagnostics + --json) and completes the four CLI subcommands.
 */
export const INSTALLER_DOMAIN_VERSION = "phase-4" as const;
