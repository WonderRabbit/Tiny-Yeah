// UNIT: feature-package ordering pipeline (SPEC-TINY-YEAH-001 REQ-TY-011 AC).
// Pins Kahn's topological sort correctness on a 4-package DAG, independent of the
// full composer surface. A 4-node DAG: core <- runtime <- ui <- app, plus an independent
// leaf `support` (no deps). Expected order: core, support, runtime, ui, app (ties broken
// by sorted id).

import { describe, expect, it } from "vitest";
import { validateAndOrderFeaturePackages } from "../../src/core/composer/order.js";
import type { TinyYeahFeaturePackage } from "../../src/core/composer/types.js";

function pkg(id: string, dependsOn: string[] = []): TinyYeahFeaturePackage {
  return {
    id,
    version: 1,
    title: id,
    category: "core-runtime",
    dependsOn,
  };
}

describe("order — Kahn topological sort on a 4-node DAG", () => {
  it("returns a dependency-respecting order for a 4-node chain + independent leaf", () => {
    const packages = [
      pkg("app", ["ui"]),
      pkg("ui", ["runtime"]),
      pkg("runtime", ["core"]),
      pkg("core"),
      pkg("support"),
    ];
    const { orderedIds } = validateAndOrderFeaturePackages(packages);

    // core before runtime, runtime before ui, ui before app
    const indexOf = (id: string): number => orderedIds.indexOf(id);
    expect(indexOf("core")).toBeLessThan(indexOf("runtime"));
    expect(indexOf("runtime")).toBeLessThan(indexOf("ui"));
    expect(indexOf("ui")).toBeLessThan(indexOf("app"));
    expect(orderedIds).toHaveLength(5);
  });

  it("breaks ties deterministically by sorted package id", () => {
    const packages = [pkg("zeta", ["alpha"]), pkg("alpha"), pkg("beta")];
    const { orderedIds } = validateAndOrderFeaturePackages(packages);
    // alpha and beta both ready first → sorted: alpha, beta; then zeta
    expect(orderedIds).toEqual(["alpha", "beta", "zeta"]);
  });
});
