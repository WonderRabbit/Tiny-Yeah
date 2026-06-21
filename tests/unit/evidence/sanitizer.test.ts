// UNIT: Tiny-Yeah evidence sanitizer port (SPEC-TINY-YEAH-001 plan.md §4 Phase 3, REQ-TY-015 prep).
// Parity with the ui_pop donor characterization contract (see ../characterization/ui-pop-sanitizer.test.ts),
// but asserted against Tiny-Yeah's OWN port at src/core/evidence/sanitizer.ts. All model-facing
// evidence MUST pass through this (compaction discipline — file bodies never enter model context raw).

import { describe, expect, it } from "vitest";
import {
  createStaticEvidenceSummary,
  sanitizeEvidenceValue,
} from "../../../src/core/evidence/sanitizer.js";

const MAX_EXCERPT = 300;

describe("sanitizer — excerpt truncation", () => {
  it("leaves short source excerpts untouched after whitespace normalization", () => {
    const summary = createStaticEvidenceSummary({
      files: ["Users.tsx"],
      source: "const x = 1;",
      title: "Users screen",
      unresolvedNotes: [],
    });
    expect(summary.sourceExcerpt).toBe("const x = 1;");
  });

  it("truncates excerpts longer than 300 chars and appends [TRUNCATED]", () => {
    const long = "a".repeat(MAX_EXCERPT + 100);
    const summary = createStaticEvidenceSummary({
      files: ["x.tsx"],
      source: long,
      title: "t",
      unresolvedNotes: [],
    });
    expect(summary.sourceExcerpt.length).toBe(MAX_EXCERPT + " [TRUNCATED]".length);
    expect(summary.sourceExcerpt.endsWith("[TRUNCATED]")).toBe(true);
  });

  it("does NOT truncate exactly at the 300-char boundary", () => {
    const summary = createStaticEvidenceSummary({
      files: ["x.tsx"],
      source: "x".repeat(MAX_EXCERPT),
      title: "t",
      unresolvedNotes: [],
    });
    expect(summary.sourceExcerpt).toBe("x".repeat(MAX_EXCERPT));
  });

  it("collapses internal whitespace before measuring", () => {
    const summary = createStaticEvidenceSummary({
      files: ["x.tsx"],
      source: "a\n   b\t\tc",
      title: "t",
      unresolvedNotes: [],
    });
    expect(summary.sourceExcerpt).toBe("a b c");
  });
});

describe("sanitizer — credential redaction (sanitizeEvidenceValue)", () => {
  it("redacts process.env.VAR references", () => {
    const out = sanitizeEvidenceValue({ url: "process.env.DATABASE_URL" }) as Record<
      string,
      string
    >;
    expect(out.url).toBe("process.env.[REDACTED]");
  });

  it("redacts Stripe-style API keys (sk_live_* / sk_test_*)", () => {
    expect(sanitizeEvidenceValue("key is sk_live_abc123XYZ")).toBe("key is [REDACTED]");
    expect(sanitizeEvidenceValue("token sk_test_xyz789")).toBe("token [REDACTED]");
  });

  it("redacts Bearer tokens", () => {
    expect(sanitizeEvidenceValue("leaked: Bearer mF_9.B5f-4.1JqM")).toBe(
      "leaked: Bearer [REDACTED]",
    );
  });

  it("redacts password / secret / token / api_key assignment patterns", () => {
    const cases: Array<[string, RegExp]> = [
      ['password: "hunter2"', /password: \[REDACTED\]/],
      ["api_key=abcdef123456", /api_key=\[REDACTED\]/],
      ['secret: "m00se"', /secret: \[REDACTED\]/],
      ['token: "abc.def.ghi"', /token: \[REDACTED\]/],
    ];
    for (const [input, expected] of cases) {
      expect(sanitizeEvidenceValue(input)).toMatch(expected);
    }
  });

  it("recurses into nested objects and arrays", () => {
    const out = sanitizeEvidenceValue({
      outer: { token: "token: secretValue" },
      list: ["Bearer abc.def.ghi"],
    }) as { outer: { token: string }; list: string[] };
    expect(out.outer.token).toMatch(/token: \[REDACTED\]/);
    expect(out.list[0]).toBe("Bearer [REDACTED]");
  });

  it("passes through non-string primitives untouched", () => {
    expect(sanitizeEvidenceValue(42)).toBe(42);
    expect(sanitizeEvidenceValue(null)).toBeNull();
    expect(sanitizeEvidenceValue(true)).toBe(true);
  });
});

describe("sanitizer — createStaticEvidenceSummary shape", () => {
  it("reports fileCount and sanitizes file paths / notes", () => {
    const summary = createStaticEvidenceSummary({
      files: ["a.tsx", "b.tsx"],
      source: "x",
      title: "Screen",
      unresolvedNotes: ["note with Bearer leak.xyz"],
    });
    expect(summary.fileCount).toBe(2);
    expect(summary.files).toEqual(["a.tsx", "b.tsx"]);
    expect(summary.unresolvedNotes[0]).toBe("note with Bearer [REDACTED]");
  });
});
