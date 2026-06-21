// Tiny-Yeah composer barrel (SPEC-TINY-YEAH-001 REQ-TY-011).

export { composeFeaturePackages } from "./composer.js";
export { createDefaultTinyYeahFeaturePackages } from "./default-packages.js";
export { FeaturePackageError, type FeaturePackageErrorCode } from "./errors.js";
export { type OrderedPackages, validateAndOrderFeaturePackages } from "./order.js";
export type {
  TinyYeahComposedRegistry,
  TinyYeahComposedToolSpec,
  TinyYeahFeatureCategory,
  TinyYeahFeaturePackage,
  TinyYeahFeaturePackageSummary,
  TinyYeahInstructionDescriptor,
  TinyYeahJsonSchema,
  TinyYeahOutputMode,
  TinyYeahPermissionHint,
  TinyYeahPromptDescriptor,
  TinyYeahResourceDescriptor,
  TinyYeahSmallModelHint,
  TinyYeahToolContext,
  TinyYeahToolDescriptor,
  TinyYeahToolHandler,
} from "./types.js";
