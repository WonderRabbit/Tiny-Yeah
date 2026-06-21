// Tiny-Yeah feature-package composer (SPEC-TINY-YEAH-001 REQ-TY-011, plan.md §3.1/§4).
// Single source of truth: turns a flat list of TinyYeahFeaturePackage descriptors into
// one TinyYeahComposedRegistry consumed by three independent surfaces (library API,
// OpenCode head [Phase 4], install-check diagnostics [Phase 5]).
//
// !!! ARCHITECTURE FIREWALL (plan.md §3.1 / tests/unit/architecture-boundary.test.ts) !!!
// This module MUST NOT import from `../checkpoint` or `../state`. Feature-package
// handlers return structured outputs (manifests / intents / data) defined in
// `../schema/`; they NEVER touch the filesystem. The head layer routes manifest/intent
// outputs through `core/checkpoint/universal-write-path.ts`. This keeps the composer a
// pure, deterministic algorithm and makes REQ-TY-004 (universal-write-path is the sole
// write entrypoint) enforceable — if the composer never imports checkpoint, there is no
// bypass path. Adding a `from "../checkpoint"` import here fails the architecture test.

import { FeaturePackageError } from "./errors.js";
import { validateAndOrderFeaturePackages } from "./order.js";
import type {
  TinyYeahComposedRegistry,
  TinyYeahComposedToolSpec,
  TinyYeahFeaturePackage,
  TinyYeahFeaturePackageSummary,
  TinyYeahInstructionDescriptor,
  TinyYeahPromptDescriptor,
  TinyYeahResourceDescriptor,
  TinyYeahToolHandler,
} from "./types.js";

export function composeFeaturePackages(
  featurePackages: readonly TinyYeahFeaturePackage[],
): TinyYeahComposedRegistry {
  const { orderedIds, byId } = validateAndOrderFeaturePackages(featurePackages);
  return composeOrderedRegistry(orderedIds, byId);
}

function composeOrderedRegistry(
  orderedIds: readonly string[],
  byId: ReadonlyMap<string, TinyYeahFeaturePackage>,
): TinyYeahComposedRegistry {
  const tools: Record<string, TinyYeahToolHandler> = {};
  const toolSpecs: TinyYeahComposedToolSpec[] = [];
  const resources: TinyYeahResourceDescriptor[] = [];
  const prompts: TinyYeahPromptDescriptor[] = [];
  const instructions: TinyYeahInstructionDescriptor[] = [];
  const packages: TinyYeahFeaturePackageSummary[] = [];

  for (const id of orderedIds) {
    const featurePackage = byId.get(id);
    if (!featurePackage) continue;
    const toolNames: string[] = [];
    for (const tool of featurePackage.tools ?? []) {
      if (tools[tool.name]) {
        throw new FeaturePackageError("duplicate_tool_name", `Duplicate tool name: ${tool.name}`, {
          packageId: featurePackage.id,
          toolName: tool.name,
        });
      }
      tools[tool.name] = tool.handler;
      toolNames.push(tool.name);
      const spec: TinyYeahComposedToolSpec = {
        name: tool.name,
        description: tool.description,
        packageId: featurePackage.id,
        packageTitle: featurePackage.title,
        requiredNativeTools: tool.requiredNativeTools ?? [],
        ...(tool.permission ? { permission: tool.permission } : {}),
        ...(tool.smallModel ? { smallModel: tool.smallModel } : {}),
        ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
      };
      toolSpecs.push(spec);
    }
    resources.push(...(featurePackage.resources ?? []));
    prompts.push(...(featurePackage.prompts ?? []));
    instructions.push(...(featurePackage.instructions ?? []));
    packages.push({
      id: featurePackage.id,
      title: featurePackage.title,
      category: featurePackage.category,
      dependsOn: featurePackage.dependsOn ?? [],
      toolNames,
      resourceNames: (featurePackage.resources ?? []).map((resource) => resource.name),
      promptNames: (featurePackage.prompts ?? []).map((prompt) => prompt.name),
      instructionNames: (featurePackage.instructions ?? []).map((instruction) => instruction.name),
    });
  }

  return {
    packageIds: orderedIds,
    packages,
    tools,
    toolSpecs,
    resources,
    prompts,
    instructions,
    requiredToolNames: toolSpecs.map((spec) => spec.name),
  };
}
