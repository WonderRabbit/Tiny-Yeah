// Tiny-Yeah planMutation — pure helper turning an intent + inventory into a MutationManifest
// skeleton (plan.md §3.4 content-staging, Phase 3). The skeleton carries paths + sourcePointers
// but NO inline content beyond budget; the head (Phase 4) stages the actual content under
// `.tiny-yeah/staging/<sha256>` and the pointer dereferences it at apply time.
//
// For Phase 3, the pointer is a deterministic PLACEHOLDER derived from the target path: the head
// replaces it with the real content sha256 when it stages content. This keeps the skeleton stable
// (deterministic) without requiring the model to emit content during planning.

import { createHash } from "node:crypto";
import type { MutationManifest } from "../checkpoint/contracts.js";
import type { Inventory } from "./analyze.js";

export type PlanIntent = {
  /** Target artifact paths the manifest should create (relative, POSIX-style). */
  readonly targets: readonly string[];
};

const SKELETON_MARKER = "tiny-yeah:skeleton:";

/**
 * Build a MutationManifest skeleton from an intent + inventory. Pure + deterministic.
 * Throws if `intent.targets` is empty (a manifest requires at least one action).
 */
export function planMutation(_inventory: Inventory, intent: PlanIntent): MutationManifest {
  if (intent.targets.length === 0) {
    throw new Error("planMutation requires at least one target path");
  }

  const actions = intent.targets.map((target) => {
    const pointer = sha256(`${SKELETON_MARKER}${target}`);
    return {
      kind: "create" as const,
      path: target,
      sha256: pointer,
      sourcePointer: pointer,
    };
  });

  return {
    schemaVersion: "tiny-yeah.mutation-manifest.v1",
    actions,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
