// UNIT: naming-check engine (SPEC-TINY-YEAH-001 REQ-TY-023, plan.md Phase 5).
//
// The naming-check gate validates tool/package IDs against docs/naming/dictionary.json. It is a
// regex/rule engine (NOT the donor's full TS-AST extractor) appropriate for Tiny-Yeah's minimal
// dependency stance. REQ-TY-023 acceptance:
//   - npm run naming:check reports tool/package ID violations.
//   - naming-check does NOT conflict with the Yeah* prefix rename strategy.
//   - the dictionary lives at docs/naming/dictionary.json.
//   - (F7) the dictionary registers `tiny_yeah_install_check`, and naming-check accepts it.

import { describe, expect, it } from "vitest";
import { checkNaming } from "../../scripts/naming-check.mjs";

const VALID_DICT = {
  schemaVersion: 1,
  entries: [
    {
      id: "tool.tiny_yeah_install_check",
      name: "tiny_yeah_install_check",
      normalized: "tiny_yeah_install_check",
      kind: "tool",
      namespace: "opencode",
      casing: "snake_case",
      tokens: ["tiny", "yeah", "install", "check"],
      status: "active",
      collisionGroup: "tiny-yeah-tools",
      aliases: [],
      blockedVariants: [],
      sourceRefs: ["src/head/opencode/plugin.ts:tiny_yeah_install_check"],
      meaning: "Parity diagnostic (REQ-TY-020). Reserved tool name.",
    },
  ],
};

describe("checkNaming — REQ-TY-023 rule engine", () => {
  it("passes when the reserved diagnostic is registered AND present in src symbols", () => {
    const result = checkNaming({
      dictionary: VALID_DICT,
      symbols: [
        {
          name: "tiny_yeah_install_check",
          kind: "tool",
          sourceRefs: ["src/head/opencode/plugin.ts"],
        },
      ],
    });
    expect(result.status).toBe("pass");
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("FAILS (F7) when the reserved diagnostic tiny_yeah_install_check is NOT in the dictionary", () => {
    const result = checkNaming({
      dictionary: { schemaVersion: 1, entries: [] },
      symbols: [{ name: "tiny_yeah_install_check", kind: "tool", sourceRefs: ["src/x.ts"] }],
    });
    expect(result.status).toBe("fail");
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).toContain("reserved_diagnostic_unregistered");
  });

  it("FAILS when a tool id uses the legacy tiny_chu_ prefix (REQ-TY-024 adjacent)", () => {
    const result = checkNaming({
      dictionary: VALID_DICT,
      symbols: [{ name: "tiny_chu_install_check", kind: "tool", sourceRefs: ["src/x.ts"] }],
    });
    expect(result.status).toBe("fail");
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).toContain("legacy_tool_prefix");
  });

  it("reports a tool id that is not valid snake_case", () => {
    const result = checkNaming({
      dictionary: VALID_DICT,
      symbols: [{ name: "TinyYeah-InstallCheck", kind: "tool", sourceRefs: ["src/x.ts"] }],
    });
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).toContain("invalid_tool_casing");
  });

  it("does NOT flag the Yeah* prefix rename strategy as a violation", () => {
    const result = checkNaming({
      dictionary: VALID_DICT,
      symbols: [
        {
          name: "tiny_yeah_install_check",
          kind: "tool",
          sourceRefs: ["src/head/opencode/plugin.ts"],
        },
        {
          name: "createTinyYeahPlugin",
          kind: "function",
          sourceRefs: ["src/head/opencode/plugin.ts"],
          exported: true,
        },
        {
          name: "TinyYeahOpenCodePlugin",
          kind: "constant",
          sourceRefs: ["src/head/opencode/plugin.ts"],
          exported: true,
        },
      ],
    });
    // Yeah* / Yeah* PascalCase/camelCase exports are the intended rename strategy — not violations.
    const yeahFlags = result.diagnostics.filter(
      (d) => /yeah/i.test(d.message) && d.code !== "reserved_diagnostic_absent",
    );
    expect(yeahFlags.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.status).toBe("pass");
  });

  it("rejects a malformed dictionary (missing schemaVersion) as a failure", () => {
    const result = checkNaming({
      dictionary: { entries: [] },
      symbols: [],
    });
    expect(result.status).toBe("fail");
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).toContain("malformed_dictionary");
  });
});
