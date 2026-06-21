// UNIT: model-contract/intents (SPEC-TINY-YEAH-001 REQ-TY-001/003, plan.md §3.7 T3/T7/T8).
// The typed intent family the model emits. Strict zod: extra/unknown fields rejected.
// NO raw-path-as-string free field, NO lock/serialization keys (T7/T8: schema has no such keys).

import { describe, expect, it } from "vitest";
import { type Intent, intentSchema } from "../../../src/model-contract/intents.js";

function validManifest() {
  return {
    schemaVersion: "tiny-yeah.mutation-manifest.v1",
    actions: [{ kind: "create" as const, path: "src/a.ts", content: "a", sha256: "0".repeat(64) }],
  };
}

describe("intent family — discriminated union (REQ-TY-001/003)", () => {
  it("accepts a well-formed commitManifest intent", () => {
    const parsed = intentSchema.parse({
      type: "commitManifest",
      manifest: validManifest(),
    });
    expect(parsed.type).toBe("commitManifest");
  });

  it("accepts requestApproval / applyApproved / query / healthCheck intents", () => {
    expect(intentSchema.parse({ type: "requestApproval", previewId: "p1" }).type).toBe(
      "requestApproval",
    );
    expect(intentSchema.parse({ type: "applyApproved", previewId: "p1" }).type).toBe(
      "applyApproved",
    );
    expect(intentSchema.parse({ type: "query", query: { kind: "listPreviews" } }).type).toBe(
      "query",
    );
    expect(intentSchema.parse({ type: "healthCheck" }).type).toBe("healthCheck");
  });

  it("T3: rejects an unknown/extra field on a commitManifest intent (REQ-TY-003)", () => {
    expect(() =>
      intentSchema.parse({
        type: "commitManifest",
        manifest: validManifest(),
        extraUnknownField: "evil",
      }),
    ).toThrow();
  });

  it("T7: there is NO lock acquire/release intent key in the union (REQ-TY-003)", () => {
    expect(() =>
      intentSchema.parse({ type: "acquireLock", path: ".tiny-yeah/locks/x" } as unknown),
    ).toThrow();
    expect(() => intentSchema.parse({ type: "releaseLock", lockId: "abc" } as unknown)).toThrow();
  });

  it("T8: there is NO serialized-state / registry-dump intent (REQ-TY-001/003)", () => {
    expect(() =>
      intentSchema.parse({ type: "restoreState", serializedRegistry: "{}" } as unknown),
    ).toThrow();
  });

  it("rejects an entirely unknown intent type", () => {
    expect(() => intentSchema.parse({ type: "formatDisk" } as unknown)).toThrow();
  });

  it("manifest inside commitManifest still requires its schemaVersion (REQ-TY-029 echo)", () => {
    const { schemaVersion: _drop, ...rest } = validManifest();
    expect(() =>
      intentSchema.parse({ type: "commitManifest", manifest: rest } as unknown),
    ).toThrow();
  });

  it("Intent type is the inferred union (compile-time guard, no runtime effect)", () => {
    const sample = (i: Intent): string => i.type;
    expect(sample({ type: "healthCheck" })).toBe("healthCheck");
  });
});
