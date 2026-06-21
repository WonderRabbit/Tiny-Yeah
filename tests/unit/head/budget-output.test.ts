// UNIT: head/opencode/budget-output (SPEC-TINY-YEAH-001 REQ-TY-002, plan.md §3.7 T7).
// renderBudgetedOutput: deterministic truncation. Output NEVER exceeds the budget (chars/items).

import { describe, expect, it } from "vitest";
import { renderBudgetedOutput } from "../../../src/head/opencode/budget-output.js";
import {
  DEFAULT_OUTPUT_BUDGET,
  INSTALL_CHECK_BUDGET,
} from "../../../src/model-contract/budgets.js";

describe("renderBudgetedOutput — REQ-TY-002 deterministic truncation", () => {
  it("T7: oversized array output is truncated and NEVER exceeds item budget", () => {
    const huge = Array.from({ length: 1000 }, (_, i) => ({ id: i, label: `item-${i}` }));
    const { output, metadata } = renderBudgetedOutput(huge, {
      maxOutputChars: DEFAULT_OUTPUT_BUDGET.chars,
      maxArrayItems: DEFAULT_OUTPUT_BUDGET.items,
    });
    // Output character length is at or under the budget.
    expect(output.length).toBeLessThanOrEqual(DEFAULT_OUTPUT_BUDGET.chars);
    // Truncation reported in metadata.
    expect(metadata.truncated).toBe(true);
    expect(metadata.budget.omittedItems).toBeGreaterThan(0);
    // The per-array omission marker is present in the compacted output.
    expect(output).toContain("__yeahOmittedItems");
  });

  it("T7: oversized string output is truncated to the char budget with a marker", () => {
    const huge = "x".repeat(50_000);
    const { output, metadata } = renderBudgetedOutput(huge, {
      maxOutputChars: 1000,
      maxArrayItems: DEFAULT_OUTPUT_BUDGET.items,
    });
    expect(output.length).toBeLessThanOrEqual(1000);
    expect(metadata.truncated).toBe(true);
    expect(output).toContain("truncated");
  });

  it("default budget is 8000/40 when input omits the budget keys (donor parity)", () => {
    const huge = Array.from({ length: 100 }, (_, i) => i);
    const { metadata } = renderBudgetedOutput(huge, {} as Record<string, unknown>);
    expect(metadata.budget.maxOutputChars).toBe(8000);
    expect(metadata.budget.maxArrayItems).toBe(40);
  });

  it("install_check budget = 40000/500 (donor plugin.ts:50-52 parity)", () => {
    const huge = Array.from({ length: 1000 }, (_, i) => i);
    const { metadata } = renderBudgetedOutput(huge, {
      maxOutputChars: INSTALL_CHECK_BUDGET.chars,
      maxArrayItems: INSTALL_CHECK_BUDGET.items,
    });
    expect(metadata.budget.maxOutputChars).toBe(40_000);
    expect(metadata.budget.maxArrayItems).toBe(500);
  });

  it("non-truncated output reports truncated=false and carries exact sizes", () => {
    const small = { ok: true };
    const { output, metadata } = renderBudgetedOutput(small, {
      maxOutputChars: DEFAULT_OUTPUT_BUDGET.chars,
      maxArrayItems: DEFAULT_OUTPUT_BUDGET.items,
    });
    expect(metadata.truncated).toBe(false);
    expect(metadata.budget.omittedItems).toBe(0);
    expect(metadata.budget.outputSizeChars).toBe(output.length);
  });

  it("string input is passed through (not JSON-stringified) when small", () => {
    const { output } = renderBudgetedOutput("hello", {
      maxOutputChars: DEFAULT_OUTPUT_BUDGET.chars,
      maxArrayItems: DEFAULT_OUTPUT_BUDGET.items,
    });
    expect(output).toBe("hello");
  });
});
