// Tiny-Yeah merged zod registry — the SINGLE schema entry point (SPEC-TINY-YEAH-001
// plan.md §4 Phase 2, REQ-TY-011). Re-exports the checkpoint contracts so consumers
// have one place to import schemas from, and adds the host-agnostic Intent family plus
// the composed-tool spec schema.
//
// Layering: schema sits ABOVE checkpoint (it re-exports checkpoint types). The composer
// layer imports types from this module rather than reaching into `../checkpoint` directly
// (architecture firewall, plan.md §3.1 / tests/unit/architecture-boundary.test.ts).

import { z } from "zod";
import { mutationManifestSchema } from "../checkpoint/contracts.js";

export {
  CHECKPOINT_SCHEMA_VERSION,
  type Checkpoint,
  checkpointSchema,
  MUTATION_MANIFEST_SCHEMA_VERSION,
  type MutationAction,
  type MutationManifest,
  mutationActionSchema,
  mutationManifestSchema,
  PREVIEW_SCHEMA_VERSION,
  type Preview,
  type PreviewAction,
  previewActionSchema,
  previewSchema,
} from "../checkpoint/contracts.js";

// ---- Intent family (model-emitted intents; base discriminated union) -------------
//
// The model emits intents; the head layer (Phase 4) routes intents through the
// universal-write-path. Phase 2 pins the base shape: `commitManifest` carries a
// MutationManifest for the preview -> checkpoint -> apply flow. More intent variants
// (e.g. read/search intents) are added in Phase 4 without breaking this union.

export const commitManifestIntentSchema = z
  .object({
    type: z.literal("commitManifest"),
    manifest: mutationManifestSchema,
  })
  .strict();

export const intentSchema = z.discriminatedUnion("type", [commitManifestIntentSchema]);

export type Intent = z.infer<typeof intentSchema>;
export type CommitManifestIntent = z.infer<typeof commitManifestIntentSchema>;

// ---- Tool output union (handler return shape) ------------------------------------
//
// A feature-package handler returns a structured output, never touches the filesystem.
// `manifest` and `intent` route through the universal-write-path (head layer, Phase 4);
// `data` is a pass-through for read-only tools. Defined here (not in composer) so the
// composer stays decoupled from the checkpoint layer.

export const toolOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manifest"), manifest: mutationManifestSchema }).strict(),
  z.object({ kind: z.literal("intent"), intent: intentSchema }).strict(),
  z.object({ kind: z.literal("data"), data: z.unknown() }).strict(),
]);

export type TinyYeahToolOutput = z.infer<typeof toolOutputSchema>;

// ---- Composed tool spec (zod mirror of TinyYeahComposedToolSpec) ------------------

export const permissionHintSchema = z
  .object({
    readOnly: z.boolean(),
    writesState: z.boolean().optional(),
    writesArtifacts: z.boolean().optional(),
    writesSource: z.boolean().optional(),
    network: z.enum(["none", "optional", "required"]).optional(),
  })
  .strict();

export const smallModelHintSchema = z
  .object({
    outputMode: z.enum(["json", "markdown", "compact", "mixed"]),
    deterministic: z.boolean(),
    maxInputChars: z.number().int().positive().optional(),
    notes: z.array(z.string()).optional(),
  })
  .strict();

export const composedToolSpecSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    packageId: z.string().min(1),
    packageTitle: z.string().min(1),
    permission: permissionHintSchema.optional(),
    smallModel: smallModelHintSchema.optional(),
  })
  .strict();

export type ComposedToolSpec = z.infer<typeof composedToolSpecSchema>;
