// Tiny-Yeah evidence sanitizer — ported verbatim from ui_pop `src/evidence/evidence-sanitizer.ts`.
// REQ-TY-015 prep / compaction discipline (SPEC-TINY-YEAH-001 plan.md §4 Phase 3): every
// model-facing evidence emission MUST pass through here. Redacts env vars / API keys / Bearer
// tokens / credential-assignment patterns and truncates source excerpts to MAX_EXCERPT_LENGTH.

const MAX_EXCERPT_LENGTH = 300;

export type StaticEvidenceSummaryInput = {
  readonly files: readonly string[];
  readonly source: string;
  readonly title: string;
  readonly unresolvedNotes: readonly string[];
};

export type StaticEvidenceSummary = {
  readonly fileCount: number;
  readonly files: readonly string[];
  readonly sourceExcerpt: string;
  readonly title: string;
  readonly unresolvedNotes: readonly string[];
};

export function createStaticEvidenceSummary(
  input: StaticEvidenceSummaryInput,
): StaticEvidenceSummary {
  return {
    fileCount: input.files.length,
    files: input.files.map((file) => sanitizeText(file)),
    sourceExcerpt: createSourceExcerpt(input.source),
    title: sanitizeText(input.title),
    unresolvedNotes: input.unresolvedNotes.map((note) => sanitizeText(note)),
  };
}

export function sanitizeEvidenceValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeEvidenceValue(item));
  }

  if (isRecord(value)) {
    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      sanitized[sanitizeText(key)] = sanitizeEvidenceValue(item);
    }
    return sanitized;
  }

  return value;
}

function createSourceExcerpt(source: string): string {
  const normalized = sanitizeText(source).replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_EXCERPT_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_EXCERPT_LENGTH)} [TRUNCATED]`;
}

function sanitizeText(value: string): string {
  return value
    .replace(/process\.env\.[A-Za-z0-9_]+/g, "process.env.[REDACTED]")
    .replace(/sk_(?:live|test)_[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(password|passwd|secret|token|api[-_]?key|auth\w*|cookie|session\w*)\b(\s*[:=]\s*)(["'`])?[^"'`,;}\s]+(["'`])?/gi,
      "$1$2[REDACTED]",
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
