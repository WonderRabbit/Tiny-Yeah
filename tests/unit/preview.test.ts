// UNIT: Tiny-Yeah createPreview (SPEC-TINY-YEAH-001 REQ-TY-006, plan.md §2 Phase 1 / §3.3).
// Pins the preview -> checkpoint write: manifest validation, pre-flight target-existence check,
// previewId derivation from manifestHash, and the `.tiny-yeah/previews|checkpoints/` outputs.

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MutationManifest } from "../../src/core/checkpoint/contracts.js";
import { YeahError } from "../../src/core/checkpoint/errors.js";
import { manifestHash } from "../../src/core/checkpoint/hashing.js";
import { createPreview } from "../../src/core/checkpoint/preview.js";
import { resolveTinyYeahPaths } from "../../src/core/state/paths.js";

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function manifestOf(actions: MutationManifest["actions"]): MutationManifest {
  return { schemaVersion: "tiny-yeah.mutation-manifest.v1", actions };
}

describe("createPreview — preview + checkpoint outputs", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-yeah-preview-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes `.tiny-yeah/previews/{id}.json` and `.tiny-yeah/checkpoints/{id}.json`", async () => {
    const manifest = manifestOf([
      { kind: "create", path: "src/a.ts", content: "a\n", sha256: sha256("a\n") },
    ]);
    const { preview } = await createPreview({ manifest, outDir: root });
    const paths = resolveTinyYeahPaths(root);
    const previewRaw = JSON.parse(
      await readFile(path.join(paths.previewsDir, `${preview.previewId}.json`), "utf8"),
    );
    const checkpointRaw = JSON.parse(
      await readFile(path.join(paths.checkpointsDir, `${preview.previewId}.json`), "utf8"),
    );
    expect(previewRaw.previewId).toBe(preview.previewId);
    expect(previewRaw.schemaVersion).toBe("tiny-yeah.preview.v1");
    expect(checkpointRaw.schemaVersion).toBe("tiny-yeah.checkpoint.v1");
    expect(checkpointRaw.actionHashes).toEqual([{ path: "src/a.ts", sha256: sha256("a\n") }]);
  });

  it("derives previewId from the manifestHash prefix", async () => {
    const manifest = manifestOf([
      { kind: "create", path: "src/a.ts", content: "a\n", sha256: sha256("a\n") },
    ]);
    const { preview } = await createPreview({ manifest, outDir: root });
    expect(preview.previewId).toBe(`preview-${manifestHash(manifest).slice(0, 12)}`);
    expect(preview.manifestHash).toBe(manifestHash(manifest));
  });

  it("throws PREVIEW_TARGET_EXISTS when a target already exists at preview time", async () => {
    const target = path.join(root, "src", "exists.ts");
    await import("node:fs/promises").then((m) =>
      m.mkdir(path.dirname(target), { recursive: true }),
    );
    await writeFile(target, "old", "utf8");
    const manifest = manifestOf([
      { kind: "create", path: "src/exists.ts", content: "new", sha256: sha256("new") },
    ]);
    let caught: unknown;
    try {
      await createPreview({ manifest, outDir: root });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YeahError);
    expect((caught as YeahError).code).toBe("PREVIEW_TARGET_EXISTS");
  });

  it("rejects a `..`-escape action path (REQ-TY-007 lexical layer)", async () => {
    const manifest = manifestOf([
      { kind: "create", path: "../escape.txt", content: "x", sha256: sha256("x") },
    ]);
    let caught: unknown;
    try {
      await createPreview({ manifest, outDir: root });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YeahError);
    expect((caught as YeahError).code).toBe("APPLY_TARGET_UNSAFE");
  });
});
