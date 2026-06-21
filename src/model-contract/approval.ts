// Tiny-Yeah model-contract approval gate (SPEC-TINY-YEAH-001 REQ-TY-003/004, plan.md §3.7 T8).
//
// The approval gate enforces "the model never holds a write handle":
//   - `requestApproval({ previewId, root })` returns a BOUNDED summary of an existing preview:
//     previewId + manifestHash + actionCount + per-action { path, sha256Prefix, staged }. It
//     NEVER includes raw `content` — the approval surface is content-free so the model cannot
//     stutter on a large body (constraint (b), REQ-TY-002 preview budget).
//   - `applyApproved({ previewId, root })` is the ONLY function that triggers an artifact write.
//     It delegates to `applyManifest` (universal-write-path). There is no auto-apply path: the
//     head MUST call applyApproved explicitly, and only after the model emits an `applyApproved`
//     intent that passed the boundary.
//
// commitManifest (from core/checkpoint) writes only `.tiny-yeah/previews/` + `checkpoints/`
// (kernel-owned layer B state), never the artifact files (layer A). T8 asserts this.

import path from "node:path";
import { PREVIEW_SCHEMA_VERSION, previewSchema } from "../core/checkpoint/contracts.js";
import { applyManifest } from "../core/checkpoint/universal-write-path.js";
import { readStateJson } from "../core/state/file-store.js";
import { resolveTinyYeahPaths } from "../core/state/paths.js";

export interface ApprovalSummaryAction {
  readonly path: string;
  readonly sha256Prefix: string;
  readonly staged: boolean;
}

export interface ApprovalSummary {
  readonly previewId: string;
  readonly manifestHash: string;
  readonly actionCount: number;
  readonly actions: readonly ApprovalSummaryAction[];
}

export interface RequestApprovalInput {
  readonly previewId: string;
  readonly root: string;
}

export interface ApplyApprovedInput {
  readonly previewId: string;
  readonly root: string;
}

const SHA256_PREFIX_LEN = 12;

/**
 * Read an existing preview and return its bounded (content-free) summary. Idempotent: calling
 * twice yields the same summary. Throws if the preview file is missing or malformed
 * (fail-closed, REQ-TY-008/029).
 */
export async function requestApproval(input: RequestApprovalInput): Promise<ApprovalSummary> {
  const paths = resolveTinyYeahPaths(input.root);
  const previewPath = path.join(paths.previewsDir, `${input.previewId}.json`);
  // readStateJson returns the fallback (`undefined`) on ENOENT; previewSchema.parse then throws
  // a zod error for a missing preview (fail-closed). Malformed JSON throws MalformedJsonError.
  const raw = await readStateJson<unknown>(previewPath, PREVIEW_SCHEMA_VERSION, undefined);
  const preview = previewSchema.parse(raw);
  return {
    previewId: preview.previewId,
    manifestHash: preview.manifestHash,
    actionCount: preview.actions.length,
    actions: preview.actions.map((action) => ({
      path: action.path,
      sha256Prefix: action.sha256.slice(0, SHA256_PREFIX_LEN),
      staged: action.sourcePointer !== undefined,
    })),
  };
}

/**
 * The ONLY artifact-write trigger. Delegates to the universal-write-path apply step. The head
 * layer must obtain explicit model approval (via an `applyApproved` intent) before calling this.
 */
export async function applyApproved(input: ApplyApprovedInput): Promise<readonly string[]> {
  return applyManifest({ previewId: input.previewId, root: input.root });
}
