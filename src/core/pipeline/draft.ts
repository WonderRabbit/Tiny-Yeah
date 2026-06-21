// Tiny-Yeah draftUiDefinition — pure UiIr → Markdown table transform.
// Ported from ui_pop `commands/draft.ts` renderUiMarkdown (the pure renderer; the CLI shell with
// fs IO is NOT ported — Tiny-Yeah keeps IO at the head layer). Deterministic output.

import type { UiIr } from "../schema/ui-ir.js";

type MarkdownRow = {
  readonly label: string;
  readonly typeRoleKind: string;
  readonly confidence: string;
  readonly source: string;
};

export function draftUiDefinition(uiIr: UiIr): string {
  return [
    "# UI Definition",
    "",
    "## Screen",
    renderTable([
      {
        confidence: "",
        label: `${uiIr.screen.title} (${uiIr.screen.route})`,
        source: "",
        typeRoleKind: "screen",
      },
    ]),
    "## Query Conditions",
    renderTable(
      uiIr.queryConditions.map((field) => ({
        confidence: field.confidence,
        label: field.label,
        source: renderSources(field.sources),
        typeRoleKind: field.control,
      })),
    ),
    "## Actions",
    renderTable(
      uiIr.actions.map((action) => ({
        confidence: action.confidence,
        label: action.label,
        source: renderSources(action.sources),
        typeRoleKind: action.role,
      })),
    ),
    "## Results",
    renderTable(
      uiIr.results.columns.map((column) => ({
        confidence: column.confidence,
        label: column.label,
        source: renderSources(column.sources),
        typeRoleKind: uiIr.results.kind,
      })),
    ),
  ].join("\n");
}

function renderTable(rows: readonly MarkdownRow[]): string {
  const renderedRows =
    rows.length === 0
      ? ["| No entries recorded |  |  |  |"]
      : rows.map(
          (row) =>
            `| ${escapeCell(row.label)} | ${escapeCell(row.typeRoleKind)} | ${escapeCell(
              row.confidence,
            )} | ${escapeCell(row.source)} |`,
        );

  return [
    "| Label | Type/Role/Kind | Confidence | Source |",
    "| --- | --- | --- | --- |",
    ...renderedRows,
    "",
  ].join("\n");
}

function renderSources(sources: UiIr["queryConditions"][number]["sources"]): string {
  return sources
    .map((source) => `${source.file}:${source.line.toString()} (${source.kind})`)
    .join(", ");
}

function escapeCell(value: string): string {
  return value.replaceAll("\n", " ").replaceAll("|", "\\|");
}
