// Tiny-Yeah model-contract budgets (SPEC-TINY-YEAH-001 REQ-TY-002/027, plan.md §3.4).
//
// SINGLE definition site for every output budget (kernel->model) and the input budget
// (model->kernel). No surface redefines these literals. The numbers are sourced from the
// donor audit (Tiny-Chu `output-budget.ts:57-58` defaults 8000/40; `plugin.ts:50-52`
// install_check 40000/500) plus the REQ-TY-002 table additions (preview 4000/20, error 2000).

/** General tool response surface (REQ-TY-002 row 1; donor output-budget.ts:57-58). */
export const DEFAULT_OUTPUT_BUDGET = {
  chars: 8000,
  items: 40,
} as const;

/** install_check diagnostic surface (REQ-TY-002 row 2; donor plugin.ts:50-52 parity). */
export const INSTALL_CHECK_BUDGET = {
  chars: 40_000,
  items: 500,
} as const;

/** Approval prompt surface (REQ-TY-002 row 3; approval is terse). */
export const PREVIEW_OUTPUT_BUDGET = {
  chars: 4000,
  items: 20,
} as const;

/** Error / blocker report surface (REQ-TY-002 row 4; minimal context). */
export const ERROR_BUDGET_CHARS = 2000;

/** Model->kernel input budget (REQ-TY-027): single-action inline `content` char ceiling. */
export const MANIFEST_INPUT_BUDGET_CHARS = 4000;

export interface OutputBudget {
  readonly chars: number;
  readonly items: number;
}
