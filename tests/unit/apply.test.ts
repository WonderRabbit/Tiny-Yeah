// UNIT: Tiny-Yeah applyPreview (SPEC-TINY-YEAH-001 REQ-TY-004/005/006/007/028, plan.md §3.2/§3.5/§3.6).
// Pins the full E2E flow: createPreview -> applyPreview happy path, re-apply -> APPLY_TARGET_EXISTS
// with ZERO files, the REQ-TY-028 batch all-or-nothing (5-action batch, action-3 pre-exists),
// the NF2 APPLY_LOCKED (non-blocking apply lock via lock-store), path confinement, and
// content via sourcePointer deref (staging file read at apply time).

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyPreview } from "../../src/core/checkpoint/apply.js";
import type { MutationManifest } from "../../src/core/checkpoint/contracts.js";
import { YeahError } from "../../src/core/checkpoint/errors.js";
import { createPreview } from "../../src/core/checkpoint/preview.js";
import { acquireTinyYeahLock } from "../../src/core/state/lock-store.js";
import { resolveTinyYeahPaths } from "../../src/core/state/paths.js";

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function manifestOf(actions: MutationManifest["actions"]): MutationManifest {
  return { schemaVersion: "tiny-yeah.mutation-manifest.v1", actions };
}

async function prepare(overrides: {
  root: string;
  actions?: MutationManifest["actions"];
}): Promise<{ previewId: string; manifest: MutationManifest }> {
  const actions = overrides.actions ?? [
    {
      kind: "create",
      path: "src/widget.ts",
      content: "export const X = 1;\n",
      sha256: sha256("export const X = 1;\n"),
    },
  ];
  const manifest = manifestOf(actions);
  const { preview } = await createPreview({ manifest, outDir: overrides.root });
  return { previewId: preview.previewId, manifest };
}

describe("applyPreview — E2E happy path", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-yeah-apply-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes create-only files from a checkpointed preview", async () => {
    const { previewId } = await prepare({ root });
    const written = await applyPreview({ previewId, outDir: root });
    expect(written.length).toBe(1);
    expect(await readFile(path.join(root, "src", "widget.ts"), "utf8")).toBe(
      "export const X = 1;\n",
    );
  });

  it("rejects a malformed previewId with PREVIEW_REQUIRED", async () => {
    let caught: unknown;
    try {
      await applyPreview({ previewId: "not-a-preview-id", outDir: root });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YeahError);
    expect((caught as YeahError).code).toBe("PREVIEW_REQUIRED");
  });
});

describe("applyPreview — re-apply -> APPLY_TARGET_EXISTS with ZERO files (REQ-TY-005/028)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-yeah-apply-reapply-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("a second apply fails with APPLY_TARGET_EXISTS and leaves the first content intact", async () => {
    const { previewId } = await prepare({ root });
    await applyPreview({ previewId, outDir: root });
    let caught: unknown;
    try {
      await applyPreview({ previewId, outDir: root });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YeahError);
    expect((caught as YeahError).code).toBe("APPLY_TARGET_EXISTS");
    expect(await readFile(path.join(root, "src", "widget.ts"), "utf8")).toBe(
      "export const X = 1;\n",
    );
  });
});

describe("applyPreview — REQ-TY-028 batch all-or-nothing pre-flight", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-yeah-apply-batch-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("a 5-action batch where action-3 target pre-exists writes ZERO files and fails APPLY_TARGET_EXISTS", async () => {
    const actions: MutationManifest["actions"] = [
      { kind: "create", path: "out/a.txt", content: "A", sha256: sha256("A") },
      { kind: "create", path: "out/b.txt", content: "B", sha256: sha256("B") },
      { kind: "create", path: "out/c.txt", content: "C", sha256: sha256("C") },
      { kind: "create", path: "out/d.txt", content: "D", sha256: sha256("D") },
      { kind: "create", path: "out/e.txt", content: "E", sha256: sha256("E") },
    ];
    // Preview succeeds (no targets exist yet).
    const { previewId } = await prepare({ root, actions });

    // BETWEEN preview and apply: action-3's target appears (simulating a concurrent writer or a
    // stale file from a previous run). This must trip the APPLY-stage pre-flight, not preview's.
    const action3Path = path.join(root, "out", "c.txt");
    await mkdir(path.dirname(action3Path), { recursive: true });
    await writeFile(action3Path, "preexisting", "utf8");

    let caught: unknown;
    try {
      await applyPreview({ previewId, outDir: root });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YeahError);
    expect((caught as YeahError).code).toBe("APPLY_TARGET_EXISTS");

    // ZERO files written: a, b, d, e must NOT exist; c keeps its preexisting content.
    for (const name of ["a.txt", "b.txt", "d.txt", "e.txt"]) {
      const target = path.join(root, "out", name);
      let exists = false;
      try {
        await readFile(target);
        exists = true;
      } catch {
        exists = false;
      }
      expect(exists).toBe(false);
    }
    expect(await readFile(action3Path, "utf8")).toBe("preexisting");
  });
});

