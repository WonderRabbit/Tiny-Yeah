// UNIT: Tiny-Yeah checkpoint contracts (SPEC-TINY-YEAH-001 §6.2, plan.md §3.1/§3.4).
// Pins the zod schemas: MutationManifest (model-emitted artifact), Preview, Checkpoint, and the
// content XOR sourcePointer refinement (content-staging, REQ-TY-027).

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_SCHEMA_VERSION,
  checkpointSchema,
  MUTATION_MANIFEST_SCHEMA_VERSION,
  mutationManifestSchema,
  PREVIEW_SCHEMA_VERSION,
  previewSchema,
} from "../../src/core/checkpoint/contracts.js";

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

describe("contracts — schemaVersion literals", () => {
  it("exposes the three canonical schemaVersion constants", () => {
    expect(MUTATION_MANIFEST_SCHEMA_VERSION).toBe("tiny-yeah.mutation-manifest.v1");
    expect(PREVIEW_SCHEMA_VERSION).toBe("tiny-yeah.preview.v1");
    expect(CHECKPOINT_SCHEMA_VERSION).toBe("tiny-yeah.checkpoint.v1");
  });
});

describe("contracts — mutationManifestSchema (REQ-TY-027 content XOR sourcePointer)", () => {
  it("accepts a manifest with inline content", () => {
    const manifest = {
      schemaVersion: MUTATION_MANIFEST_SCHEMA_VERSION,
      actions: [{ kind: "create", path: "a.txt", content: "hello", sha256: sha256("hello") }],
    };
    expect(mutationManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it("accepts a manifest with sourcePointer (content-staging, no inline body)", () => {
    const manifest = {
      schemaVersion: MUTATION_MANIFEST_SCHEMA_VERSION,
      actions: [
        {
          kind: "create",
          path: "big.html",
          sha256: "0".repeat(64),
          sourcePointer: ".tiny-yeah/staging/abc",
        },
      ],
    };
    expect(mutationManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it("rejects an action with NEITHER content nor sourcePointer", () => {
    const manifest = {
      schemaVersion: MUTATION_MANIFEST_SCHEMA_VERSION,
      actions: [{ kind: "create", path: "a.txt", sha256: "0".repeat(64) }],
    };
    expect(mutationManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it("rejects an action with BOTH content and sourcePointer", () => {
    const manifest = {
      schemaVersion: MUTATION_MANIFEST_SCHEMA_VERSION,
      actions: [
        {
          kind: "create",
          path: "a.txt",
          content: "hello",
          sha256: sha256("hello"),
          sourcePointer: ".tiny-yeah/staging/abc",
        },
      ],
    };
    expect(mutationManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it("rejects an empty actions array (min 1)", () => {
    const manifest = { schemaVersion: MUTATION_MANIFEST_SCHEMA_VERSION, actions: [] };
    expect(mutationManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it("rejects unknown extra fields (strict)", () => {
    const manifest = {
      schemaVersion: MUTATION_MANIFEST_SCHEMA_VERSION,
      actions: [
        { kind: "create", path: "a.txt", content: "hello", sha256: sha256("hello"), extra: 1 },
      ],
    };
    expect(mutationManifestSchema.safeParse(manifest).success).toBe(false);
  });
});

describe("contracts — preview / checkpoint schemas", () => {
  it("accepts a well-formed preview + checkpoint pair", () => {
    const preview = {
      schemaVersion: PREVIEW_SCHEMA_VERSION,
      previewId: "preview-deadbeefdead",
      manifestHash: "0".repeat(64),
      actions: [{ kind: "create", path: "a.txt", content: "x", sha256: sha256("x") }],
    };
    const checkpoint = {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      previewId: "preview-deadbeefdead",
      manifestHash: "0".repeat(64),
      actionHashes: [{ path: "a.txt", sha256: sha256("x") }],
    };
    expect(previewSchema.safeParse(preview).success).toBe(true);
    expect(checkpointSchema.safeParse(checkpoint).success).toBe(true);
  });

  it("rejects a checkpoint whose schemaVersion is wrong", () => {
    const checkpoint = {
      schemaVersion: "tiny-yeah.checkpoint.v999",
      previewId: "preview-deadbeefdead",
      manifestHash: "0".repeat(64),
      actionHashes: [],
    };
    expect(checkpointSchema.safeParse(checkpoint).success).toBe(false);
  });
});
