// UNIT: Tiny-Yeah runtime-matcher port (SPEC-TINY-YEAH-001 plan.md §4 Phase 3, REQ-TY-015).
// Ported from ui_pop `runtime-evidence.ts` but DECOUPLED from Playwright: it consumes a plain
// RuntimeSnapshot {url, bodyText} produced by any ValidationDriver (Playwright impl is one such
// driver behind core/pipeline/validate/). REQ-TY-015 AC: runtime-matcher consumes the
// ValidationDriver interface — it does NOT redefine the snapshot shape itself; the RuntimeSnapshot
// type is imported from core/pipeline/validate/driver.ts (single definition point).

import { describe, expect, it } from "vitest";
import {
  confirmMatchedFacts,
  createRuntimeEvidence,
} from "../../../src/core/evidence/runtime-matcher.js";
import type { RuntimeSnapshot } from "../../../src/core/pipeline/validate/driver.js";
import type { UiIr } from "../../../src/core/schema/ui-ir.js";

const baseUiIr: UiIr = {
  schemaVersion: 1,
  screen: { id: "users", title: "Users", route: "/users" },
  queryConditions: [
    {
      id: "q",
      label: "Query",
      control: "text",
      confidence: "source-static",
      sources: [{ file: "Page.tsx", line: 10, kind: "jsx" }],
    },
  ],
  actions: [
    {
      id: "search",
      label: "Search",
      role: "submit",
      confidence: "source-static",
      sources: [{ file: "Page.tsx", line: 20, kind: "jsx" }],
    },
  ],
  results: {
    kind: "table",
    columns: [
      {
        id: "name",
        label: "Name",
        confidence: "source-static",
        sources: [{ file: "Page.tsx", line: 30, kind: "jsx" }],
      },
    ],
  },
};

const snapshot = (url: string, bodyText: string): RuntimeSnapshot => ({ url, bodyText });

describe("runtime-matcher — fact status", () => {
  it("marks a screen title present in bodyText as matched", () => {
    const evidence = createRuntimeEvidence(
      baseUiIr,
      snapshot("http://x", "Welcome to the Users screen"),
      new Date("2026-01-01T00:00:00Z"),
    );
    const screenFact = evidence.matchedFacts.find((f) => f.kind === "screen");
    expect(screenFact).toBeDefined();
    expect(screenFact?.status).toBe("matched");
  });

  it("marks a missing screen title as mismatched", () => {
    const evidence = createRuntimeEvidence(
      baseUiIr,
      snapshot("http://x", "totally unrelated body"),
      new Date("2026-01-01T00:00:00Z"),
    );
    const screenFact = evidence.facts.find((f) => f.kind === "screen");
    expect(screenFact?.status).toBe("mismatched");
  });

  it("marks a non-screen fact absent from bodyText as unresolved (not mismatched)", () => {
    const evidence = createRuntimeEvidence(
      baseUiIr,
      snapshot("http://x", "Users"), // screen matches; query/action/result do not
      new Date("2026-01-01T00:00:00Z"),
    );
    const queryFact = evidence.facts.find((f) => f.kind === "query");
    expect(queryFact?.status).toBe("unresolved");
  });

  it("summary counts matched / mismatched / unresolved correctly", () => {
    const evidence = createRuntimeEvidence(
      baseUiIr,
      snapshot("http://x", "Users Query Search Name"), // all facts match
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(evidence.summary).toEqual({
      matched: 4, // screen + query + action + result
      mismatched: 0,
      unresolved: 0,
    });
  });

  it("records the url and checkedAt on the evidence", () => {
    const evidence = createRuntimeEvidence(
      baseUiIr,
      snapshot("http://example/page", "Users"),
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(evidence.url).toBe("http://example/page");
    expect(evidence.checkedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("runtime-matcher — confidence upgrade (confirmMatchedFacts)", () => {
  const runtimeSource = { file: "http://x", kind: "runtime", line: 1 } as const;

  it("upgrades matched facts to runtime-confirmed and appends the runtime source", () => {
    const evidence = createRuntimeEvidence(
      baseUiIr,
      snapshot("http://x", "Users Query Search Name"),
      new Date("2026-01-01T00:00:00Z"),
    );
    const upgraded = confirmMatchedFacts(baseUiIr, evidence.matchedFacts, runtimeSource);
    // Every matched query/action/result column was upgraded.
    expect(upgraded.queryConditions[0].confidence).toBe("runtime-confirmed");
    expect(upgraded.actions[0].confidence).toBe("runtime-confirmed");
    expect(upgraded.results.columns[0].confidence).toBe("runtime-confirmed");
    // The runtime source ref was appended to each upgraded source list.
    expect(
      upgraded.queryConditions[0].sources.some(
        (s) => s.kind === "runtime" && s.file === "http://x",
      ),
    ).toBe(true);
  });

  it("does NOT upgrade unmatched facts", () => {
    const evidence = createRuntimeEvidence(
      baseUiIr,
      snapshot("http://x", "Users"), // only screen matched; no matched query/action/result
      new Date("2026-01-01T00:00:00Z"),
    );
    const upgraded = confirmMatchedFacts(baseUiIr, evidence.matchedFacts, runtimeSource);
    expect(upgraded.queryConditions[0].confidence).toBe("source-static");
    expect(upgraded.actions[0].confidence).toBe("source-static");
  });

  it("does not append a duplicate runtime source on re-confirmation", () => {
    const evidence = createRuntimeEvidence(
      baseUiIr,
      snapshot("http://x", "Users Query Search Name"),
      new Date("2026-01-01T00:00:00Z"),
    );
    const once = confirmMatchedFacts(baseUiIr, evidence.matchedFacts, runtimeSource);
    const twice = confirmMatchedFacts(once, evidence.matchedFacts, runtimeSource);
    const runtimeCount = twice.queryConditions[0].sources.filter(
      (s) => s.kind === "runtime",
    ).length;
    expect(runtimeCount).toBe(1);
  });
});
