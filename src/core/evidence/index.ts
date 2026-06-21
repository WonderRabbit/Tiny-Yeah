// Tiny-Yeah evidence barrel (SPEC-TINY-YEAH-001 plan.md §4 Phase 3).

export {
  confirmMatchedFacts,
  createRuntimeEvidence,
  type FactKind,
  type RuntimeEvidence,
  type RuntimeFact,
  type RuntimeStatus,
  type SourceRef as RuntimeSourceRef,
} from "./runtime-matcher.js";
export {
  createStaticEvidenceSummary,
  type StaticEvidenceSummary,
  type StaticEvidenceSummaryInput,
  sanitizeEvidenceValue,
} from "./sanitizer.js";
export {
  buildSourceGraph,
  type SourceGraphBuildResult,
  type SourceGraphFailure,
  type SourceGraphOptions,
  type SourceGraphResult,
  type SourceGraphSuccess,
} from "./source-graph.js";
