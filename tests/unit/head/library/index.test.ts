// UNIT: head/library barrel (SPEC-TINY-YEAH-001 REQ-TY-019/020, plan.md Phase 5).
//
// src/head/library/ is the CANONICAL home for the host-agnostic programmatic surface: every
// tool callable as a function WITHOUT a host runtime. The OpenCode plugin (src/head/opencode/)
// re-uses the same composed registry via buildTinyYeahTools — one registry, one wrapper, two
// thin host adapters. REQ-TY-019 parity is enforced by parity.test.ts.

import { describe, expect, it } from "vitest";
import {
  buildTinyYeahTools,
  type CreateSurfaceInput,
  createTinyYeahLibrarySurface,
  type TinyYeahLibrarySurface,
} from "../../../../src/head/library/index.js";

describe("head/library barrel — REQ-TY-019/020 canonical library home", () => {
  it("createTinyYeahLibrarySurface returns a record of callable tools (no host runtime)", () => {
    const input: CreateSurfaceInput = { root: process.cwd() };
    const surface: TinyYeahLibrarySurface = createTinyYeahLibrarySurface(input);
    expect(Object.keys(surface).length).toBeGreaterThan(0);
    for (const name of Object.keys(surface)) {
      const tool = surface[name];
      if (!tool) continue;
      expect(typeof tool.run).toBe("function");
      expect(typeof tool.name).toBe("string");
    }
  });

  it("exposes the tiny_yeah_install_check parity diagnostic (REQ-TY-020)", () => {
    const surface = createTinyYeahLibrarySurface({ root: process.cwd() });
    expect(surface.tiny_yeah_install_check).toBeDefined();
    expect(surface.tiny_yeah_install_check?.name).toBe("tiny_yeah_install_check");
  });

  it("tiny_yeah_install_check returns a bounded task-focused status with next action", async () => {
    const surface = createTinyYeahLibrarySurface({ root: process.cwd() });
    const tool = surface.tiny_yeah_install_check;
    expect(tool).toBeDefined();
    if (tool === undefined) return;

    const result = await tool.run({ input: {}, root: process.cwd() });
    const parsed = JSON.parse(result.output);

    expect(parsed.schemaVersion).toBe("tiny-yeah.install-check.v1");
    expect(parsed.parity).toBe("ok");
    expect(parsed.nextAction).toBe(
      "Run tiny-yeah doctor --json when install health evidence is needed.",
    );
    expect(parsed.latestEvidencePath).toBeNull();
    expect(result.output.length).toBeLessThanOrEqual(tool.budget.chars);
    expect(result.metadata.truncated).toBe(false);
    expect(result.metadata.readOnly).toBe(true);
    expect(result.output).not.toContain("npm ERR!");
    expect(result.output).not.toContain("PowerShell transcript");
  });

  it("buildTinyYeahTools is the same factory the plugin consumes (parity anchor)", () => {
    const tools = buildTinyYeahTools({ root: process.cwd() });
    const surface = createTinyYeahLibrarySurface({ root: process.cwd() });
    const toolNames = Object.keys(tools).sort();
    const surfaceNames = Object.keys(surface).sort();
    // buildTinyYeahTools returns the composed-registry tools; createTinyYeahLibrarySurface wraps
    // that and adds the tiny_yeah_install_check diagnostic. So the surface is the factory output
    // PLUS the diagnostic — every factory tool appears in the surface (subset relation).
    for (const name of toolNames) {
      expect(surfaceNames).toContain(name);
    }
    expect(surfaceNames).toContain("tiny_yeah_install_check");
  });
});
