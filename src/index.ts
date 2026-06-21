// Tiny-Yeah — Checkpointed Composer Kernel (SPEC-TINY-YEAH-001).
// Barrel exports for state (Phase 1) + checkpoint (Phase 1) + composer/schema (Phase 2) +
// evidence/pipeline (Phase 3) + model-contract/head (Phase 4).
// (see ../.moai/specs/SPEC-TINY-YEAH-001/plan.md)

// v1.0.0 (2026-06-21): SPEC-TINY-YEAH-002 capstone — the installer is now feature-complete
// (all four CLI commands install/update/doctor/uninstall working), the architecture firewall is
// fully enforced via a mechanical transitive-closure scanner (7 edges, each proven non-no-op),
// and a real-world end-to-end integration test proves a real offline-bundle install delivers a
// working OpenCode integration (three exports resolve, plugin entry merged, doctor smoke-import
// passes, update cycle + uninstall behave per SPEC).
export const VERSION = "1.0.0";

export { type ApplyPreviewInput, applyPreview } from "./core/checkpoint/apply.js";
export {
  WriteLockContentionError,
  type WriteRetryOptions,
  withWriteRetry,
  writeCreateOnlyFile,
} from "./core/checkpoint/atomic-write.js";
// core/checkpoint
export {
  CHECKPOINT_SCHEMA_VERSION,
  type Checkpoint,
  checkpointSchema,
  MUTATION_MANIFEST_SCHEMA_VERSION,
  type MutationAction,
  type MutationManifest,
  mutationActionSchema,
  mutationManifestSchema,
  PREVIEW_SCHEMA_VERSION,
  type Preview,
  type PreviewAction,
  previewActionSchema,
  previewSchema,
} from "./core/checkpoint/contracts.js";
export {
  hasErrorCode,
  isNodeErrorCode,
  isYeahError,
  YeahError,
  type YeahErrorCode,
} from "./core/checkpoint/errors.js";
export { canonicalStringify, manifestHash } from "./core/checkpoint/hashing.js";
export {
  type CreatePreviewInput,
  type CreatePreviewResult,
  createPreview,
} from "./core/checkpoint/preview.js";
export {
  type ApplyManifestInput,
  applyManifest,
  type CommitManifestInput,
  type CommitManifestResult,
  type CommitManifestSummary,
  commitManifest,
} from "./core/checkpoint/universal-write-path.js";
// core/composer (Phase 2) — single source of truth (REQ-TY-011).
export {
  composeFeaturePackages,
  createDefaultTinyYeahFeaturePackages,
  FeaturePackageError,
  type FeaturePackageErrorCode,
  type OrderedPackages,
  type TinyYeahComposedRegistry,
  type TinyYeahComposedToolSpec,
  type TinyYeahFeatureCategory,
  type TinyYeahFeaturePackage,
  type TinyYeahFeaturePackageSummary,
  type TinyYeahInstructionDescriptor,
  type TinyYeahJsonSchema,
  type TinyYeahOutputMode,
  type TinyYeahPermissionHint,
  type TinyYeahPromptDescriptor,
  type TinyYeahResourceDescriptor,
  type TinyYeahSmallModelHint,
  type TinyYeahToolContext,
  type TinyYeahToolDescriptor,
  type TinyYeahToolHandler,
  validateAndOrderFeaturePackages,
} from "./core/composer/index.js";
export {
  confirmMatchedFacts,
  createRuntimeEvidence,
  type FactKind,
  type RuntimeEvidence,
  type RuntimeFact,
  type RuntimeStatus,
} from "./core/evidence/runtime-matcher.js";
// core/evidence (Phase 3) — sanitizer / source-graph / runtime-matcher.
export {
  createStaticEvidenceSummary,
  type StaticEvidenceSummary,
  type StaticEvidenceSummaryInput,
  sanitizeEvidenceValue,
} from "./core/evidence/sanitizer.js";
export {
  buildSourceGraph,
  type SourceGraphBuildResult,
  type SourceGraphFailure,
  type SourceGraphOptions,
  type SourceGraphResult,
  type SourceGraphSuccess,
} from "./core/evidence/source-graph.js";
// core/pipeline (Phase 3) — analyze / plan / draft / render-wireframe / validate.
export {
  analyzeProject,
  type Diagnostic,
  type Inventory,
  inventorySchema,
} from "./core/pipeline/analyze.js";
export { draftUiDefinition } from "./core/pipeline/draft.js";
export { type PlanIntent, planMutation } from "./core/pipeline/plan.js";
export {
  type DesignTokens,
  NEUTRAL_DESIGN_TOKENS,
  renderWireframe,
} from "./core/pipeline/render-wireframe.js";
export {
  createDriver,
  NoopDriver,
  PlaywrightDriver,
  type RunValidationOptions,
  type RunValidationResult,
  registerDriver,
  registeredDriverNames,
  resetDriverRegistry,
  runValidation,
  type ValidationDriver,
  type ValidationDriverErrorCode,
  ValidationDriverUnavailableError,
} from "./core/pipeline/validate/index.js";
// core/schema (Phase 2) — single schema entry point.
// NOTE: `Intent` / `intentSchema` / `CommitManifestIntent` are exported below from
// model-contract (Phase 4 canonical model-facing shapes) — the core/schema base versions
// remain available via `./core/schema/index.js` for internal callers.
export {
  type ComposedToolSpec,
  composedToolSpecSchema,
  parseUiIr,
  serializeUiIr,
  type TinyYeahToolOutput,
  toolOutputSchema,
  type UiIr,
  uiIrSchema,
} from "./core/schema/index.js";
export {
  appendJsonLine,
  ensureDir,
  MalformedJsonError,
  readJsonFile,
  readJsonLines,
  readStateJson,
  removeIfExists,
  StateSchemaVersionError,
  writeJsonAtomic,
  writeStateJson,
  writeTextAtomic,
} from "./core/state/file-store.js";
export {
  acquireTinyYeahLock,
  TINY_YEAH_LOCK_POLL_MS,
  TINY_YEAH_LOCK_RENEW_MS,
  TINY_YEAH_LOCK_STALE_MS,
  TINY_YEAH_LOCK_TIMEOUT_MS,
  type TinyYeahLock,
  TinyYeahLockCompromisedError,
  type TinyYeahLockOptions,
  TinyYeahLockTimeoutError,
  withTinyYeahLock,
} from "./core/state/lock-store.js";
export {
  isLexicallyInsideRoot,
  isPathInsideRoot,
  resolveExistingPathInsideRoot,
  resolvePathInsideRoot,
} from "./core/state/path-safety.js";
// core/state
export {
  resolveTinyYeahPaths,
  type TinyYeahPaths,
} from "./core/state/paths.js";
// head/installer (Phase 1, SPEC-TINY-YEAH-002) — install-time writer domain. Reuses core/ atomic
// primitives but does NOT route through model-contract preview/apply (two-domain firewall,
// REQ-TY2-003). Exposed so library consumers + the Phase-2 lifecycle can import the surface.
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
} from "./head/installer/bundle-reader.js";
export {
  hasInstallerErrorCode,
  InstallerError,
  type InstallerErrorCode,
  isInstallerError,
} from "./head/installer/errors.js";
export {
  type InstallOptions,
  type InstallResult,
  install,
} from "./head/installer/lifecycle.js";
export {
  type AcquireInstallerLockOptions,
  acquireInstallerLock,
  INSTALLER_LOCK_DIR_NAME,
  INSTALLER_LOCK_STALE_MS,
  type InstallerLockHandle,
} from "./head/installer/lock.js";
// head/installer Phase 2 — JSONC-preserving merge (jsonc-parser confined here), install stamp,
// install lifecycle. Firewall (tests/unit/installer-firewall) keeps jsonc-parser OUT of the bin.
export {
  addPluginEntry,
  assertParsable,
  createInitialConfig,
  type LocatedOpenCodeConfig,
  locateOpenCodeConfig,
  type OpenCodeConfigFormat,
  type PluginEntryValue,
  readPluginEntry,
} from "./head/installer/opencode-config.js";
export {
  type ComputeInstallPlanInput,
  computeInstallPlan,
  formatDryRun,
  formatDryRunJson,
  type InstallPlan,
  type InstallPlanEntry,
  type InstallPlanKind,
} from "./head/installer/plan.js";
export {
  computeManagedFileHashes,
  INSTALL_STAMP_REL_PATH,
  INSTALL_STAMP_SCHEMA_VERSION,
  type InstallStamp,
  installStampSchema,
  readStamp,
  stampPathFor,
  writeStamp,
} from "./head/installer/stamp.js";
export {
  atomicCopyFile,
  atomicOverwriteFile,
  atomicWriteJson,
  backupAndWrite,
} from "./head/installer/writer.js";
// head/library (Phase 5) — canonical host-agnostic library home + compaction primitives.
// buildTinyYeahTools / createTinyYeahLibrarySurface remain re-exported from head/opencode below
// for backward compatibility; src/head/library/ is the canonical import path.
export {
  buildTaskFocusPacket,
  MAX_ACTION_PATH_SUMMARY_ENTRIES,
  TASK_FOCUS_PACKET_SCHEMA_VERSION,
  type TaskFocusPacket,
  type TaskFocusState,
} from "./head/library/focus-packet.js";
export {
  buildResumePacket,
  RESUME_PACKET_BUDGET_CHARS,
  RESUME_PACKET_SCHEMA_VERSION,
  type ResumePacket,
} from "./head/library/resume.js";
// head/opencode (Phase 4) — host-agnostic library surface (the OpenCode Plugin itself is the
// `./opencode` export path; it imports @opencode-ai/plugin and stays out of core/).
export {
  buildTinyYeahTools,
  type CreateSurfaceInput,
  createTinyYeahLibrarySurface,
  type TinyYeahLibrarySurface,
} from "./head/opencode/library-surface.js";
// model-contract (Phase 4) — the ONLY surface the model speaks to.
export {
  type ApplyApprovedInput,
  type ApprovalSummary,
  type ApprovalSummaryAction,
  applyApproved,
  type RequestApprovalInput,
  requestApproval,
} from "./model-contract/approval.js";
export {
  type ValidatedIntent,
  validateModelEmission,
} from "./model-contract/boundary.js";
export {
  DEFAULT_OUTPUT_BUDGET,
  ERROR_BUDGET_CHARS,
  INSTALL_CHECK_BUDGET,
  MANIFEST_INPUT_BUDGET_CHARS,
  type OutputBudget,
  PREVIEW_OUTPUT_BUDGET,
} from "./model-contract/budgets.js";
export {
  isModelContractError,
  ModelContractError,
  type ModelContractErrorCode,
} from "./model-contract/errors.js";
export {
  type ApplyApprovedIntent,
  type CommitManifestIntent,
  type HealthCheckIntent,
  type Intent,
  intentSchema,
  type QueryIntent,
  type RequestApprovalIntent,
} from "./model-contract/intents.js";
