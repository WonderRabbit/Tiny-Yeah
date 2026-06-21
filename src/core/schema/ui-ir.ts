// Tiny-Yeah UI-IR — ported verbatim from ui_pop `src/schema/ui-ir.ts`.
// This is the intermediate representation for the UI pipeline (Phase 3): static facts
// extracted from TSX (screen, query conditions, actions, results) with per-field
// confidence + source references. Donor asset is clean (zod-only, no host coupling),
// so the port is faithful including the deterministic serializer.

import { z } from "zod";

const confidenceSchema = z.enum(["source-static", "runtime-confirmed", "unresolved"]);

const sourceRefSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive(),
  kind: z.enum(["jsx", "import", "data-flow", "runtime"]),
});

const fieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  control: z.enum(["text", "select", "date", "checkbox", "number"]),
  confidence: confidenceSchema,
  sources: z.array(sourceRefSchema).min(1),
});

const actionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  role: z.enum(["submit", "reset", "navigate", "export"]),
  confidence: confidenceSchema,
  sources: z.array(sourceRefSchema).min(1),
});

const resultColumnSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  confidence: confidenceSchema,
  sources: z.array(sourceRefSchema).min(1),
});

export const uiIrSchema = z.object({
  schemaVersion: z.literal(1),
  screen: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    route: z.string().min(1),
  }),
  queryConditions: z.array(fieldSchema),
  actions: z.array(actionSchema),
  results: z.object({
    kind: z.enum(["table", "list", "detail", "empty"]),
    columns: z.array(resultColumnSchema),
  }),
});

export type UiIr = z.infer<typeof uiIrSchema>;
export type UiIrParseResult = ReturnType<typeof uiIrSchema.safeParse>;

export function parseUiIr(value: unknown): UiIrParseResult {
  return uiIrSchema.safeParse(value);
}

export function serializeUiIr(value: UiIr): string {
  return `${JSON.stringify(sortObject(value), null, 2)}\n`;
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortObject(item));
  }

  if (isRecord(value)) {
    const entries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortObject(item)] as const);
    return Object.fromEntries(entries);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
