// Tiny-Yeah model-contract barrel (SPEC-TINY-YEAH-001 §6.1, plan.md §3.1).
//
// The model-contract surface: budgets, typed intents, the boundary gatekeeper, the approval
// gate, and the typed errors. This is the ONLY set of shapes the model speaks to; everything
// beyond it is a core algorithm. The head layer (src/head/) wires these into host surfaces.

export {
  type ApplyApprovedInput,
  type ApprovalSummary,
  type ApprovalSummaryAction,
  applyApproved,
  type RequestApprovalInput,
  requestApproval,
} from "./approval.js";
export {
  type ValidatedIntent,
  validateModelEmission,
} from "./boundary.js";
export {
  DEFAULT_OUTPUT_BUDGET,
  ERROR_BUDGET_CHARS,
  INSTALL_CHECK_BUDGET,
  MANIFEST_INPUT_BUDGET_CHARS,
  type OutputBudget,
  PREVIEW_OUTPUT_BUDGET,
} from "./budgets.js";
export {
  isModelContractError,
  ModelContractError,
  type ModelContractErrorCode,
} from "./errors.js";
export {
  type ApplyApprovedIntent,
  type CommitManifestIntent,
  type HealthCheckIntent,
  type Intent,
  intentSchema,
  type QueryIntent,
  type RequestApprovalIntent,
} from "./intents.js";
