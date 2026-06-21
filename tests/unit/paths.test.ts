// UNIT: Tiny-Yeah paths resolver (SPEC-TINY-YEAH-001 REQ-TY-007/008, plan.md §2 Phase 1).
// Pins the `.tiny-yeah/` layout produced by resolveTinyYeahPaths. Parity with the donor
// (Tiny-Chu resolveTinyChuPaths) on the structural contract, adapted to Tiny-Yeah surfaces.

import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTinyYeahPaths } from "../../src/core/state/paths.js";

describe("resolveTinyYeahPaths — `.tiny-yeah/` layout", () => {
  it("resolves root to an absolute path and derives all surfaces under `.tiny-yeah/`", () => {
    const p = resolveTinyYeahPaths("/tmp/project");
    expect(p.root).toBe(path.resolve("/tmp/project"));
    expect(p.tinyYeahDir).toBe(path.join(p.root, ".tiny-yeah"));
    expect(p.tasksDir).toBe(path.join(p.tinyYeahDir, "tasks"));
    expect(p.plansDir).toBe(path.join(p.tinyYeahDir, "plans"));
    expect(p.locksDir).toBe(path.join(p.tinyYeahDir, "locks"));
    expect(p.stagingDir).toBe(path.join(p.tinyYeahDir, "staging"));
    expect(p.workflowsDir).toBe(path.join(p.tinyYeahDir, "workflows"));
    expect(p.previewsDir).toBe(path.join(p.tinyYeahDir, "previews"));
    expect(p.checkpointsDir).toBe(path.join(p.tinyYeahDir, "checkpoints"));
    expect(p.wikiDir).toBe(path.join(p.tinyYeahDir, "wiki"));
    expect(p.wikiIndexFile).toBe(path.join(p.wikiDir, "index.json"));
  });

  it("derives every surface INSIDE the `.tiny-yeah/` directory (confinement)", () => {
    const p = resolveTinyYeahPaths("/tmp/project");
    for (const dir of [
      p.tasksDir,
      p.plansDir,
      p.locksDir,
      p.stagingDir,
      p.workflowsDir,
      p.previewsDir,
      p.checkpointsDir,
      p.wikiDir,
      p.wikiIndexFile,
    ]) {
      expect(dir.startsWith(`${p.tinyYeahDir}${path.sep}`)).toBe(true);
    }
  });

  it("defaults root to process.cwd() when omitted", () => {
    const p = resolveTinyYeahPaths();
    expect(p.root).toBe(path.resolve(process.cwd()));
  });
});
