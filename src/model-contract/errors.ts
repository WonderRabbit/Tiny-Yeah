// Tiny-Yeah model-contract errors (SPEC-TINY-YEAH-001 REQ-TY-003/027/029, plan.md §3.8 M3).
//
// Every error that crosses the model boundary carries a stable `code` string so the head /
// install-check surfaces can branch on it without parsing prose, plus an actionable
// `recoveryHint` (M3) giving the model a one-line next step. Distinct from `YeahError`
// (core/checkpoint/errors.ts) which covers the write-path layers; this covers the
// model-emission boundary itself.

export type ModelContractErrorCode =
  | "MANIFEST_CONTENT_OVER_BUDGET"
  | "UNKNOWN_INTENT_FIELD"
  | "PATH_ESCAPES_ROOT"
  | "INVALID_ENCODING"
  | "MISSING_SCHEMA_VERSION";

export interface ModelContractErrorOptions {
  readonly code: ModelContractErrorCode;
  readonly message: string;
  readonly recoveryHint?: string;
  readonly cause?: unknown;
}

export class ModelContractError extends Error {
  override readonly name = "ModelContractError";
  readonly code: ModelContractErrorCode;
  readonly recoveryHint: string | undefined;

  constructor(options: ModelContractErrorOptions) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.code = options.code;
    this.recoveryHint = options.recoveryHint;
  }
}

export function isModelContractError(error: unknown): error is ModelContractError {
  return error instanceof ModelContractError;
}
