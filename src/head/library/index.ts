// Tiny-Yeah head/library barrel (SPEC-TINY-YEAH-001 REQ-TY-019/020/025/026, plan.md Phase 5).
//
// The CANONICAL home for the host-agnostic programmatic surface: every tool callable as a
// function WITHOUT a host runtime, plus the compaction-discipline primitives (focus-packet,
// resume). The OpenCode plugin (src/head/opencode/plugin.ts) re-uses the SAME composed registry
// via buildTinyYeahTools — one registry, one wrapper, two thin host adapters (REQ-TY-019 parity).
//
// This barrel re-exports the library-surface API that already lives in src/head/opencode/ (Phase
// 4); `src/head/library/` is the canonical import path for library consumers while keeping the
// host-agnostic wrapper implementation in one place (no parallel hand-edited arrays, REQ-TY-012).

export {
  type BudgetedOutput,
  type OutputBudgetMetadata,
  renderBudgetedOutput,
} from "../opencode/budget-output.js";
export {
  buildTinyYeahTools,
  type CreateSurfaceInput,
  createTinyYeahLibrarySurface,
  type TinyYeahLibrarySurface,
} from "../opencode/library-surface.js";
export {
  type TinyYeahTool,
  type TinyYeahToolRunInput,
  type TinyYeahToolRunResult,
  tinyYeahTool,
} from "../opencode/tiny-tool.js";
export {
  buildTaskFocusPacket,
  MAX_ACTION_PATH_SUMMARY_ENTRIES,
  TASK_FOCUS_PACKET_SCHEMA_VERSION,
  type TaskFocusPacket,
  type TaskFocusState,
} from "./focus-packet.js";
export {
  buildResumePacket,
  RESUME_PACKET_BUDGET_CHARS,
  RESUME_PACKET_SCHEMA_VERSION,
  type ResumePacket,
} from "./resume.js";
