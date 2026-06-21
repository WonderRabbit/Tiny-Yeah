// Typed error contract for the checkpointed write path (SPEC-TINY-YEAH-001 §6.2, plan.md §3.5/§3.6/M3).
//
// Every error that crosses the model boundary or surfaces to a caller carries a stable `code`
// string so downstream surfaces (head, install-check) can branch on it without parsing prose.
// `recoveryHint` (M3 actionable error format) gives the model/user a one-line next step.

export type YeahErrorCode =
  | "PREVIEW_REQUIRED"
  | "PREVIEW_STALE"
  | "PREVIEW_TARGET_EXISTS"
  | "APPLY_TARGET_EXISTS"
  | "APPLY_LOCKED"
  | "APPLY_TARGET_UNSAFE"
  | "STAGING_POINTER_INVALID"
  | "WRITE_LOCK_CONTENTION";

export interface YeahErrorOptions {
  readonly code: YeahErrorCode;
  readonly message: string;
  readonly recoveryHint?: string;
  readonly cause?: unknown;
}

export class YeahError extends Error {
  override readonly name = "YeahError";
  readonly code: YeahErrorCode;
  readonly recoveryHint: string | undefined;

  constructor(options: YeahErrorOptions) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.code = options.code;
    this.recoveryHint = options.recoveryHint;
  }
}

export function isYeahError(error: unknown): error is YeahError {
  return error instanceof YeahError;
}

export function hasErrorCode(error: unknown, code: YeahErrorCode): boolean {
  return error instanceof YeahError && error.code === code;
}

export function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as { code: unknown }).code === code;
}
