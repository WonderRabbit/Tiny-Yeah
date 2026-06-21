// UNIT: model-contract/errors (SPEC-TINY-YEAH-001 REQ-TY-003/027, plan.md §3.8 M3).
// Every error crossing the model boundary carries a stable `code` + actionable `recoveryHint`.

import { describe, expect, it } from "vitest";
import {
  isModelContractError,
  ModelContractError,
  type ModelContractErrorCode,
} from "../../../src/model-contract/errors.js";

describe("ModelContractError", () => {
  it("carries a stable code, message, and actionable recoveryHint", () => {
    const error = new ModelContractError({
      code: "MANIFEST_CONTENT_OVER_BUDGET",
      message: "action content is 5000 chars; input budget is 4000",
      recoveryHint:
        "Stage the content under .tiny-yeah/staging/ and reference it via sourcePointer.",
    });
    expect(error.code).toBe("MANIFEST_CONTENT_OVER_BUDGET");
    expect(error.message).toContain("5000");
    expect(error.recoveryHint).toContain("sourcePointer");
    expect(error.name).toBe("ModelContractError");
    expect(error).toBeInstanceOf(Error);
  });

  it("supports the full code set required by the boundary (REQ-TY-003/027/029)", () => {
    const codes: readonly ModelContractErrorCode[] = [
      "MANIFEST_CONTENT_OVER_BUDGET",
      "UNKNOWN_INTENT_FIELD",
      "PATH_ESCAPES_ROOT",
      "INVALID_ENCODING",
      "MISSING_SCHEMA_VERSION",
    ];
    for (const code of codes) {
      const error = new ModelContractError({ code, message: `msg:${code}` });
      expect(error.code).toBe(code);
    }
  });

  it("is distinguishable from YeahError via isModelContractError", () => {
    const error = new ModelContractError({ code: "PATH_ESCAPES_ROOT", message: "x" });
    expect(isModelContractError(error)).toBe(true);
    expect(isModelContractError(new Error("plain"))).toBe(false);
  });
});
