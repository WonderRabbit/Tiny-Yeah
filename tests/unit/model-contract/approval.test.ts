// UNIT: model-contract/approval (SPEC-TINY-YEAH-001 REQ-TY-003/004, plan.md §3.7 T8).
// The approval gate. commitManifest produces a Preview and a BOUNDED summary (no content);
// applyApproved is the ONLY path that writes artifact files. The model NEVER holds a write handle.

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MutationManifest } from "../../../src/core/checkpoint/contracts.js";
import { commitManifest } from "../../../src/core/checkpoint/universal-write-path.js";
import { applyApproved, requestApproval } from "../../../src/model-contract/approval.js";

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function twoActionManifest(): MutationManifest {
  return {
    schemaVersion: "tiny-yeah.mutation-manifest.v1",
    actions: [
      { kind: "create", path: "src/a.ts", content: "a\n", sha256: sha256("a\n") },
      { kind: "create", path: "src/b.ts", content: "b\n", sha256: sha256("b\n") },
    ],
  };
}

describe("approval gate — requestApproval returns a BOUNDED summary (REQ-TY-003)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-approval-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("summary carries previewId + actionCount + per-action path & sha256 prefix, NO content", async () => {
    const { previewId } = await commitManifest({ manifest: twoActionManifest(), root });
    const summary = await requestApproval({ previewId, root });
    expect(summary.previewId).toBe(previewId);
    expect(summary.actionCount).toBe(2);
    expect(summary.actions).toHaveLength(2);
    for (const action of summary.actions) {
      expect(action.path).toBeTypeOf("string");
      expect(action.sha256Prefix).toBeTypeOf("string");
      expect(action.sha256Prefix.length).toBeLessThanOrEqual(12);
      // No raw content may cross the approval surface.
      expect((action as { content?: unknown }).content).toBeUndefined();
    }
  });

  it("T8: commitManifest does NOT write artifact files — they appear ONLY after applyApproved", async () => {
    const { previewId } = await commitManifest({ manifest: twoActionManifest(), root });
    // Before approval: no artifact files exist.
    for (const rel of ["src/a.ts", "src/b.ts"]) {
      await expect(readFile(path.join(root, rel))).rejects.toThrow();
    }
    // After explicit applyApproved: files appear.
    const written = await applyApproved({ previewId, root });
    expect(written.length).toBe(2);
    expect(await readFile(path.join(root, "src", "a.ts"), "utf8")).toBe("a\n");
    expect(await readFile(path.join(root, "src", "b.ts"), "utf8")).toBe("b\n");
  });

  it("applyApproved without a prior commit (unknown previewId) fails closed — no write", async () => {
    await expect(applyApproved({ previewId: "nonexistent", root })).rejects.toThrow();
  });
});
