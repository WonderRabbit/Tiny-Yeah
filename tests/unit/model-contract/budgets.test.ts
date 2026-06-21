// UNIT: model-contract/budgets (SPEC-TINY-YEAH-001 REQ-TY-002/027, plan.md §3.4).
// Output budgets (kernel->model) + input budget (model->kernel) single-defined here.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_OUTPUT_BUDGET,
  ERROR_BUDGET_CHARS,
  INSTALL_CHECK_BUDGET,
  MANIFEST_INPUT_BUDGET_CHARS,
  PREVIEW_OUTPUT_BUDGET,
} from "../../../src/model-contract/budgets.js";

describe("model-contract budget constants (REQ-TY-002 / REQ-TY-027)", () => {
  it("DEFAULT_OUTPUT_BUDGET = 8000 chars / 40 items (donor output-budget.ts:57-58)", () => {
    expect(DEFAULT_OUTPUT_BUDGET.chars).toBe(8000);
    expect(DEFAULT_OUTPUT_BUDGET.items).toBe(40);
  });

  it("INSTALL_CHECK_BUDGET = 40000 chars / 500 items (donor plugin.ts:50-52 parity)", () => {
    expect(INSTALL_CHECK_BUDGET.chars).toBe(40_000);
    expect(INSTALL_CHECK_BUDGET.items).toBe(500);
  });

  it("PREVIEW_OUTPUT_BUDGET = 4000 chars / 20 items (REQ-TY-002 approval prompt)", () => {
    expect(PREVIEW_OUTPUT_BUDGET.chars).toBe(4000);
    expect(PREVIEW_OUTPUT_BUDGET.items).toBe(20);
  });

  it("ERROR_BUDGET_CHARS = 2000 (REQ-TY-002 error/blocker surface)", () => {
    expect(ERROR_BUDGET_CHARS).toBe(2000);
  });

  it("MANIFEST_INPUT_BUDGET_CHARS = 4000 (REQ-TY-027 model->kernel input budget)", () => {
    expect(MANIFEST_INPUT_BUDGET_CHARS).toBe(4000);
  });
});
