// Tiny-Yeah feature-package ordering pipeline (SPEC-TINY-YEAH-001 REQ-TY-011).
// Ported from Tiny-Chu `feature-package-order.ts`: shape validation -> duplicate-id
// detection -> dependency resolution -> Kahn's topological sort with cycle detection ->
// (tool-name uniqueness is enforced in composer.ts after ordering). Throws typed
// FeaturePackageError with the four canonical codes.

import { FeaturePackageError } from "./errors.js";
import type { TinyYeahFeaturePackage } from "./types.js";

export interface OrderedPackages {
  readonly byId: ReadonlyMap<string, TinyYeahFeaturePackage>;
  readonly orderedIds: readonly string[];
}

export function validateAndOrderFeaturePackages(
  featurePackages: readonly TinyYeahFeaturePackage[],
): OrderedPackages {
  const byId = new Map<string, TinyYeahFeaturePackage>();
  for (const featurePackage of featurePackages) {
    validatePackageShape(featurePackage);
    if (byId.has(featurePackage.id)) {
      throw new FeaturePackageError(
        "duplicate_package_id",
        `Duplicate feature package id: ${featurePackage.id}`,
        { id: featurePackage.id },
      );
    }
    byId.set(featurePackage.id, featurePackage);
  }

  for (const featurePackage of featurePackages) {
    for (const dependency of featurePackage.dependsOn ?? []) {
      if (!byId.has(dependency)) {
        throw new FeaturePackageError(
          "missing_dependency",
          `Feature package ${featurePackage.id} depends on missing package ${dependency}`,
          { id: featurePackage.id, dependency },
        );
      }
    }
  }

  return { byId, orderedIds: topologicalOrder(byId) };
}

function validatePackageShape(featurePackage: TinyYeahFeaturePackage): void {
  if (!featurePackage.id.trim() || !featurePackage.title.trim() || featurePackage.version !== 1) {
    throw new FeaturePackageError(
      "invalid_package",
      `Invalid feature package: ${featurePackage.id || "<missing id>"}`,
      { id: featurePackage.id, version: featurePackage.version },
    );
  }
  for (const tool of featurePackage.tools ?? []) {
    if (!tool.name.trim() || !tool.description.trim()) {
      throw new FeaturePackageError(
        "invalid_tool",
        `Invalid tool descriptor in package ${featurePackage.id}`,
        { id: featurePackage.id, toolName: tool.name },
      );
    }
  }
}

function topologicalOrder(byId: ReadonlyMap<string, TinyYeahFeaturePackage>): readonly string[] {
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const id of byId.keys()) {
    indegree.set(id, 0);
    dependents.set(id, []);
  }
  for (const [id, featurePackage] of byId.entries()) {
    for (const dependency of featurePackage.dependsOn ?? []) {
      indegree.set(id, (indegree.get(id) ?? 0) + 1);
      dependents.get(dependency)?.push(id);
    }
  }

  const ready = [...indegree.entries()]
    .filter(([, count]) => count === 0)
    .map(([id]) => id)
    .sort();
  const ordered: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift();
    if (!id) break;
    ordered.push(id);
    for (const dependent of [...(dependents.get(id) ?? [])].sort()) {
      const nextCount = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, nextCount);
      if (nextCount === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }

  if (ordered.length !== byId.size) {
    const cycleIds = [...indegree.entries()]
      .filter(([, count]) => count > 0)
      .map(([id]) => id)
      .sort();
    throw new FeaturePackageError(
      "dependency_cycle",
      `Feature package dependency cycle detected: ${cycleIds.join(", ")}`,
      { cycleIds },
    );
  }
  return ordered;
}
