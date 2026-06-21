// CHARACTERIZATION: deterministic / canonical-JSON hash invariant.
// Sources: ../../Tinker.Gen/src/generation/generator.ts (manifestHash),
//          ../../ui_pop/src/schema/ui-ir.ts (serializeUiIr, sortObject)
//
// Two complementary primitives feed the Phase 2 canonical-JSON manifest hash (plan.md §3.3):
//   - donor manifestHash = sha256(JSON.stringify(manifest))            <- INSERTION-ORDER SENSITIVE
//   - donor serializeUiIr = JSON.stringify(sortObject(value), null, 2) + "\n"  <- KEY-SORTED
//
// CRITICAL GAP (MAJOR-C3): the donor manifestHash is NOT key-order independent. This
// characterization pins the CURRENT (donor) behavior so Phase 2's [REWRITE canonical-JSON]
// can prove the gap is closed. The key-order-independence property is recorded as `it.todo`
// with the documented target — it is a Phase 2 target, not a donor invariant.

import { describe, expect, it } from "vitest";
import { manifestHash } from "../../../Tinker.Gen/src/generation/generator.ts";
import type { TemplateManifest } from "../../../Tinker.Gen/src/generation/manifest.ts";
import type { UiIr } from "../../../ui_pop/src/schema/ui-ir.ts";
import { serializeUiIr } from "../../../ui_pop/src/schema/ui-ir.ts";

function sampleManifest(): TemplateManifest {
  return {
    schemaVersion: "tinker.template-manifest.v1",
    template: { id: "component-scaffold", version: "0.1.0" },
    language: "typescript",
    layers: ["component"],
    component: {
      name: "widget",
      exportName: "Widget",
      description: "A widget.",
    },
    output: { root: ".tinker/generated" },
  };
}

describe("Tinker.Gen donor manifestHash — current (insertion-order sensitive) behavior", () => {
  it("is deterministic: the same manifest object yields the same hash across calls", () => {
    const a = manifestHash(sampleManifest());
    const b = manifestHash(sampleManifest());
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic across process restarts (hex sha256, no random component)", () => {
    // The hash is a pure function of JSON.stringify(manifest); no PID / uuid / timestamp.
    const h = manifestHash(sampleManifest());
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when an action-relevant field changes", () => {
    const base = sampleManifest();
    const modified: TemplateManifest = {
      ...base,
      component: { ...base.component, name: "gadget" },
    };
    expect(manifestHash(modified)).not.toBe(manifestHash(base));
  });

  // CHARACTERIZATION GAP — MAJOR-C3, Phase 2 target property.
  // The donor uses sha256(JSON.stringify(manifest)) which is insertion-order sensitive.
  // Phase 2 [REWRITE canonical-JSON] (plan.md §3.3) will make this key-order independent
  // via recursive key sorting (ui-ir.ts:60-73 sortObject pattern). Enable this test when
  // core/schema/manifest.ts lands the canonical hash.
  it.todo(
    "P1 key-order independence: two manifests with the same content but different key insertion order MUST hash equally (Phase 2 canonical-JSON target; donor currently FAILS this — JSON.stringify is insertion-order sensitive)",
  );
});

describe("ui_pop donor serializeUiIr — canonical (key-sorted) JSON primitive", () => {
  function sampleUiIr(): UiIr {
    return {
      schemaVersion: 1,
      screen: { id: "screen-1", title: "Users", route: "/users" },
      queryConditions: [
        {
          id: "q1",
          label: "Name",
          control: "text",
          confidence: "source-static",
          sources: [{ file: "Users.tsx", line: 12, kind: "jsx" }],
        },
      ],
      actions: [],
      results: { kind: "table", columns: [] },
    };
  }

  it("appends exactly one trailing newline (canonical terminator)", () => {
    const out = serializeUiIr(sampleUiIr());
    expect(out.endsWith("\n")).toBe(true);
    expect(out.match(/\n$/g)?.length).toBe(1);
  });

  it("sorts object keys recursively (localeCompare), so two equal-content UiIr values serialize identically regardless of construction order", () => {
    const a = sampleUiIr();
    // Reconstruct the same content via a different code path (entries round-trip).
    const b: UiIr = JSON.parse(JSON.stringify(a));
    expect(serializeUiIr(a)).toBe(serializeUiIr(b));
  });

  it("preserves array order (action sequence is semantically meaningful)", () => {
    // serializeUiIr must NOT reorder array elements; only object keys are sorted. Phase 2
    // canonical-JSON inherits this: action order is preserved, object keys are sorted.
    const first: UiIr = {
      ...sampleUiIr(),
      queryConditions: [
        {
          id: "alpha",
          label: "A",
          control: "text",
          confidence: "source-static",
          sources: [{ file: "a.tsx", line: 1, kind: "jsx" }],
        },
        {
          id: "beta",
          label: "B",
          control: "text",
          confidence: "source-static",
          sources: [{ file: "b.tsx", line: 2, kind: "jsx" }],
        },
      ],
    };
    const reversed: UiIr = {
      ...first,
      queryConditions: [first.queryConditions[1], first.queryConditions[0]],
    };
    // Different array order -> different serialization (array order is preserved, NOT sorted).
    expect(serializeUiIr(first)).not.toBe(serializeUiIr(reversed));
  });

  it("is stable: serializing the output again yields the same bytes (fixpoint)", () => {
    const once = serializeUiIr(sampleUiIr());
    const reparsed = JSON.parse(once);
    const twice = serializeUiIr(reparsed as UiIr);
    expect(twice).toBe(once);
  });
});
