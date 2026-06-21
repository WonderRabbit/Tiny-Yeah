// UNIT: planMutation — pure helper turning an intent + inventory into a MutationManifest skeleton.
// plan.md §3.4 (content-staging): the manifest carries sourcePointers (sha256 of intended content)
// rather than inline content beyond budget. For Phase 3, planMutation emits a SKELETON (paths +
// sourcePointers, NO inline content) that the model/head fills in Phase 4.

import { describe, expect, it } from "vitest";
import { mutationManifestSchema } from "../../../src/core/checkpoint/contracts.js";
import type { Inventory } from "../../../src/core/pipeline/analyze.js";
import { planMutation } from "../../../src/core/pipeline/plan.js";

const inventory: Inventory = {
  schemaVersion: "tiny-yeah.inventory.v1",
  providerId: "builtin",
  providerVersion: "0.1.0",
  artifactSchemaVersion: "tiny-yeah.analysis-artifacts.v1",
  command: "tiny-yeah analyze",
  cwd: "/cwd",
  projectPath: "/proj",
  timestamp: "2026-01-01T00:00:00.000Z",
  indexed: { fileCount: 2 },
  diagnostics: [],
  sourceRefs: [{ path: "src/page.tsx", kind: "file" }],
  files: [
    { path: "src/page.tsx", language: "TypeScript", bytes: 100 },
    { path: "package.json", language: "JSON", bytes: 50 },
  ],
  languageCounts: { TypeScript: 1, JSON: 1 },
  packageManifests: [{ path: "package.json", name: "demo", version: "1.0.0", type: "module" }],
  importGraph: { nodes: ["src/page.tsx"], edges: [] },
};

describe("planMutation — manifest skeleton shape", () => {
  it("produces a manifest with at least one create action per target path", () => {
    const manifest = planMutation(inventory, {
      targets: ["docs/ui.md", "docs/wireframe.html"],
    });
    expect(manifest.schemaVersion).toBe("tiny-yeah.mutation-manifest.v1");
    expect(manifest.actions.length).toBe(2);
    const paths = manifest.actions.map((a) => a.path).sort();
    expect(paths).toEqual(["docs/ui.md", "docs/wireframe.html"]);
  });

  it("every action carries a 64-char sha256 sourcePointer and NO inline content (skeleton)", () => {
    const manifest = planMutation(inventory, { targets: ["a.txt"] });
    for (const action of manifest.actions) {
      expect(action.sourcePointer).toBeDefined();
      expect(action.sourcePointer?.length).toBe(64);
      expect(action.sha256.length).toBe(64);
      // Phase 3 skeleton: content is staged by the head in Phase 4, not emitted inline here.
      expect(action.content).toBeUndefined();
    }
  });

  it("is deterministic — same intent + inventory yields the same manifest", () => {
    const intent = { targets: ["x.txt", "y.txt"] };
    const a = planMutation(inventory, intent);
    const b = planMutation(inventory, intent);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces a manifest that validates against mutationManifestSchema", () => {
    const manifest = planMutation(inventory, { targets: ["a.txt"] });
    // The schema requires exactly one of content|sourcePointer; skeleton uses sourcePointer.
    expect(mutationManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it("throws on an empty target list (a manifest requires >= 1 action)", () => {
    expect(() => planMutation(inventory, { targets: [] })).toThrow();
  });
});
