// UNIT: Tiny-Yeah canonical-JSON manifest hash (SPEC-TINY-YEAH-001 §6.2, plan.md §3.3).
// This is the GREEN for the donor's known key-order gap (MAJOR-C3): the donor's manifestHash
// (Tinker.Gen) is insertion-order sensitive and FAILS P1; Tiny-Yeah's manifestHash is key-order
// independent and PASSES P1. (The donor characterization it.todo stays todo against the donor.)

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { MutationManifest } from "../../src/core/checkpoint/contracts.js";
import { canonicalStringify, manifestHash } from "../../src/core/checkpoint/hashing.js";

function sampleManifest(): MutationManifest {
  return {
    schemaVersion: "tiny-yeah.mutation-manifest.v1",
    actions: [
      {
        kind: "create",
        path: "src/widget.ts",
        content: "export const X = 1;\n",
        sha256: createHash("sha256").update("export const X = 1;\n", "utf8").digest("hex"),
      },
    ],
  };
}

describe("manifestHash — P1 key-order independence (closes donor MAJOR-C3 gap)", () => {
  it("two manifests with the same content but different key insertion order hash equally", () => {
    const a = sampleManifest();
    // Reconstruct the same content with a DIFFERENT key insertion order. JSON.stringify is
    // insertion-order sensitive, so a naive `sha256(JSON.stringify(x))` would differ. Our
    // canonical-JSON hash MUST collapse the difference.
    const b = {
      actions: [
        {
          sha256: a.actions[0].sha256,
          content: a.actions[0].content,
          path: a.actions[0].path,
          kind: "create" as const,
        },
      ],
      schemaVersion: a.schemaVersion,
    } satisfies MutationManifest;
    expect(manifestHash(a)).toBe(manifestHash(b));
    expect(manifestHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("manifestHash — P2 array-order sensitivity (action order is semantic)", () => {
  it("reordering actions changes the hash", () => {
    const base = {
      schemaVersion: "tiny-yeah.mutation-manifest.v1",
      actions: [
        { kind: "create" as const, path: "a.txt", content: "A", sha256: "0".repeat(64) },
        { kind: "create" as const, path: "b.txt", content: "B", sha256: "1".repeat(64) },
      ],
    };
    const reordered = {
      schemaVersion: base.schemaVersion,
      actions: [base.actions[1], base.actions[0]],
    };
    expect(manifestHash(base)).not.toBe(manifestHash(reordered));
  });
});

describe("manifestHash — P3 trailing-newline fixpoint", () => {
  it("canonicalStringify appends exactly one trailing newline", () => {
    const out = canonicalStringify({ a: 1 });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.match(/\n$/g)?.length).toBe(1);
  });

  it("serializing the parsed output again yields identical bytes (fixpoint)", () => {
    const once = canonicalStringify(sampleManifest());
    const reparsed = JSON.parse(once);
    const twice = canonicalStringify(reparsed);
    expect(twice).toBe(once);
  });
});

describe("manifestHash — P4 cross-call determinism + content sensitivity", () => {
  it("is deterministic across calls (pure function, no PID/uuid/timestamp)", () => {
    expect(manifestHash(sampleManifest())).toBe(manifestHash(sampleManifest()));
  });

  it("changes when an action-relevant field changes", () => {
    const base = sampleManifest();
    const modified: MutationManifest = {
      ...base,
      actions: [{ ...base.actions[0], path: "src/gadget.ts" }],
    };
    expect(manifestHash(modified)).not.toBe(manifestHash(base));
  });

  it("is stable under non-ASCII / UTF-8 content", () => {
    const a = {
      schemaVersion: "tiny-yeah.mutation-manifest.v1",
      actions: [
        {
          kind: "create" as const,
          path: "안녕.md",
          content: "한글 내용 🚀",
          sha256: "0".repeat(64),
        },
      ],
    };
    const b = JSON.parse(JSON.stringify(a));
    expect(manifestHash(a)).toBe(manifestHash(b));
  });
});
