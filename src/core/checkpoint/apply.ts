// Tiny-Yeah applyPreview (SPEC-TINY-YEAH-001 REQ-TY-004/005/006/007/028, plan.md §3.1/§3.2/§3.5/§3.6).
//
// Ported from Tinker.Gen `src/apply/apply.ts` and generalized + hardened:
//
//   §3.1 caller-graph: apply is reached ONLY via universal-write-path.ts; head/composer never
//   call it directly.
//
//   §3.2 current-manifest: the donor re-read `template-manifest.json` from disk at apply time
//   (TOCTOU window). Tiny-Yeah stores manifestHash + actionHashes INSIDE the checkpoint at
//   preview time (immutable) and re-derives at apply from the preview itself. NO external
//   template-manifest file read.
//
//   §3.5 Defender retry: per-file atomic writes go through writeCreateOnlyFile, which wraps the
//   open/link primitives in withWriteRetry (exponential backoff + jitter, bounded under the lock
//   lease renewal window).
//
//   §3.6 / REQ-TY-028 batch all-or-nothing: a PRE-FLIGHT loop checks EVERY action's path safety
//   + content-hash match + target existence BEFORE writing ANY file. If any action fails the
//   pre-flight, the whole apply fails with APPLY_TARGET_EXISTS / PREVIEW_STALE / APPLY_TARGET_UNSAFE
//   and ZERO files are written. The write loop follows only after pre-flight passes; per-file
//   atomic writes (temp + link, REQ-TY-005) preserve crash-safety inside the envelope.
//
//   NF2 apply lock: the donor's single-process `apply.lock` sentinel (EEXIST -> APPLY_LOCKED,
//   no queue) is REPLACED by the generic lock-store with nonBlocking:true. A concurrent apply
//   gets APPLY_LOCKED immediately — there is no wait queue.
//
// REQ-TY-006 5-layer validation, applied per action in the pre-flight loop:
//   (a) previewId/previewId + preview.manifestHash/checkpoint.manifestHash consistency (once).
//   (b) checkpoint-stored manifestHash is the immutable truth (no external file read).
//   (c) per-action content sha256 === action.sha256 (content inline OR dereferenced from
//       sourcePointer at apply time).
//   (d) target does not exist (pre-flight, REQ-TY-028 all-or-nothing).
//   (e) path safety (lexical + realpath, REQ-TY-007).

import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { readStateJson } from "../state/file-store.js";
import { acquireTinyYeahLock } from "../state/lock-store.js";
import { resolvePathInsideRoot } from "../state/path-safety.js";
import { resolveTinyYeahPaths } from "../state/paths.js";
import { writeCreateOnlyFile } from "./atomic-write.js";
import type { PreviewAction } from "./contracts.js";
import {
  CHECKPOINT_SCHEMA_VERSION,
  checkpointSchema,
  PREVIEW_SCHEMA_VERSION,
  previewSchema,
} from "./contracts.js";
import { YeahError } from "./errors.js";

const APPLY_LOCK_NAME = "apply.lock";
const PREVIEW_ID_PATTERN = /^preview-[a-f0-9]{12}$/;

export interface ApplyPreviewInput {
  readonly previewId: string;
  readonly outDir: string;
}

function hasFsCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as { code: unknown }).code === code;
}

async function safeLstat(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (hasFsCode(error, "ENOENT")) return false;
    throw error;
  }
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function assertPreviewId(previewId: string): void {
  if (!PREVIEW_ID_PATTERN.test(previewId)) {
    throw new YeahError({
      code: "PREVIEW_REQUIRED",
      message: `A valid preview id (preview-<12 hex>) is required; got: ${previewId}`,
    });
  }
}

function assertPathConfinement(outDir: string, candidate: string): string {
  const lexical = resolvePathInsideRoot(outDir, candidate);
  if (!lexical) {
    throw new YeahError({
      code: "APPLY_TARGET_UNSAFE",
      message: `Action path escapes outDir and is rejected: ${candidate}`,
    });
  }
  return lexical;
}

async function assertRealpathInside(anchor: string, target: string): Promise<void> {
  try {
    const [realAnchor, realParent] = await Promise.all([
      realpath(anchor),
      realpath(dirname(target)),
    ]);
    if (realParent !== realAnchor && !realParent.startsWith(`${realAnchor}${sep}`)) {
      throw new YeahError({
        code: "APPLY_TARGET_UNSAFE",
        message: `Action parent realpath escapes outDir: ${target}`,
      });
    }
  } catch (error) {
    if (error instanceof YeahError) throw error;
    if (!hasFsCode(error, "ENOENT")) throw error;
  }
}

