// Tiny-Yeah runtime-matcher — ported from ui_pop `runtime-evidence.ts`, DECOUPLED from Playwright.
// REQ-TY-015: consumes RuntimeSnapshot from core/pipeline/validate/driver.ts (single definition
// point) — does NOT redefine the snapshot shape. The DRIVER produces the snapshot; the matcher
// only turns (UiIr, bodyText) into matched/mismatched/unresolved facts + confidence upgrades.

import type { RuntimeSnapshot } from "../pipeline/validate/driver.js";
import type { UiIr } from "../schema/ui-ir.js";

export type FactKind = "screen" | "query" | "action" | "result";
export type RuntimeStatus = "matched" | "unresolved" | "mismatched";
export type SourceRef = UiIr["queryConditions"][number]["sources"][number];

export type RuntimeFact = {
  readonly id: string;
  readonly kind: FactKind;
  readonly label: string;
  readonly source: SourceRef;
  readonly status: RuntimeStatus;
};

export type RuntimeEvidence = {
  readonly url: string;
  readonly checkedAt: string;
  readonly schemaVersion: 1;
  readonly facts: readonly RuntimeFact[];
  readonly matchedFacts: readonly RuntimeFact[];
  readonly unmatchedFacts: readonly RuntimeFact[];
  readonly summary: {
    readonly matched: number;
    readonly mismatched: number;
    readonly unresolved: number;
  };
};

const RUNTIME_SOURCE: SourceRef = { file: "runtime", kind: "runtime", line: 1 };

export function createRuntimeEvidence(
  uiIr: UiIr,
  snapshot: RuntimeSnapshot,
  now: Date,
): RuntimeEvidence {
  // The source ref recorded on each fact points at the runtime URL (where the page lives),
  // tagged kind="runtime" so downstream source-append can de-duplicate by it.
  const runtimeSource: SourceRef = { file: snapshot.url, kind: "runtime", line: 1 };
  const facts: RuntimeFact[] = [
    makeFact("screen", uiIr.screen.id, uiIr.screen.title, snapshot.bodyText, runtimeSource),
    ...uiIr.queryConditions.map((field) =>
      makeFact("query", field.id, field.label, snapshot.bodyText, runtimeSource),
    ),
    ...uiIr.actions.map((action) =>
      makeFact("action", action.id, action.label, snapshot.bodyText, runtimeSource),
    ),
    ...uiIr.results.columns.map((column) =>
      makeFact("result", column.id, column.label, snapshot.bodyText, runtimeSource),
    ),
  ];

  const matchedFacts = facts.filter((fact) => fact.status === "matched");
  const unmatchedFacts = facts.filter((fact) => fact.status !== "matched");

  return {
    url: snapshot.url,
    checkedAt: now.toISOString(),
    schemaVersion: 1,
    facts,
    matchedFacts,
    unmatchedFacts,
    summary: {
      matched: matchedFacts.length,
      mismatched: unmatchedFacts.filter((fact) => fact.status === "mismatched").length,
      unresolved: unmatchedFacts.filter((fact) => fact.status === "unresolved").length,
    },
  };
}

export function confirmMatchedFacts(
  uiIr: UiIr,
  matchedFacts: readonly RuntimeFact[],
  runtimeSource: SourceRef = RUNTIME_SOURCE,
): UiIr {
  return {
    ...uiIr,
    queryConditions: uiIr.queryConditions.map((field) =>
      hasMatchedFact(matchedFacts, "query", field.id)
        ? {
            ...field,
            confidence: "runtime-confirmed",
            sources: appendSource(field.sources, runtimeSource),
          }
        : field,
    ),
    actions: uiIr.actions.map((action) =>
      hasMatchedFact(matchedFacts, "action", action.id)
        ? {
            ...action,
            confidence: "runtime-confirmed",
            sources: appendSource(action.sources, runtimeSource),
          }
        : action,
    ),
    results: {
      ...uiIr.results,
      columns: uiIr.results.columns.map((column) =>
        hasMatchedFact(matchedFacts, "result", column.id)
          ? {
              ...column,
              confidence: "runtime-confirmed",
              sources: appendSource(column.sources, runtimeSource),
            }
          : column,
      ),
    },
  };
}

function makeFact(
  kind: FactKind,
  id: string,
  label: string,
  text: string,
  source: SourceRef,
): RuntimeFact {
  if (text.includes(label)) {
    return { id, kind, label, source, status: "matched" };
  }

  return {
    id,
    kind,
    label,
    source,
    status: kind === "screen" ? "mismatched" : "unresolved",
  };
}

function hasMatchedFact(facts: readonly RuntimeFact[], kind: FactKind, id: string): boolean {
  return facts.some((fact) => fact.kind === kind && fact.id === id);
}

function appendSource(sources: readonly SourceRef[], runtimeSource: SourceRef): SourceRef[] {
  if (sources.some((source) => source.kind === "runtime" && source.file === runtimeSource.file)) {
    return [...sources];
  }
  return [...sources, runtimeSource];
}
