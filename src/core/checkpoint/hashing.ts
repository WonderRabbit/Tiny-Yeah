// Tiny-Yeah canonical-JSON manifest hash (SPEC-TINY-YEAH-001 §6.2, plan.md §3.3).
//
// This is the deterministic core of the Phase 2 canonical-JSON rewrite, implemented NOW so
// preview/checkpoint identity is key-order independent from day one. The donor's manifestHash
// (Tinker.Gen `src/generation/generator.ts`) used `sha256(JSON.stringify(manifest))`, which is
// insertion-order sensitive — a known gap (MAJOR-C3). This module closes that gap for Tiny-Yeah's
// own hash:
//
// Canonicalization rules (plan.md §3.3):
//   1. UTF-8 encoded.
//   2. Object keys sorted recursively (ascending string compare). Array order PRESERVED —
//      action sequence is semantically meaningful (apply order).
//   3. No indentation (`JSON.stringify(sorted, null, 0)`).
//   4. Exactly one trailing newline.
//   5. sha256.
//
// Property guarantees (pinned by hashing.test.ts):
//   P1 key-order independence — two manifests equal in content but different key insertion order
//      hash equally. (The donor's it.todo for this property stays todo against the DONOR hash;
//      this module makes it GREEN for Tiny-Yeah's hash.)
//   P2 array-order sensitivity — reordering actions changes the hash.
//   P3 trailing-newline fixpoint.
//   P4 cross-call determinism (pure function of content; no PID/uuid/timestamp).

import { createHash } from "node:crypto";

type JsonMap = { [key: string]: JsonValue };
type JsonValue = string | number | boolean | null | JsonValue[] | JsonMap;

function isJsonMap(value: JsonValue): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortObject(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (isJsonMap(value)) {
    const entries = Object.entries(value);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: JsonMap = {};
    for (const [key, val] of entries) {
      out[key] = sortObject(val);
    }
    return out;
  }
  return value;
}

export function canonicalStringify(value: unknown): string {
  return `${JSON.stringify(sortObject(value as JsonValue))}\n`;
}

export function manifestHash(manifest: unknown): string {
  return createHash("sha256").update(canonicalStringify(manifest), "utf8").digest("hex");
}
