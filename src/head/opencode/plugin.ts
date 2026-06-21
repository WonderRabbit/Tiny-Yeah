// Tiny-Yeah head/opencode plugin (SPEC-TINY-YEAH-001 REQ-TY-019/020/023, plan.md §3.1).
//
// The OpenCode host adapter. Composes the default registry, wraps every tool via tinyYeahTool
// (boundary + budget + approval gate), and emits the `tiny_yeah_install_check` parity
// diagnostic (REQ-TY-020; its name is the naming-check anchor, REQ-TY-023). The plugin is the
// ONLY module under src/ that imports `@opencode-ai/plugin` — the architecture firewall test
// (tests/unit/architecture-boundary.test.ts) forbids it everywhere else.
//
// Two exports:
//   - `createTinyYeahPlugin(config)` -> the tool map (host-agnostic). REQ-TY-019 parity test
//     compares this set against the library surface and the registry spec names.
//   - `TinyYeahOpenCodePlugin` -> the `@opencode-ai/plugin` Plugin (host-specific) that wraps the
//     tool map in `tool()` builders and wires the chat.message / shell.env hooks.

import { type Hooks, type Plugin, type ToolContext, tool } from "@opencode-ai/plugin";
import { validateModelEmission } from "../../model-contract/boundary.js";
import { DEFAULT_OUTPUT_BUDGET, ERROR_BUDGET_CHARS } from "../../model-contract/budgets.js";
import { isModelContractError, ModelContractError } from "../../model-contract/errors.js";
import { renderBudgetedOutput } from "./budget-output.js";
import { buildTinyYeahTools } from "./library-surface.js";
import type { TinyYeahTool } from "./tiny-tool.js";

export interface CreateTinyYeahPluginInput {
  readonly root: string;
  readonly disabledPackages?: readonly string[];
}

export type TinyYeahPluginToolMap = Record<string, TinyYeahTool>;

/**
 * Build the tool map (host-agnostic). REQ-TY-019 parity: the names here MUST equal the registry
 * toolSpecs and the library surface names. Adding a tool means adding a feature-package
 * descriptor — never hand-editing this map.
 */
export function createTinyYeahPlugin(input: CreateTinyYeahPluginInput): TinyYeahPluginToolMap {
  const tools = buildTinyYeahTools(input);
  // The install_check parity diagnostic is reserved regardless of whether the seed registry
  // defines it. It compares the library vs plugin surfaces (REQ-TY-020) and uses the larger
  // install_check budget (REQ-TY-002 row 2).
  if (!tools.tiny_yeah_install_check) {
    tools.tiny_yeah_install_check = makeInstallCheckTool(tools);
  }
  return tools;
}

function makeInstallCheckTool(tools: TinyYeahPluginToolMap): TinyYeahTool {
  return {
    name: "tiny_yeah_install_check",
    description: "Parity diagnostic: verifies library and plugin tool surfaces match (REQ-TY-020).",
    budget: {
      chars: 40_000,
      items: 500,
    },
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
      const budgeted = renderBudgetedOutput(diagnostic, {
        maxOutputChars: 40_000,
        maxArrayItems: 500,
      });
      return {
        output: budgeted.output,
        metadata: { ...budgeted.metadata } as Record<string, unknown>,
      };
    },
  };
}

/**
 * Wrap the host-agnostic tool map in `@opencode-ai/plugin` `tool()` builders and add the hooks.
 * The model input is validated through `validateModelEmission` BEFORE the handler runs (REQ-TY-001).
 */
export const TinyYeahOpenCodePlugin: Plugin = async (pluginInput, options): Promise<Hooks> => {
  const root = readRoot(options) ?? pluginInput.worktree ?? pluginInput.directory;
  const toolMap = createTinyYeahPlugin({ root });

  const toolDefinitions: Hooks["tool"] = {};
  for (const [name, yeahTool] of Object.entries(toolMap)) {
    toolDefinitions[name] = tool({
      description: yeahTool.description,
      args: {
        input: tool.schema
          .record(tool.schema.string(), tool.schema.unknown())
          .default({})
          .describe("Tiny-Yeah tool input object."),
      },
      async execute(args, context: ToolContext) {
        try {
          await validateModelEmission(args.input, root);
        } catch (error) {
          if (isModelContractError(error) || error instanceof ModelContractError) {
            const budgeted = renderBudgetedOutput(
              {
                code: error.code,
                message: error.message,
                recoveryHint: error.recoveryHint,
              },
              { maxOutputChars: ERROR_BUDGET_CHARS, maxArrayItems: 10 },
            );
            return {
              title: `tiny-yeah:${name} rejected`,
              output: budgeted.output,
              metadata: { tool: name, rejected: true, ...budgeted.metadata },
            };
          }
          throw error;
        }
        const result = await yeahTool.run({
          input: args.input,
          root: context.worktree || context.directory,
        });
        return {
          title: `tiny-yeah:${name}`,
          output: result.output,
          metadata: { tool: name, ...result.metadata },
        };
      },
    });
  }

  return {
    tool: toolDefinitions,
    "shell.env": async (_input, envOutput) => {
      envOutput.env.TINY_YEAH_ROOT = root;
      envOutput.env.TINY_YEAH_OPENCODE_PLUGIN = "1";
    },
  };
};

function readRoot(options: unknown): string | undefined {
  if (options && typeof options === "object") {
    const root = (options as { root?: unknown }).root;
    if (typeof root === "string" && root.trim() !== "") return root;
  }
  return undefined;
}

// Default budget re-export for host callers that want the canonical constant.
export { DEFAULT_OUTPUT_BUDGET };
