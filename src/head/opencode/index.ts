// Tiny-Yeah head/opencode barrel (SPEC-TINY-YEAH-001 REQ-TY-019/020, plan.md §3.1).
//
// The OpenCode host surface. This is the ONLY place `@opencode-ai/plugin` may be imported
// (architecture firewall, tests/unit/architecture-boundary.test.ts). The library surface and
// the plugin both consume the single composed registry via buildTinyYeahTools.

export {
  type BudgetedOutput,
  type OutputBudgetMetadata,
  renderBudgetedOutput,
} from "./budget-output.js";
export {
  buildTinyYeahTools,
  type CreateSurfaceInput,
  createTinyYeahLibrarySurface,
  type TinyYeahLibrarySurface,
} from "./library-surface.js";
export {
  type CreateTinyYeahPluginInput,
  createTinyYeahPlugin,
  TinyYeahOpenCodePlugin,
  type TinyYeahPluginToolMap,
} from "./plugin.js";
export {
  type TinyYeahTool,
  type TinyYeahToolRunInput,
  type TinyYeahToolRunResult,
  tinyYeahTool,
} from "./tiny-tool.js";