/**
 * Resolve an action's content. Inline content is returned verbatim. A `sourcePointer` is
 * dereferenced from `.tiny-yeah/staging/<hash>` (content-staging, REQ-TY-027). The pointer is a
 * ROOT-relative path; the kernel resolves it against the project root and then verifies the
 * resolved absolute path is strictly inside `stagingDir`. The dereferenced content's sha256 MUST
 * match action.sha256 — the model emits only the pointer; the kernel owns the dereference and the
 * integrity check.
 */
async function resolveActionContent(
  action: PreviewAction,
  root: string,
  stagingDir: string,
): Promise<string> {
  if (action.content !== undefined) {
    return action.content;
  }
  if (action.sourcePointer !== undefined) {
    const pointer = action.sourcePointer;
    const resolved = resolvePathInsideRoot(root, pointer);
    if (!resolved?.startsWith(`${stagingDir}${sep}`)) {
      throw new YeahError({
        code: "STAGING_POINTER_INVALID",
        message: `sourcePointer must point inside .tiny-yeah/staging/: ${pointer}`,
      });
    }
    let raw: string;
    try {
      raw = await readFile(resolved, "utf8");
    } catch (error) {
      if (hasFsCode(error, "ENOENT")) {
        throw new YeahError({
          code: "STAGING_POINTER_INVALID",
          message: `sourcePointer staging file does not exist: ${pointer}`,
        });
      }
      throw error;
    }
    return raw;
  }
  // Unreachable: the zod schema enforces content XOR sourcePointer. Defend in depth.
  throw new YeahError({
    code: "PREVIEW_STALE",
    message: `Action has neither content nor sourcePointer: ${action.path}`,
  });
}

interface PreflightEntry {
  readonly action: PreviewAction;
  readonly target: string;
  readonly content: string;
}

export async function applyPreview(input: ApplyPreviewInput): Promise<readonly string[]> {
  assertPreviewId(input.previewId);
  const paths = resolveTinyYeahPaths(input.outDir);

  const lock = await acquireTinyYeahLock(input.outDir, APPLY_LOCK_NAME, { nonBlocking: true });
  if (!lock) {
    throw new YeahError({
      code: "APPLY_LOCKED",
      message: "Another apply operation is already running",
      recoveryHint: "Wait for the in-flight apply to complete, then retry.",
    });
  }
  try {
    const preview = previewSchema.parse(
      await readStateJson(
        `${paths.previewsDir}/${input.previewId}.json`,
        PREVIEW_SCHEMA_VERSION,
        undefined,
      ),
    );
    const checkpoint = checkpointSchema.parse(
      await readStateJson(
        `${paths.checkpointsDir}/${input.previewId}.json`,
        CHECKPOINT_SCHEMA_VERSION,
        undefined,
      ),
    );

    // Layer (a): preview/checkpoint consistency.
    if (
      preview.previewId !== checkpoint.previewId ||
      preview.manifestHash !== checkpoint.manifestHash
    ) {
      throw new YeahError({
        code: "PREVIEW_STALE",
        message: "Preview checkpoint does not match preview",
      });
    }

    // PRE-FLIGHT (REQ-TY-028 all-or-nothing): check EVERY action before writing ANY.
    const preflight: PreflightEntry[] = [];
    for (const action of preview.actions) {
      // Layer (c): content sha256 match (content inline OR dereferenced from sourcePointer).
      const content = await resolveActionContent(action, input.outDir, paths.stagingDir);
      if (sha256(content) !== action.sha256) {
        throw new YeahError({
          code: "PREVIEW_STALE",
          message: `Preview content hash mismatch for ${action.path}`,
        });
      }
      // Layer (c) cross-check: checkpoint-stored action sha256 must agree with preview.
      const stored = checkpoint.actionHashes.find((entry) => entry.path === action.path);
      if (!stored || stored.sha256 !== action.sha256) {
        throw new YeahError({
          code: "PREVIEW_STALE",
          message: `Checkpoint action hash missing/mismatch for ${action.path}`,
        });
      }

      // Layer (e): path confinement (lexical + realpath).
      const target = assertPathConfinement(input.outDir, action.path);
      await assertRealpathInside(resolve(input.outDir), target);

      // Layer (d): target must not exist.
      if (await safeLstat(target)) {
        throw new YeahError({
          code: "APPLY_TARGET_EXISTS",
          message: `Create-only target already exists: ${action.path}`,
        });
      }

      preflight.push({ action, target, content });
    }

    // WRITE loop: per-file atomic create-only write (temp + O_NOFOLLOW open + link, §3.5 retry).
    const written: string[] = [];
    for (const { target, content } of preflight) {
      await writeCreateOnlyFile(target, content);
      written.push(target);
    }
    return written;
  } finally {
    await lock.release();
  }
}
