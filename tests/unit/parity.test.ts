// UNIT: dual-surface parity (SPEC-TINY-YEAH-001 REQ-TY-019/020, plan.md §3.1).
// Every tool in the composed registry has (a) a library-callable surface AND (b) a plugin tool
// wrapper. No orphan on either side — the "no parallel hand-edited arrays" guarantee at the
// head layer (REQ-TY-011/012 echo).

import { describe, expect, it } from "vitest";
import {
  composeFeaturePackages,
  createDefaultTinyYeahFeaturePackages,
} from "../../src/core/composer/index.js";
import { createTinyYeahLibrarySurface } from "../../src/head/opencode/library-surface.js";
import { createTinyYeahPlugin } from "../../src/head/opencode/plugin.js";

describe("REQ-TY-019/020 — dual-surface parity (library <-> plugin <-> registry)", () => {
  const registry = composeFeaturePackages(createDefaultTinyYeahFeaturePackages());

  it("the plugin wraps every composed tool (every registry spec has a plugin wrapper)", () => {
    const plugin = createTinyYeahPlugin({ root: process.cwd() });
    const toolNames = Object.keys(plugin);
    const specNames = registry.toolSpecs.map((s) => s.name);
    // Every registry spec is present in the plugin surface (no spec without a wrapper).
    for (const name of specNames) {
      expect(toolNames).toContain(name);
    }
    expect(specNames.length).toBeGreaterThan(0);
  });

  it("the library surface exposes every composed tool (no spec without a lib handler)", () => {
    const lib = createTinyYeahLibrarySurface({ root: process.cwd() });
    const libNames = Object.keys(lib);
    const specNames = registry.toolSpecs.map((s) => s.name);
    for (const name of specNames) {
      expect(libNames).toContain(name);
    }
  });

  it("library surface and plugin surface are 1:1 (REQ-TY-019 dual-surface parity)", () => {
    const plugin = createTinyYeahPlugin({ root: process.cwd() });
    const lib = createTinyYeahLibrarySurface({ root: process.cwd() });
    // The plugin reserves `tiny_yeah_install_check`; the library surface does too once parity
    // is checked via that diagnostic. The tool sets must match exactly.
    expect(Object.keys(lib).sort()).toEqual(Object.keys(plugin).sort());
  });

  it("the install_check diagnostic name is reserved (REQ-TY-023 naming anchor)", () => {
    const plugin = createTinyYeahPlugin({ root: process.cwd() });
    // The diagnostic is emitted by the plugin surface; its name is fixed for the naming-check
    // pipeline (Phase 5). Even if not in the seed registry, the plugin must expose it.
    expect(Object.keys(plugin)).toContain("tiny_yeah_install_check");
  });
});
