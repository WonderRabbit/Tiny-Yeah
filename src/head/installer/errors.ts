// Tiny-Yeah installer typed error contract (SPEC-TINY-YEAH-002, strategy §4/§7, REQ-TY2-002/003/007).
//
// Every installer error carries a stable `code` string so the bin (Phase 1, dep-free) and the
// Phase 2+ lifecycle can branch on it without parsing prose. `recoveryHint` gives the user a
// one-line next step (M3 actionable error format inherited from core/checkpoint/errors.ts).
//
// Domain separation (strategy §3, Option C): installer errors are DISTINCT from the
// core/checkpoint YeahError codes. The installer reuses atomic PRIMITIVES (withWriteRetry,
// writeCreateOnlyFile, writeJsonAtomic) but does NOT route writes through preview/apply, so
// its error surface is its own. WriteLockContentionError is re-exported from
// core/checkpoint/atomic-write.ts (the primitive) — that ONE shared error is intentional.

/**
 * Stable installer error codes. Reserved-but-unimplemented codes (Phase 2/3 lifecycle) are
 * listed here so the union is exhaustive up front and callers can switch on it safely.
 */
export type InstallerErrorCode =
  // Bundle integrity (bundle-reader, REQ-TY2-002)
  | "BUNDLE_MANIFEST_INVALID"
  | "BUNDLE_MANIFEST_NOT_FOUND"
  | "BUNDLE_AIR_GAP_INCOMPLETE"
  | "BUNDLE_HASH_MISMATCH"
  | "BUNDLE_FILE_MISSING"
  | "BUNDLE_INSTALLER_BLOCK_MISSING"
  | "BUNDLE_SHA256SUMS_INVALID"
  // Install lock (lock.ts, REQ-TY2-003 MAJOR #4)
  | "INSTALL_LOCKED"
  // Path confinement (writer/plan, REQ-TY2-007)
  | "PATH_ESCAPES_PROJECT"
  // Write failures (writer.ts, REQ-TY2-006)
  | "WRITE_FAILED"
  | "CREATE_ONLY_TARGET_EXISTS"
  // Reserved for Phase 2/3 lifecycle (REQ-TY2-009/011/012)
  | "MANAGED_HASH_MISMATCH"
  | "EXISTING_DEP_CONFLICT"
  | "INSTALL_STAMP_SCHEMA_MISMATCH"
  // Phase 3 lifecycle (REQ-TY2-011/012/014): update requires a prior install;
  // downgrade rejected without --allow-downgrade; npm offline install failed;
  // plugin-cache invalidation was partial (best-effort, does not fail the run).
  | "INSTALL_STAMP_MISSING"
  | "DOWNGRADE_REJECTED"
  | "NPM_OFFLINE_INSTALL_FAILED"
  | "CACHE_INVALIDATION_PARTIAL";

export interface InstallerErrorOptions {
  readonly code: InstallerErrorCode;
  readonly message: string;
  readonly recoveryHint?: string;
  readonly cause?: unknown;
}

/**
 * Base installer error. All installer-domain failures extend or instantiate this. The `code`
 * field is the load-bearing contract — callers branch on it, never on message text.
 */
export class InstallerError extends Error {
  override readonly name = "InstallerError";
  readonly code: InstallerErrorCode;
  readonly recoveryHint: string | undefined;

  constructor(options: InstallerErrorOptions) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.code = options.code;
    this.recoveryHint = options.recoveryHint;
  }
}

export function isInstallerError(error: unknown): error is InstallerError {
  return error instanceof InstallerError;
}

export function hasInstallerErrorCode(error: unknown, code: InstallerErrorCode): boolean {
  return error instanceof InstallerError && error.code === code;
}
