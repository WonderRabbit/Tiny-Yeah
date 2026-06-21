// UNIT: Tiny-Yeah universal write path (SPEC-TINY-YEAH-001 REQ-TY-004, plan.md §3.1).
// Pins the ONLY entrypoint for model-produced artifact writes: commitManifest -> applyManifest.

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MutationManifest } from "../../src/core/checkpoint/contracts.js";
import { applyManifest, commitManifest } from "../../src/core/checkpoint/universal-write-path.js";

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

describe("universal-write-path — commitManifest + applyManifest round-trip", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-yeah-uwp-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("commitManifest returns a summary (previewId + action paths + staged flag), then applyManifest writes the files", async () => {
    const manifest: MutationManifest = {
      schemaVersion: "tiny-yeah.mutation-manifest.v1",
      actions: [
        { kind: "create", path: "src/a.ts", content: "a\n", sha256: sha256("a\n") },
        { kind: "create", path: "src/b.ts", content: "b\n", sha256: sha256("b\n") },
      ],
    };
    const { previewId, summary } = await commitManifest({ manifest, root });
    expect(summary.actionCount).toBe(2);
    expect(summary.actions.map((a) => a.path).sort()).toEqual(["src/a.ts", "src/b.ts"]);
    expect(summary.actions.every((a) => !a.staged)).toBe(true);

    const written = await applyManifest({ previewId, root });
    expect(written.length).toBe(2);
    expect(await readFile(path.join(root, "src", "a.ts"), "utf8")).toBe("a\n");
    expect(await readFile(path.join(root, "src", "b.ts"), "utf8")).toBe("b\n");
  });

  it("the approval gate surface: commitManifest does NOT write artifact files (only preview/checkpoint)", async () => {
    const manifest: MutationManifest = {
      schemaVersion: "tiny-yeah.mutation-manifest.v1",
      actions: [{ kind: "create", path: "src/x.ts", content: "x", sha256: sha256("x") }],
    };
    await commitManifest({ manifest, root });
    let exists = false;
    try {
      await readFile(path.join(root, "src", "x.ts"));
      exists = true;
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});
