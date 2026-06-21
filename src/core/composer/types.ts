// Tiny-Yeah feature-package composer types (SPEC-TINY-YEAH-001 REQ-TY-011, plan.md §4).
// Generalized from Tiny-Chu `feature-package-types.ts` (TinyChu* -> TinyYeah* rename),
// host-agnostic: NO `@opencode-ai/plugin` import. Tool handlers return structured
// outputs (manifests / intents / data) defined in `../schema/` — they never touch the
// filesystem. The composer itself imports types only from `../schema/`, never from
// `../checkpoint` (architecture firewall, plan.md §3.1).

import type { TinyYeahToolOutput } from "../schema/index.js";

// Minimal, host-agnostic category set. Legacy/ux categories are intentionally excluded
// (donor D4 excludes legacy domain tools); new domains are added by extending this union.
export type TinyYeahFeatureCategory =
  | "core-runtime"
  | "support"
  | "workflow-orchestration"
  | "safe-tooling"
  | "ui-pipeline";

export type TinyYeahOutputMode = "json" | "markdown" | "compact" | "mixed";

export interface TinyYeahJsonSchema {
  readonly type?: string;
  readonly properties?: Readonly<Record<string, TinyYeahJsonSchema>>;
  readonly items?: TinyYeahJsonSchema;
  readonly required?: readonly string[];
  readonly enum?: readonly string[];
  readonly description?: string;
  readonly default?: unknown;
}

export interface TinyYeahPermissionHint {
  readonly readOnly: boolean;
  readonly writesState?: boolean;
  readonly writesArtifacts?: boolean;
  readonly writesSource?: boolean;
  readonly network?: "none" | "optional" | "required";
}

export interface TinyYeahSmallModelHint {
  readonly outputMode: TinyYeahOutputMode;
  readonly deterministic: boolean;
  readonly maxInputChars?: number;
  readonly notes?: readonly string[];
}

/** Host-agnostic context handed to every tool handler. */
export interface TinyYeahToolContext {
  /** Project root, resolved through `resolveTinyYeahPaths` (Phase 1). */
  readonly rootDir: string;
}

/**
 * A feature-package tool handler returns a structured TinyYeahToolOutput
 * (manifest / intent / data). It MUST NOT touch the filesystem directly —
 * the head layer routes manifest/intent outputs through the universal-write-path
 * (preview -> checkpoint -> apply). This keeps the composer a pure, deterministic
 * algorithm (plan.md §3.1 constraint e).
 */
export type TinyYeahToolHandler<Input = unknown> = (
  input: Input,
  context: TinyYeahToolContext,
) => TinyYeahToolOutput | Promise<TinyYeahToolOutput>;

export interface TinyYeahToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly handler: TinyYeahToolHandler;
  readonly inputSchema?: TinyYeahJsonSchema;
  readonly permission?: TinyYeahPermissionHint;
  readonly smallModel?: TinyYeahSmallModelHint;
  readonly requiredNativeTools?: readonly string[];
}

export interface TinyYeahResourceDescriptor {
  readonly name: string;
  readonly description: string;
  readonly path?: string;
}

export interface TinyYeahPromptDescriptor {
  readonly name: string;
  readonly description: string;
  readonly template: string;
}

export interface TinyYeahInstructionDescriptor {
  readonly name: string;
  readonly description: string;
  readonly path?: string;
  readonly text?: string;
}

export interface TinyYeahFeaturePackage {
  readonly id: string;
  readonly version: 1;
  readonly title: string;
  readonly category: TinyYeahFeatureCategory;
  readonly dependsOn?: readonly string[];
  readonly tools?: readonly TinyYeahToolDescriptor[];
  readonly resources?: readonly TinyYeahResourceDescriptor[];
  readonly prompts?: readonly TinyYeahPromptDescriptor[];
  readonly instructions?: readonly TinyYeahInstructionDescriptor[];
}

export interface TinyYeahComposedToolSpec {
  readonly name: string;
  readonly description: string;
  readonly packageId: string;
  readonly packageTitle: string;
  readonly permission?: TinyYeahPermissionHint;
  readonly smallModel?: TinyYeahSmallModelHint;
  readonly inputSchema?: TinyYeahJsonSchema;
  readonly requiredNativeTools: readonly string[];
}

export interface TinyYeahFeaturePackageSummary {
  readonly id: string;
  readonly title: string;
  readonly category: TinyYeahFeatureCategory;
  readonly dependsOn: readonly string[];
  readonly toolNames: readonly string[];
  readonly resourceNames: readonly string[];
  readonly promptNames: readonly string[];
  readonly instructionNames: readonly string[];
}

export interface TinyYeahComposedRegistry {
  readonly packageIds: readonly string[];
  readonly packages: readonly TinyYeahFeaturePackageSummary[];
  readonly tools: Readonly<Record<string, TinyYeahToolHandler>>;
  readonly toolSpecs: readonly TinyYeahComposedToolSpec[];
  readonly resources: readonly TinyYeahResourceDescriptor[];
  readonly prompts: readonly TinyYeahPromptDescriptor[];
  readonly instructions: readonly TinyYeahInstructionDescriptor[];
  readonly requiredToolNames: readonly string[];
}
