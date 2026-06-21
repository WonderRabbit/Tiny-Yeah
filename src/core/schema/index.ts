// Tiny-Yeah schema barrel — single schema entry point (SPEC-TINY-YEAH-001 plan.md §4).

export {
  type CommitManifestIntent,
  type ComposedToolSpec,
  checkpointSchema,
  commitManifestIntentSchema,
  composedToolSpecSchema,
  type Intent,
  intentSchema,
  mutationActionSchema,
  mutationManifestSchema,
  permissionHintSchema,
  previewActionSchema,
  previewSchema,
  smallModelHintSchema,
  type TinyYeahToolOutput,
  toolOutputSchema,
} from "./registry.js";

export {
  parseUiIr,
  serializeUiIr,
  type UiIr,
  type UiIrParseResult,
  uiIrSchema,
} from "./ui-ir.js";
