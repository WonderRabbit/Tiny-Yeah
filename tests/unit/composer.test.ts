// UNIT: feature-package composer (SPEC-TINY-YEAH-001 REQ-TY-011).
// Pins the single-source-of-truth registry: happy-path compose, the 4 rejection codes
// (duplicate_package_id / missing_dependency / dependency_cycle / duplicate_tool_name),
// invalid_package / invalid_tool shape validation, toolSpecs↔handlers 1:1 parity, and
// that topological order respects declared dependencies.

import { describe, expect, it } from "vitest";
import {
  composeFeaturePackages,
  FeaturePackageError,
  type TinyYeahComposedRegistry,
  type TinyYeahFeaturePackage,
} from "../../src/core/composer/index.js";

function handler(): { ok: true } {
  return { ok: true };
}

function pkg(id: string, overrides: Partial<TinyYeahFeaturePackage> = {}): TinyYeahFeaturePackage {
  return {
    id,
    version: 1,
    title: id,
    category: "core-runtime",
    ...overrides,
  };
}

describe("composer — happy path", () => {
  it("composes a single-package registry and exposes deterministic, sorted keys", () => {
    const registry = composeFeaturePackages([
      pkg("tiny-yeah.alpha", {
        tools: [{ name: "tool_a", description: "A", handler }],
      }),
    ]);

    expect(registry.packageIds).toEqual(["tiny-yeah.alpha"]);
    expect(registry.toolSpecs.map((spec) => spec.name)).toEqual(["tool_a"]);
    expect(Object.keys(registry.tools)).toEqual(["tool_a"]);
    expect(registry.requiredToolNames).toEqual(["tool_a"]);
  });

  it("composes a 2-package registry preserving dependency order in packageIds", () => {
    const registry = composeFeaturePackages([
      pkg("tiny-yeah.app", {
        dependsOn: ["tiny-yeah.core"],
        tools: [{ name: "tool_app", description: "App", handler }],
      }),
      pkg("tiny-yeah.core", {
        tools: [{ name: "tool_core", description: "Core", handler }],
      }),
    ]);

    // core must come before app (dependency-respecting order)
    expect(registry.packageIds).toEqual(["tiny-yeah.core", "tiny-yeah.app"]);
  });
});

describe("composer — REQ-TY-011 four rejection codes", () => {
  it("rejects duplicate_package_id", () => {
    expect(() => composeFeaturePackages([pkg("dup"), pkg("dup")])).toThrowFeaturePackageError(
      "duplicate_package_id",
    );
  });

  it("rejects missing_dependency", () => {
    expect(() =>
      composeFeaturePackages([pkg("a", { dependsOn: ["ghost"] })]),
    ).toThrowFeaturePackageError("missing_dependency");
  });

  it("rejects dependency_cycle (a -> b -> a)", () => {
    expect(() =>
      composeFeaturePackages([pkg("a", { dependsOn: ["b"] }), pkg("b", { dependsOn: ["a"] })]),
    ).toThrowFeaturePackageError("dependency_cycle");
  });

  it("rejects duplicate_tool_name across packages", () => {
    expect(() =>
      composeFeaturePackages([
        pkg("p1", { tools: [{ name: "shared_tool", description: "T", handler }] }),
        pkg("p2", { tools: [{ name: "shared_tool", description: "T", handler }] }),
      ]),
    ).toThrowFeaturePackageError("duplicate_tool_name");
  });
});

describe("composer — shape validation", () => {
  it("rejects invalid_package (missing id)", () => {
    expect(() => composeFeaturePackages([pkg(" ")])).toThrowFeaturePackageError("invalid_package");
  });

  it("rejects invalid_tool (missing tool name)", () => {
    expect(() =>
      composeFeaturePackages([pkg("p", { tools: [{ name: " ", description: "T", handler }] })]),
    ).toThrowFeaturePackageError("invalid_tool");
  });
});

describe("composer — REQ-TY-011/012 parity (no parallel hand-edited arrays)", () => {
  it("guarantees toolSpecs and handlers are 1:1 (no orphan handler, no orphan spec)", () => {
    const registry: TinyYeahComposedRegistry = composeFeaturePackages([
      pkg("tiny-yeah.p1", {
        tools: [
          { name: "t1", description: "one", handler },
          { name: "t2", description: "two", handler },
        ],
      }),
      pkg("tiny-yeah.p2", {
        dependsOn: ["tiny-yeah.p1"],
        tools: [{ name: "t3", description: "three", handler }],
      }),
    ]);

    const specNames = registry.toolSpecs.map((spec) => spec.name).sort();
    const handlerNames = Object.keys(registry.tools).sort();
    expect(specNames).toEqual(handlerNames);
    expect(specNames).toEqual(["t1", "t2", "t3"]);
    expect(registry.requiredToolNames.sort()).toEqual(specNames);
  });

  it("topological order respects deps across the composed packageIds", () => {
    const registry = composeFeaturePackages([
      pkg("tiny-yeah.app", {
        dependsOn: ["tiny-yeah.mid"],
        tools: [{ name: "app_t", description: "x", handler }],
      }),
      pkg("tiny-yeah.mid", {
        dependsOn: ["tiny-yeah.base"],
        tools: [{ name: "mid_t", description: "x", handler }],
      }),
      pkg("tiny-yeah.base", {
        tools: [{ name: "base_t", description: "x", handler }],
      }),
    ]);

    const indexOf = (id: string): number => registry.packageIds.indexOf(id);
    expect(indexOf("tiny-yeah.base")).toBeLessThan(indexOf("tiny-yeah.mid"));
    expect(indexOf("tiny-yeah.mid")).toBeLessThan(indexOf("tiny-yeah.app"));
  });
});

// Custom matcher: FeaturePackageError with a specific code.
expect.extend({
  toThrowFeaturePackageError(
    received: () => unknown,
    expectedCode: string,
  ): { pass: boolean; message: () => string } {
    try {
      received();
      return {
        pass: false,
        message: () =>
          `Expected composeFeaturePackages to throw FeaturePackageError with code ${expectedCode}, but it did not throw.`,
      };
    } catch (error) {
      if (error instanceof FeaturePackageError && error.code === expectedCode) {
        return { pass: true, message: () => "threw expected FeaturePackageError" };
      }
      const got =
        error instanceof FeaturePackageError
          ? `FeaturePackageError(code=${error.code})`
          : `${(error as Error)?.constructor?.name ?? typeof error}`;
      return {
        pass: false,
        message: () =>
          `Expected FeaturePackageError(code=${expectedCode}), but got ${got}: ${(error as Error)?.message ?? ""}`,
      };
    }
  },
});

interface CustomMatchers<R = unknown> {
  toThrowFeaturePackageError(code: string): R;
}
declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion extends CustomMatchers {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}
