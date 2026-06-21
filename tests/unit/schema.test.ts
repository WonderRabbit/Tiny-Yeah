// UNIT: Tiny-Yeah merged zod registry (SPEC-TINY-YEAH-001 plan.md §4 Phase 2, REQ-TY-011).
// Pins that core/schema is the SINGLE schema entry point: it re-exports checkpoint
// contracts, ports ui_pop's UI-IR verbatim, and defines the base Intent discriminated
// union (commitManifest shape; more intents land in Phase 4).

import { describe, expect, it } from "vitest";
import {
  checkpointSchema,
  commitManifestIntentSchema,
  composedToolSpecSchema,
  type Intent,
  intentSchema,
  mutationManifestSchema,
  parseUiIr,
  previewSchema,
  type UiIr,
  uiIrSchema,
} from "../../src/core/schema/index.js";

describe("schema registry — single entry point re-exports checkpoint contracts", () => {
  it("re-exports mutationManifestSchema and it still validates", () => {
    expect(
      mutationManifestSchema.safeParse({
        schemaVersion: "tiny-yeah.mutation-manifest.v1",
        actions: [{ kind: "create", path: "a.txt", content: "x", sha256: "0".repeat(64) }],
      }).success,
    ).toBe(true);
  });

  it("re-exports previewSchema and checkpointSchema", () => {
    expect(previewSchema).toBeDefined();
    expect(checkpointSchema).toBeDefined();
  });
});

describe("schema registry — ui-ir (ported verbatim from ui_pop)", () => {
  const validIr: UiIr = {
    schemaVersion: 1,
    screen: { id: "s1", title: "Search", route: "/search" },
    queryConditions: [
      {
        id: "q",
        label: "Query",
        control: "text",
        confidence: "source-static",
        sources: [{ file: "Page.tsx", line: 12, kind: "jsx" }],
      },
    ],
    actions: [],
    results: { kind: "empty", columns: [] },
  };

  it("round-trips a well-formed UI-IR", () => {
    const result = parseUiIr(validIr);
    expect(result.success).toBe(true);
  });

  it("rejects a UI-IR missing schemaVersion", () => {
    const bad = { ...validIr } as Record<string, unknown>;
    delete bad.schemaVersion;
    expect(uiIrSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a field with no sources (min 1)", () => {
    const bad: UiIr = {
      ...validIr,
      queryConditions: [
        {
          id: "q",
          label: "Query",
          control: "text",
          confidence: "source-static",
          sources: [],
        },
      ],
    };
    expect(uiIrSchema.safeParse(bad).success).toBe(false);
  });
});

describe("schema registry — Intent discriminated union (base, commitManifest)", () => {
  it("accepts a commitManifest intent carrying a valid manifest", () => {
    const intent: Intent = {
      type: "commitManifest",
      manifest: {
        schemaVersion: "tiny-yeah.mutation-manifest.v1",
        actions: [{ kind: "create", path: "a.txt", content: "x", sha256: "0".repeat(64) }],
      },
    };
    expect(intentSchema.safeParse(intent).success).toBe(true);
    expect(commitManifestIntentSchema.safeParse(intent).success).toBe(true);
  });

  it("rejects an intent with an unknown type discriminator", () => {
    expect(intentSchema.safeParse({ type: "bogus", manifest: {} }).success).toBe(false);
  });

  it("rejects a commitManifest intent whose manifest is malformed", () => {
    expect(
      intentSchema.safeParse({ type: "commitManifest", manifest: { actions: [] } }).success,
    ).toBe(false);
  });
});

describe("schema registry — ComposedToolSpecSchema", () => {
  it("accepts a well-formed composed tool spec", () => {
    expect(
      composedToolSpecSchema.safeParse({
        name: "health_check",
        description: "Returns kernel health",
        packageId: "tiny-yeah.core-runtime",
        packageTitle: "Core Runtime",
      }).success,
    ).toBe(true);
  });

  it("requires name, description, packageId, packageTitle", () => {
    expect(composedToolSpecSchema.safeParse({ name: "x" }).success).toBe(false);
  });
});
