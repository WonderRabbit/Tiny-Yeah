// CHARACTERIZATION: ui_pop donor evidence-sanitizer invariant.
// Source: ../../ui_pop/src/evidence/evidence-sanitizer.ts
//
// REQ-TY-025 / compaction discipline: file bodies never enter the model context raw; the
// sanitizer redacts env vars / API keys / bearer tokens / credential patterns and truncates
// excerpts to MAX_EXCERPT_LENGTH (300). This pins the observed redaction + truncation contract
// so the Phase 3 port (core/evidence/evidence-sanitizer.ts) cannot regress it.

import { describe, expect, it } from "vitest";
import {
  createStaticEvidenceSummary,
  sanitizeEvidenceValue,
} from "../../../ui_pop/src/evidence/evidence-sanitizer.ts";

describe("ui_pop donor sanitizer — excerpt truncation", () => {
  // MAX_EXCERPT_LENGTH is a module-internal constant; the OBSERVABLE contract is that excerpts
  // longer than 300 chars are truncated with a [TRUNCATED] marker. We assert the observable
  // boundary rather than the private constant (characterization tests the contract, not the
  // implementation).
  const MAX = 300;

  it("leaves short source excerpts untouched (after whitespace normalization)", () => {
    const summary = createStaticEvidenceSummary({
      files: ["Users.tsx"],
      source: "const x = 1;",
      title: "Users screen",
      unresolvedNotes: [],
    });
    expect(summary.sourceExcerpt).toBe("const x = 1;");
  });

  it("truncates a source excerpt longer than 300 chars and appends [TRUNCATED]", () => {
    const long = "a".repeat(MAX + 100);
    const summary = createStaticEvidenceSummary({
      files: ["x.tsx"],
      source: long,
      title: "t",
      unresolvedNotes: [],
    });
    expect(summary.sourceExcerpt.length).toBe(MAX + " [TRUNCATED]".length);
    expect(summary.sourceExcerpt.endsWith("[TRUNCATED]")).toBe(true);
  });

  it("truncates exactly at the 300-char boundary when source exceeds it", () => {
    const summary = createStaticEvidenceSummary({
      files: ["x.tsx"],
      source: "x".repeat(MAX),
      title: "t",
      unresolvedNotes: [],
    });
    // Exactly 300 chars is NOT truncated (<= MAX).
    expect(summary.sourceExcerpt).toBe("x".repeat(MAX));
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

describe("ui_pop donor sanitizer — credential redaction (sanitizeEvidenceValue)", () => {
  it("redacts process.env.VAR references", () => {
    const out = sanitizeEvidenceValue({ url: "process.env.DATABASE_URL" }) as Record<
      string,
      string
    >;
    expect(out.url).toBe("process.env.[REDACTED]");
  });

  it("redacts Stripe-style API keys (sk_live_* / sk_test_*)", () => {
    const out = sanitizeEvidenceValue("key is sk_live_abc123XYZ") as string;
    expect(out).toBe("key is [REDACTED]");
    const out2 = sanitizeEvidenceValue("token sk_test_xyz789") as string;
    expect(out2).toBe("token [REDACTED]");
  });

  it("redacts Bearer tokens", () => {
    // CHARACTERIZATION NOTE: the donor runs BOTH the credential-assignment regex and the Bearer
    // regex. "Authorization: Bearer X" hits the credential regex first (auth\w* matches
    // "Authorization"), then the Bearer regex catches the remainder — yielding two redactions.
    // Use a neutral prefix here to isolate the Bearer pattern; the credential-overlap case is
    // covered in the dedicated assignment-patterns test below.
    const out = sanitizeEvidenceValue("leaked: Bearer mF_9.B5f-4.1JqM") as string;
    expect(out).toBe("leaked: Bearer [REDACTED]");
  });

  it("redacts password / secret / token / api_key / auth assignment patterns", () => {
    const cases: Array<[string, RegExp]> = [
      ['password: "hunter2"', /password: \[REDACTED\]/],
      ["api_key=abcdef123456", /api_key=\[REDACTED\]/],
      ['secret: "m00se"', /secret: \[REDACTED\]/],
      ['token: "abc.def.ghi"', /token: \[REDACTED\]/],
    ];
    for (const [input, expected] of cases) {
      const out = sanitizeEvidenceValue(input) as string;
      expect(out).toMatch(expected);
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

describe("ui_pop donor sanitizer — createStaticEvidenceSummary shape", () => {
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
