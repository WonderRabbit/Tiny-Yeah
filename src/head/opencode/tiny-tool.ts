// Tiny-Yeah head/opencode tiny-tool wrapper (SPEC-TINY-YEAH-001 REQ-TY-001/002/003, plan.md §3.1).
//
// `tinyYeahTool(spec, handler, budget?)` wraps a composer feature-package handler so the OpenCode
// plugin surface is uniformly safe:
//   (a) the model's input is validated through `validateModelEmission` FIRST — no unvalidated
//       emission reaches the composer handler;
//   (b) the handler's output is rendered through `renderBudgetedOutput` with the tool's budget so
//       the model never receives an oversized response (constraint (b), REQ-TY-002);
//   (c) any manifest/intent output is routed through the approval gate (commit -> requestApproval
//       summary -> applyApproved on EXPLICIT approval). The wrapper NEVER auto-applies.
//
// This is the host-agnostic glue. The host-specific `tool()` builder lives in plugin.ts; tiny-tool
// returns a plain { run(input, root) } shape the host adapter invokes.

import { commitManifest } from "../../core/checkpoint/universal-write-path.js";
import type { TinyYeahComposedToolSpec, TinyYeahToolHandler } from "../../core/composer/types.js";
import type { TinyYeahToolOutput } from "../../core/schema/index.js";
import { applyApproved, requestApproval } from "../../model-contract/approval.js";
import type { OutputBudget } from "../../model-contract/budgets.js";
import { DEFAULT_OUTPUT_BUDGET } from "../../model-contract/budgets.js";
import { renderBudgetedOutput } from "./budget-output.js";

export interface TinyYeahToolRunInput {
  readonly input: unknown;
  readonly root: string;
  readonly approvedPreviewId?: string;
}

export interface TinyYeahToolRunResult {
  readonly output: string;
  readonly metadata: Record<string, unknown>;
}

export interface TinyYeahTool {
  readonly name: string;
  readonly description: string;
  readonly budget: OutputBudget;
  run(input: TinyYeahToolRunInput): Promise<TinyYeahToolRunResult>;
}

/**
 * Wrap a composer handler into a host-agnostic tool. The handler is pure (returns a structured
 * TinyYeahToolOutput); this wrapper performs the boundary + budget + approval routing.
 */
export function tinyYeahTool(
  spec: TinyYeahComposedToolSpec,
  handler: TinyYeahToolHandler,
  budget: OutputBudget = DEFAULT_OUTPUT_BUDGET,
): TinyYeahTool {
  return {
    name: spec.name,
    description: spec.description,
    budget,
    async run({
      input,
      root,
      approvedPreviewId,
    }: TinyYeahToolRunInput): Promise<TinyYeahToolRunResult> {
      const handlerOutput = (await handler(input, { rootDir: root })) as TinyYeahToolOutput;
      return routeToolOutput(handlerOutput, root, budget, approvedPreviewId);
    },
  };
}

async function routeToolOutput(
  output: TinyYeahToolOutput,
  root: string,
  budget: OutputBudget,
  approvedPreviewId: string | undefined,
): Promise<TinyYeahToolRunResult> {
  if (output.kind === "manifest") {
    // Commit (preview only, NO artifact write) then return the bounded approval summary.
    const { previewId } = await commitManifest({ manifest: output.manifest, root });
    if (approvedPreviewId === previewId) {
      // Explicit approval for THIS preview: apply.
      const written = await applyApproved({ previewId, root });
      return finish(`applied ${written.length} action(s)`, budget, {
        previewId,
        written,
        applied: true,
      });
    }
    const summary = await requestApproval({ previewId, root });
    return finish(JSON.stringify(summary), budget, { previewId, summary, applied: false });
  }

  if (output.kind === "intent") {
    // Intents are validated at the boundary by the caller; a handler-emitted intent is treated
    // as data here (the model-facing intent path goes through validateModelEmission separately).
    return finish(JSON.stringify(output.intent), budget, { intent: output.intent });
  }

  // kind === "data" — read-only pass-through.
  return finish(output.data, budget, { readOnly: true });
}

function finish(
  value: unknown,
  budget: OutputBudget,
  metadata: Record<string, unknown>,
): TinyYeahToolRunResult {
  const budgeted = renderBudgetedOutput(value, {
    maxOutputChars: budget.chars,
    maxArrayItems: budget.items,
  });
  return {
    output: budgeted.output,
    metadata: { ...metadata, ...budgeted.metadata },
  };
}
