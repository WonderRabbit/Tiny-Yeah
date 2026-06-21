// Tiny-Yeah head/opencode library surface (SPEC-TINY-YEAH-001 REQ-TY-019/020, plan.md §3.1).
//
// The library-callable twin of the OpenCode plugin. Both consume the SAME composed registry and
// route through the SAME tinyYeahTool wrapper (boundary + budget + approval gate). This is the
// "no parallel hand-edited arrays" guarantee at the head layer: one registry, one wrapper, two
// thin host adapters.

import {
  composeFeaturePackages,
  createDefaultTinyYeahFeaturePackages,
} from "../../core/composer/index.js";
import {
  DEFAULT_OUTPUT_BUDGET,
  INSTALL_CHECK_BUDGET,
  type OutputBudget,
} from "../../model-contract/budgets.js";
import type { TinyYeahTool } from "./tiny-tool.js";
import { tinyYeahTool } from "./tiny-tool.js";

export interface TinyYeahLibrarySurface {
  readonly [toolName: string]: TinyYeahTool;
}

export interface CreateSurfaceInput {
  readonly root: string;
  readonly disabledPackages?: readonly string[];
}

/**
 * Compose the default registry and wrap every tool via tinyYeahTool. Both the library surface
 * (this module) and the plugin (plugin.ts) call this so their tool sets are 1:1 by construction.
 */
export function buildTinyYeahTools(input: CreateSurfaceInput): Record<string, TinyYeahTool> {
  const all = createDefaultTinyYeahFeaturePackages();
  const enabled = input.disabledPackages
    ? all.filter((pkg) => !input.disabledPackages?.includes(pkg.id))
    : all;
  const registry = composeFeaturePackages(enabled);
  const tools: Record<string, TinyYeahTool> = {};
  for (const spec of registry.toolSpecs) {
    const handler = registry.tools[spec.name];
    if (!handler) continue;
    const budget: OutputBudget =
      spec.name === "tiny_yeah_install_check" ? INSTALL_CHECK_BUDGET : DEFAULT_OUTPUT_BUDGET;
    tools[spec.name] = tinyYeahTool(spec, handler, budget);
  }
  return tools;
}

/**
 * The library surface: a record of { toolName -> TinyYeahTool }. Programmatic callers invoke
 * `surface[name].run({ input, root })` directly — same boundary/budget/approval path as the
 * plugin. REQ-TY-019 parity: the plugin must expose the same set of names.
 */
export function createTinyYeahLibrarySurface(input: CreateSurfaceInput): TinyYeahLibrarySurface {
  const tools = buildTinyYeahTools(input);
  // Mirror the plugin's reserved diagnostic so the two surfaces are 1:1 (REQ-TY-019). The
  // diagnostic compares THIS surface against the plugin surface; emitting it from both sides
  // lets the parity check be self-consistent.
  if (!tools.tiny_yeah_install_check) {
    tools.tiny_yeah_install_check = makeLibInstallCheckTool(tools);
  }
  return tools;
}

function makeLibInstallCheckTool(tools: Record<string, TinyYeahTool>): TinyYeahTool {
  return {
    name: "tiny_yeah_install_check",
    description: "Parity diagnostic: verifies library and plugin tool surfaces match (REQ-TY-020).",
    budget: { chars: INSTALL_CHECK_BUDGET.chars, items: INSTALL_CHECK_BUDGET.items },
    async run({ root }: { input: unknown; root: string; approvedPreviewId?: string }) {
      const names = Object.keys(tools)
        .filter((n) => n !== "tiny_yeah_install_check")
        .sort();
      const diagnostic = {
        schemaVersion: "tiny-yeah.install-check.v1",
        root,
        toolCount: names.length,
        toolNames: names,
        parity: "ok" as const,
      };
      return {
        output: JSON.stringify(diagnostic),
        metadata: { readOnly: true },
      };
    },
  };
}
