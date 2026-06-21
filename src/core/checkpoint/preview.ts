// Tiny-Yeah createPreview (SPEC-TINY-YEAH-001 REQ-TY-006, plan.md §2 Phase 1 / §3.3).
//
// Generalized from Tinker.Gen `src/preview/preview.ts`. The donor was coupled to TemplateManifest
// + a fixed output root (`.tinker/generated`); Tiny-Yeah accepts a generic MutationManifest and
// derives each action's absolute target from the caller-provided outDir (the project root).
//
// Flow:
//   1. zod-validate the manifest.
//   2. For each action: assert path is a safe relative path inside outDir (lexical layer;
//      realpath layer is re-checked at apply). Pre-flight that NO target exists yet — a target
//      that already exists at preview time fails fast with PREVIEW_TARGET_EXISTS rather than
//      deferring the collision to apply.
//   3. Compute manifestHash from the canonical-JSON of the manifest (hashing.ts, plan.md §3.3).
//   4. Derive previewId from the hash prefix.
//   5. Write `.tiny-yeah/previews/{id}.json` (Preview) + `.tiny-yeah/checkpoints/{id}.json`
//      (Checkpoint: manifestHash + per-action sha256). Both files carry schemaVersion (REQ-TY-029)
//      and are written via writeStateJson (atomic temp+rename).

import { lstat } from "node:fs/promises";
import path from "node:path";
import { ensureDir, writeStateJson } from "../state/file-store.js";
import { resolvePathInsideRoot } from "../state/path-safety.js";
import { resolveTinyYeahPaths } from "../state/paths.js";
import type { Checkpoint, MutationManifest, Preview } from "./contracts.js";
import {
  CHECKPOINT_SCHEMA_VERSION,
  mutationManifestSchema,
  PREVIEW_SCHEMA_VERSION,
} from "./contracts.js";
import { YeahError } from "./errors.js";
import { manifestHash } from "./hashing.js";

export interface CreatePreviewInput {
  readonly manifest: MutationManifest;
  readonly outDir: string;
}

export interface CreatePreviewResult {
  readonly preview: Preview;
  readonly checkpoint: Checkpoint;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as { code: unknown }).code === code;
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

function assertSafeRelativePath(outDir: string, candidate: string): string {
  const resolved = resolvePathInsideRoot(outDir, candidate);
  if (!resolved) {
    throw new YeahError({
      code: "APPLY_TARGET_UNSAFE",
      message: `Action path escapes outDir and is rejected: ${candidate}`,
    });
  }
  // Defense in depth: a path that normalizes to include `..` after join must also be rejected.
  const normalized = path.normalize(candidate);
  if (normalized.split(path.sep).includes("..")) {
    throw new YeahError({
      code: "APPLY_TARGET_UNSAFE",
      message: `Action path contains a '..' segment and is rejected: ${candidate}`,
    });
  }
  return resolved;
}

export async function createPreview(input: CreatePreviewInput): Promise<CreatePreviewResult> {
  mutationManifestSchema.parse(input.manifest);
  const paths = resolveTinyYeahPaths(input.outDir);

  const resolvedActions = input.manifest.actions.map((action) => {
    const target = assertSafeRelativePath(input.outDir, action.path);
    return { action, target };
  });

  for (const { action, target } of resolvedActions) {
    if (await exists(target)) {
      throw new YeahError({
        code: "PREVIEW_TARGET_EXISTS",
        message: `Create-only target already exists at preview time: ${action.path}`,
      });
    }
  }

  const hash = manifestHash(input.manifest);
  const previewId = `preview-${hash.slice(0, 12)}`;

  const preview: Preview = {
    schemaVersion: PREVIEW_SCHEMA_VERSION,
    previewId,
    manifestHash: hash,
    actions: input.manifest.actions.map((action) => {
      const { kind, path: actionPath, content, sha256, sourcePointer } = action;
      // Preserve only the fields the schema admits; drop any extras defensively.
      const out: Preview["actions"][number] = { kind, path: actionPath, sha256 };
      if (content !== undefined) out.content = content;
      if (sourcePointer !== undefined) out.sourcePointer = sourcePointer;
      return out;
    }),
  };

  const checkpoint: Checkpoint = {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    previewId,
    manifestHash: hash,
    actionHashes: input.manifest.actions.map((action) => ({
      path: action.path,
      sha256: action.sha256,
    })),
  };

  await ensureDir(paths.previewsDir);
  await ensureDir(paths.checkpointsDir);
  await writeStateJson(path.join(paths.previewsDir, `${previewId}.json`), preview);
  await writeStateJson(path.join(paths.checkpointsDir, `${previewId}.json`), checkpoint);

  return { preview, checkpoint };
}
