// Tiny-Yeah checkpoint contracts (SPEC-TINY-YEAH-001 §6.2, plan.md §2 Phase 1 / §3.3 / §3.4).
//
// Generalized from Tinker.Gen `src/preview/contracts.ts`:
//   - TemplateManifest coupling REMOVED — Tiny-Yeah has no template concept.
//   - MutationManifest is the model-emitted artifact (plan.md §3.1): a list of create-only
//     actions, each carrying path + sha256 + (content OR sourcePointer). Content is OPTIONAL
//     because of content-staging (REQ-TY-027): large bodies live in `.tiny-yeah/staging/<sha256>`
//     and the action references them by `sourcePointer`, dereferenced by the kernel at apply
//     time. The schema MUST allow sourcePointer now; the budget is enforced in Phase 4 (head).
//   - Every artifact carries a `schemaVersion` literal (REQ-TY-029 pattern, donor contracts.ts).

import { z } from "zod";

export const MUTATION_MANIFEST_SCHEMA_VERSION = "tiny-yeah.mutation-manifest.v1";
export const PREVIEW_SCHEMA_VERSION = "tiny-yeah.preview.v1";
export const CHECKPOINT_SCHEMA_VERSION = "tiny-yeah.checkpoint.v1";

export const mutationActionSchema = z
  .object({
    kind: z.literal("create"),
    path: z.string().min(1),
    content: z.string().optional(),
    sha256: z.string().length(64),
    sourcePointer: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (action) => (action.content !== undefined) !== (action.sourcePointer !== undefined),
    "Exactly one of `content` or `sourcePointer` must be set on a mutation action",
  );

export const mutationManifestSchema = z
  .object({
    schemaVersion: z.literal(MUTATION_MANIFEST_SCHEMA_VERSION),
    actions: z.array(mutationActionSchema).min(1),
  })
  .strict();

export const previewActionSchema = z
  .object({
    kind: z.literal("create"),
    path: z.string().min(1),
    content: z.string().optional(),
    sha256: z.string().length(64),
    sourcePointer: z.string().min(1).optional(),
  })
  .strict();

export const previewSchema = z
  .object({
    schemaVersion: z.literal(PREVIEW_SCHEMA_VERSION),
    previewId: z.string().min(1),
    manifestHash: z.string().length(64),
    actions: z.array(previewActionSchema),
  })
  .strict();

export const checkpointSchema = z
  .object({
    schemaVersion: z.literal(CHECKPOINT_SCHEMA_VERSION),
    previewId: z.string().min(1),
    manifestHash: z.string().length(64),
    actionHashes: z.array(z.object({ path: z.string().min(1), sha256: z.string().length(64) })),
  })
  .strict();

export type MutationAction = z.infer<typeof mutationActionSchema>;
export type MutationManifest = z.infer<typeof mutationManifestSchema>;
export type PreviewAction = z.infer<typeof previewActionSchema>;
export type Preview = z.infer<typeof previewSchema>;
export type Checkpoint = z.infer<typeof checkpointSchema>;
