// Tiny-Yeah head/opencode budget-output (SPEC-TINY-YEAH-001 REQ-TY-002, plan.md §3.7 T7).
//
// Ported from Tiny-Chu `src/opencode/output-budget.ts` (audit-v1.1 verified numbers: default
// 8000/40 at output-budget.ts:57-58, install_check 40000/500 at plugin.ts:50-52). Deterministic
// truncation: arrays are capped to `maxArrayItems` with a `__yeahOmittedItems` tail marker,
// then the serialized form is capped to `maxOutputChars` with a trailing truncation line.
// Property T7: the returned `output` string NEVER exceeds `maxOutputChars`.

export interface OutputBudgetMetadata {
  readonly truncated: boolean;
  readonly evidencePath: string | null;
  readonly budget: {
    readonly maxOutputChars: number;
    readonly maxArrayItems: number;
    readonly omittedItems: number;
    readonly omittedRawEvidenceChars: number;
    readonly fullSizeChars: number;
    readonly outputSizeChars: number;
  };
}

export interface BudgetedOutput {
  readonly output: string;
  readonly metadata: OutputBudgetMetadata;
}

interface BudgetStats {
  omittedItems: number;
  omittedRawEvidenceChars: number;
}

const RAW_EVIDENCE_STRING_THRESHOLD = 4000;

function evidencePathFrom(input: Record<string, unknown>): string | null {
  const evidencePath = input.evidencePath;
  return typeof evidencePath === "string" && evidencePath.trim() !== "" ? evidencePath : null;
}

function isRawEvidenceKey(key: string | undefined): boolean {
  if (key === undefined) return true;
  const normalized = key.toLowerCase();
  return (
    normalized.includes("log") ||
    normalized.includes("output") ||
    normalized.includes("stderr") ||
    normalized.includes("stdout") ||
    normalized.includes("transcript")
  );
}

function evidenceSummaryFor(key: string | undefined): string {
  const normalized = key?.toLowerCase() ?? "";
  if (normalized.includes("doctor")) return "doctor output omitted from model-facing response";
  if (normalized.includes("install")) return "install output omitted from model-facing response";
  return "raw evidence omitted from model-facing response";
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function compactValue(
  value: unknown,
  maxArrayItems: number,
  stats: BudgetStats,
  evidencePath: string | null,
  key: string | undefined,
): unknown {
  if (
    typeof value === "string" &&
    evidencePath !== null &&
    value.length > RAW_EVIDENCE_STRING_THRESHOLD &&
    isRawEvidenceKey(key)
  ) {
    stats.omittedRawEvidenceChars += value.length;
    return {
      evidencePath,
      kind: "evidence-summary",
      omittedRawChars: value.length,
      summary: evidenceSummaryFor(key),
    };
  }
  if (Array.isArray(value)) {
    const visible = value
      .slice(0, maxArrayItems)
      .map((item) => compactValue(item, maxArrayItems, stats, evidencePath, key));
    const omitted = Math.max(0, value.length - visible.length);
    if (omitted > 0) {
      stats.omittedItems += omitted;
      return visible.concat({ __yeahOmittedItems: omitted });
    }
    return visible;
  }
  if (value && typeof value === "object") {
    return Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .reduce<Record<string, unknown>>((acc, [entryKey, entryValue]) => {
        acc[entryKey] = compactValue(entryValue, maxArrayItems, stats, evidencePath, entryKey);
        return acc;
      }, {});
  }
  return value;
}

function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function truncateOutput(
  output: string,
  maxOutputChars: number,
  metadata: OutputBudgetMetadata,
): string {
  if (output.length <= maxOutputChars) return output;
  const marker = `\n... truncated by Tiny-Yeah output budget; omittedItems=${metadata.budget.omittedItems}; fullSizeChars=${metadata.budget.fullSizeChars}`;
  if (marker.length >= maxOutputChars) return marker.slice(0, maxOutputChars);
  return `${output.slice(0, maxOutputChars - marker.length)}${marker}`;
}

export function renderBudgetedOutput(
  value: unknown,
  input: Record<string, unknown>,
): BudgetedOutput {
  const maxOutputChars = positiveInteger(input.maxOutputChars, 8000);
  const maxArrayItems = positiveInteger(input.maxArrayItems, 40);
  const evidencePath = evidencePathFrom(input);
  const fullOutput = stringify(value);
  const stats: BudgetStats = { omittedItems: 0, omittedRawEvidenceChars: 0 };
  const compactOutput = stringify(
    compactValue(value, maxArrayItems, stats, evidencePath, undefined),
  );
  const preMetadata: OutputBudgetMetadata = {
    truncated:
      stats.omittedItems > 0 ||
      stats.omittedRawEvidenceChars > 0 ||
      compactOutput.length > maxOutputChars ||
      compactOutput.length < fullOutput.length,
    evidencePath: stats.omittedRawEvidenceChars > 0 ? evidencePath : null,
    budget: {
      maxOutputChars,
      maxArrayItems,
      omittedItems: stats.omittedItems,
      omittedRawEvidenceChars: stats.omittedRawEvidenceChars,
      fullSizeChars: fullOutput.length,
      outputSizeChars: 0,
    },
  };
  const output = truncateOutput(compactOutput, maxOutputChars, preMetadata);
  return {
    output,
    metadata: {
      truncated: preMetadata.truncated || output.length < compactOutput.length,
      evidencePath: preMetadata.evidencePath,
      budget: {
        ...preMetadata.budget,
        outputSizeChars: output.length,
      },
    },
  };
}
