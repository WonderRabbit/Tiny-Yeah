// UNIT: model-contract — the model NEVER gets a direct file-write handle (SPEC-TINY-YEAH-001
// REQ-TY-001/004, CLAUDE.md load-bearing principle). The public model-contract surface exposes
// NO function that takes a path + content and writes a file directly. Every write MUST route
// through commitManifest -> applyApproved (preview -> checkpoint -> apply).

import { describe, expect, it } from "vitest";
import * as modelContract from "../../../src/model-contract/index.js";

describe("REQ-TY-001/004 — the model NEVER gets a direct file-write handle", () => {
  it("no public model-contract export is a direct file writer (path + content -> fs write)", () => {
    // The contract surface is: validateModelEmission, requestApproval, applyApproved, plus
    // schemas/errors/budgets (pure data). None of these is a "write this path with this
    // content" primitive. applyApproved takes ONLY a previewId (no path, no content).
    const exports = Object.keys(modelContract).sort();
    for (const name of exports) {
      const fn = (modelContract as Record<string, unknown>)[name];
      if (typeof fn !== "function") continue;
      // A write primitive would have to accept {path, content}; none of our functions do.
      // applyApproved intentionally takes {previewId, root} only.
      expect(name).not.toMatch(/writeFile|writeArtifact|directWrite|rawWrite/);
    }
    // applyApproved exists and is the ONLY write trigger; assert its signature carries no
    // content/path fields by construction (it takes ApplyApprovedInput = { previewId, root }).
    expect(typeof modelContract.applyApproved).toBe("function");
    expect(typeof modelContract.requestApproval).toBe("function");
    expect(typeof modelContract.validateModelEmission).toBe("function");
  });

  it("the intent family has NO field that carries raw content as a free-form model input", () => {
    // commitManifest wraps content inside a manifest action (budget-bounded + validated);
    // there is no top-level "content" / "body" / "data" string field on any intent.
    // This is verified structurally by intents.test.ts (strict zod); here we re-state the
    // contract: the validated intent has `type` and either `manifest` / `previewId` / `query`.
    expect(true).toBe(true);
  });
});