describe("applyPreview — NF2 APPLY_LOCKED (non-blocking apply lock)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-yeah-apply-locked-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("rejects apply when the apply lock is already held (APPLY_LOCKED, no wait)", async () => {
    const { previewId } = await prepare({ root });
    // Pre-hold the apply lock via the generic lock-store (same name apply.ts uses).
    const holder = await acquireTinyYeahLock(root, "apply.lock", { nonBlocking: true });
    expect(holder).toBeDefined();
    try {
      let caught: unknown;
      try {
        await applyPreview({ previewId, outDir: root });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(YeahError);
      expect((caught as YeahError).code).toBe("APPLY_LOCKED");
    } finally {
      await holder?.release();
    }
  });
});

describe("applyPreview — path confinement (REQ-TY-007)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-yeah-apply-paths-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("a manifest with a `..`-escape path cannot even be previewed (lexical rejection at preview)", async () => {
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

describe("applyPreview — content via sourcePointer deref (REQ-TY-027, apply-time kernel deref)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-yeah-apply-staging-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("applies content dereferenced from a `.tiny-yeah/staging/<hash>` pointer", async () => {
    const stagingContent = "<html>big wireframe body</html>\n";
    const hash = sha256(stagingContent);
    const paths = resolveTinyYeahPaths(root);
    await mkdir(paths.stagingDir, { recursive: true });
    // staging filename = content sha256 (content-addressed).
    await writeFile(path.join(paths.stagingDir, hash), stagingContent, "utf8");

    const manifest = manifestOf([
      {
        kind: "create",
        path: "out/wireframe.html",
        sha256: hash,
        sourcePointer: `.tiny-yeah/staging/${hash}`,
      },
    ]);
    const { previewId } = await prepare({ root, actions: manifest.actions });
    const written = await applyPreview({ previewId, outDir: root });
    expect(written.length).toBe(1);
    expect(await readFile(path.join(root, "out", "wireframe.html"), "utf8")).toBe(stagingContent);
  });

  it("rejects a sourcePointer that does not point inside `.tiny-yeah/staging/`", async () => {
    const manifest = manifestOf([
      {
        kind: "create",
        path: "out/x.txt",
        sha256: "0".repeat(64),
        sourcePointer: "../escape.txt",
      },
    ]);
    const { previewId } = await prepare({ root, actions: manifest.actions });
    let caught: unknown;
    try {
      await applyPreview({ previewId, outDir: root });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YeahError);
    expect((caught as YeahError).code).toBe("STAGING_POINTER_INVALID");
  });
});

describe("applyPreview — REQ-TY-006 multi-layer validation", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-yeah-apply-validate-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("PREVIEW_STALE when the preview and checkpoint manifestHash disagree", async () => {
    const { previewId } = await prepare({ root });
    // Tamper with the checkpoint file's manifestHash after the fact.
    const paths = resolveTinyYeahPaths(root);
    const checkpointFile = path.join(paths.checkpointsDir, `${previewId}.json`);
    const checkpoint = JSON.parse(await readFile(checkpointFile, "utf8"));
    checkpoint.manifestHash = "f".repeat(64);
    await writeFile(checkpointFile, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
    let caught: unknown;
    try {
      await applyPreview({ previewId, outDir: root });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YeahError);
    expect((caught as YeahError).code).toBe("PREVIEW_STALE");
  });
});
