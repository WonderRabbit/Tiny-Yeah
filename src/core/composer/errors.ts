// Tiny-Yeah feature-package composer errors (SPEC-TINY-YEAH-001 REQ-TY-011).
// Generalized from Tiny-Chu `feature-package-types.ts` FeaturePackageError — host-agnostic,
// six rejection codes (composer rejects duplicate ids / missing deps / cycles / dup tool
// names; plus invalid_package / invalid_tool shape failures).

export type FeaturePackageErrorCode =
  | "duplicate_package_id"
  | "missing_dependency"
  | "dependency_cycle"
  | "duplicate_tool_name"
  | "invalid_package"
  | "invalid_tool";

export class FeaturePackageError extends Error {
  readonly code: FeaturePackageErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: FeaturePackageErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "FeaturePackageError";
    this.code = code;
    this.details = details;
  }
}
