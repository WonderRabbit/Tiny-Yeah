// Tiny-Yeah pipeline barrel — unified analyze + plan + draft + render-wireframe + validate
// stages (SPEC-TINY-YEAH-001 plan.md §4 Phase 3). REQ-TY-017/018: analyze is the SINGLE builtin
// engine (no external graph tool, no external binary). REQ-TY-015/016: validate exposes the
// pluggable ValidationDriver interface with NoopDriver graceful degradation and a lazy Playwright
// implementation behind a capability flag.

export { analyzeProject, type Diagnostic, type Inventory, inventorySchema } from "./analyze.js";
export { draftUiDefinition } from "./draft.js";
export { type PlanIntent, planMutation } from "./plan.js";
export {
  type DesignTokens,
  NEUTRAL_DESIGN_TOKENS,
  renderWireframe,
} from "./render-wireframe.js";
export {
  createDriver,
  NoopDriver,
  PlaywrightDriver,
  type RuntimeSnapshot,
  type RunValidationOptions,
  type RunValidationResult,
  registerDriver,
  registeredDriverNames,
  resetDriverRegistry,
  runValidation,
  type ValidationDriver,
  type ValidationDriverErrorCode,
  ValidationDriverUnavailableError,
} from "./validate/index.js";
