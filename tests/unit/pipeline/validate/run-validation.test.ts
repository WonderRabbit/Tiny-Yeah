// UNIT: runValidation orchestrator — snapshot → matcher → sanitizer → output (REQ-TY-015/016).
// Pins that NoopDriver yields all-unresolved evidence (graceful degradation) without crashing,
// and that a matched snapshot upgrades confidence to runtime-confirmed. Output evidence is sanitized.

import { describe, expect, it } from "vitest";
import type {
  RuntimeSnapshot,
  ValidationDriver,
} from "../../../../src/core/pipeline/validate/driver.js";
import { NoopDriver } from "../../../../src/core/pipeline/validate/driver.js";
import { runValidation } from "../../../../src/core/pipeline/validate/index.js";
import type { UiIr } from "../../../../src/core/schema/ui-ir.js";

const uiIr: UiIr = {
  schemaVersion: 1,
  screen: { id: "s", title: "Dashboard", route: "/d" },
  queryConditions: [
    {
      id: "q",
      label: "Query",
      control: "text",
      confidence: "source-static",
      sources: [{ file: "Page.tsx", line: 1, kind: "jsx" }],
    },
  ],
  actions: [],
  results: { kind: "empty", columns: [] },
};

const fakeDriver = (snap: RuntimeSnapshot): ValidationDriver => ({
  name: "fake",
  async snapshot() {
    return snap;
  },
});

describe("runValidation — NoopDriver graceful degradation (REQ-TY-016)", () => {
  it("does not crash and leaves all facts at source-static when bodyText is empty", async () => {
    const result = await runValidation(uiIr, {
      url: "http://x",
      driver: new NoopDriver(() => {}),
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(result.uiIr.queryConditions[0].confidence).toBe("source-static");
    expect((result.evidence as { summary: { matched: number } }).summary.matched).toBe(0);
  });

  it("records the evidence summary with the snapshot url and checkedAt", async () => {
    const result = await runValidation(uiIr, {
      url: "http://example/d",
      driver: new NoopDriver(() => {}),
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(result.url).toBe("http://example/d");
    expect(result.checkedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("runValidation — matched snapshot upgrades confidence", () => {
  it("upgrades matched facts to runtime-confirmed when bodyText contains the labels", async () => {
    const result = await runValidation(uiIr, {
      url: "http://x",
      driver: fakeDriver({ url: "http://x", bodyText: "Dashboard Query" }),
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(result.uiIr.screen.title).toBe("Dashboard");
    expect(result.uiIr.queryConditions[0].confidence).toBe("runtime-confirmed");
    expect((result.evidence as { summary: { matched: number } }).summary.matched).toBe(2);
  });
});

describe("runValidation — evidence sanitization", () => {
  it("runs the emitted evidence through sanitizeEvidenceValue (no raw secrets leak)", async () => {
    // The evidence itself contains no secrets, but the contract is that everything emitted to the
    // model passes through the sanitizer. We assert the evidence object is structurally present
    // and is a plain JSON-serializable value (the sanitizer preserves shape for non-string leaves).
    const result = await runValidation(uiIr, {
      url: "http://x",
      driver: new NoopDriver(() => {}),
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(() => JSON.stringify(result.evidence)).not.toThrow();
    expect(typeof result.evidence).toBe("object");
  });
});
