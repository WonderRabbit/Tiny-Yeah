// Tiny-Yeah universal write path (SPEC-TINY-YEAH-001 REQ-TY-004, plan.md §3.1).
//
// This is the ONLY entrypoint later phases call to mutate model-produced artifact files. It
// forces every model-emitted manifest through preview -> checkpoint -> apply:
//   - commitManifest(manifest, root): createPreview -> returns { previewId, summary } for the
//     approval gate. The approval gate itself is wired in Phase 4 (head/model-contract); for now
//     both steps are exposed so callers can drive them directly.
//   - applyManifest(previewId, root): applyPreview -> returns the list of written paths.
//
// The composer registry (Phase 2) and head (Phase 4) MUST NOT bypass this module. An
// architecture test (Phase 4) will assert `core/composer` and `head/` route artifact writes
// through here exclusively.

import { applyPreview } from "./apply.js";
import type { MutationManifest } from "./contracts.js";
import { createPreview } from "./preview.js";

export interface CommitManifestInput {
  readonly manifest: MutationManifest;
  readonly root: string;
}

export interface CommitManifestSummary {
  readonly previewId: string;
  readonly manifestHash: string;
  readonly actionCount: number;
  readonly actions: ReadonlyArray<{
    readonly path: string;
    readonly sha256: string;
    readonly staged: boolean;
  }>;
}

export interface CommitManifestResult {
  readonly previewId: string;
  readonly summary: CommitManifestSummary;
}

export async function commitManifest(input: CommitManifestInput): Promise<CommitManifestResult> {
  const { preview, checkpoint } = await createPreview({
    manifest: input.manifest,
    outDir: input.root,
  });
  const summary: CommitManifestSummary = {
    previewId: preview.previewId,
    manifestHash: checkpoint.manifestHash,
    actionCount: preview.actions.length,
    actions: preview.actions.map((action) => ({
      path: action.path,
      sha256: action.sha256,
      staged: action.sourcePointer !== undefined,
    })),
  };
  return { previewId: preview.previewId, summary };
}

export interface ApplyManifestInput {
  readonly previewId: string;
  readonly root: string;
}

export async function applyManifest(input: ApplyManifestInput): Promise<readonly string[]> {
  return applyPreview({ previewId: input.previewId, outDir: input.root });
}
