// Tiny-Yeah renderWireframe — pure UiIr → HTML wireframe transform.
// Ported from ui_pop `commands/render-wireframe.ts` BUT design tokens are PARAMETERIZED: the
// donor hardcodes ui_pop's brand CSS variables; Tiny-Yeah accepts a DesignTokens bag and defaults
// to a NEUTRAL palette so the wireframe is brand-agnostic. Only the pure renderer is ported.

import type { UiIr } from "../schema/ui-ir.js";

/**
 * Design token bag. All fields optional; unspecified tokens fall back to NEUTRAL_DESIGN_TOKENS.
 * Brands/heads supply their own palette; the default keeps the wireframe brand-neutral.
 */
export type DesignTokens = {
  readonly surfacePrimary?: string;
  readonly surfaceSecondary?: string;
  readonly textPrimary?: string;
  readonly textSecondary?: string;
  readonly borderDefault?: string;
  readonly accentPrimary?: string;
  readonly accentHover?: string;
  readonly statusError?: string;
};

export const NEUTRAL_DESIGN_TOKENS: Required<DesignTokens> = {
  surfacePrimary: "#ffffff",
  surfaceSecondary: "#f7f7f8",
  textPrimary: "#1a1a1a",
  textSecondary: "#5a5a5a",
  borderDefault: "#d4d4d4",
  accentPrimary: "#3b3b3b",
  accentHover: "#2a2a2a",
  statusError: "#b33a3a",
};

export function renderWireframe(uiIr: UiIr, tokens: DesignTokens = {}): string {
  const t = { ...NEUTRAL_DESIGN_TOKENS, ...tokens };
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(uiIr.screen.title)} wireframe</title>`,
    `<style>${renderStyles(t)}</style></head><body>`,
    '<main class="shell" aria-labelledby="screen-title">',
    '<header class="screen-header">',
    `<p class="route">${escapeHtml(uiIr.screen.route)}</p>`,
    `<h1 id="screen-title">${escapeHtml(uiIr.screen.title)}</h1>`,
    "</header>",
    renderQuerySection(uiIr),
    renderActionsSection(uiIr),
    renderResultsSection(uiIr),
    renderStatesSection(),
    "</main></body></html>",
    "",
  ].join("\n");
}

function renderQuerySection(uiIr: UiIr): string {
  const controls = uiIr.queryConditions.map((field) =>
    [
      `<div class="field"><label for="field-${escapeHtml(field.id)}">${escapeHtml(field.label)}</label>`,
      renderControl(field.control, field.id, field.label),
      `${renderMeta(field.confidence, field.sources)}</div>`,
    ].join("\n"),
  );
  return panel("query-title", "Query Conditions", controls);
}

function renderActionsSection(uiIr: UiIr): string {
  const actions = uiIr.actions.map((action) =>
    [
      `<div class="action-row"><button type="${
        action.role === "submit" || action.role === "reset" ? action.role : "button"
      }">${escapeHtml(action.label)}</button>`,
      `${renderMeta(action.confidence, action.sources)}</div>`,
    ].join("\n"),
  );
  return panel("actions-title", "Actions", actions);
}

function renderResultsSection(uiIr: UiIr): string {
  const columns = uiIr.results.columns.map(
    (column) => `<th scope="col">${escapeHtml(column.label)}</th>`,
  );
  const cells = uiIr.results.columns.map((column) => `<td>${escapeHtml(column.label)} sample</td>`);
  const table = [
    '<div class="table-wrap"><table><thead><tr>',
    ...columns,
    "</tr></thead><tbody><tr>",
    ...cells,
    "</tr></tbody></table></div>",
  ];
  return panel("results-title", "Results", table);
}

function renderStatesSection(): string {
  const states = [
    '<section class="state" aria-label="Empty state">No results yet.</section>',
    '<section class="state" aria-label="Loading state" aria-live="polite">Loading results.</section>',
    '<section class="state error" aria-label="Error state" role="alert">Unable to load results.</section>',
  ];
  return panel("states-title", "States", states);
}

function panel(titleId: string, title: string, children: readonly string[]): string {
  const content = children.length === 0 ? ['<p class="helper">No entries recorded.</p>'] : children;
  return [
    `<section class="panel" aria-labelledby="${titleId}"><h2 id="${titleId}">${title}</h2>`,
    ...content,
    "</section>",
  ].join("\n");
}

function renderControl(
  control: UiIr["queryConditions"][number]["control"],
  id: string,
  label: string,
): string {
  const fieldId = `field-${escapeHtml(id)}`;
  const fieldLabel = escapeHtml(label);
  switch (control) {
    case "text":
      return `<input id="${fieldId}" name="${escapeHtml(id)}" type="text" placeholder="${fieldLabel}">`;
    case "select":
      return `<select id="${fieldId}" name="${escapeHtml(id)}"><option>${fieldLabel}</option></select>`;
    case "date":
      return `<input id="${fieldId}" name="${escapeHtml(id)}" type="date">`;
    case "checkbox":
      return `<input id="${fieldId}" name="${escapeHtml(id)}" type="checkbox">`;
    case "number":
      return `<input id="${fieldId}" name="${escapeHtml(id)}" type="number" inputmode="numeric">`;
    default:
      return assertNever(control);
  }
}

function renderMeta(
  confidence: string,
  sources: UiIr["queryConditions"][number]["sources"],
): string {
  return `<p class="meta">${escapeHtml(confidence)} · ${escapeHtml(renderSources(sources))}</p>`;
}

function renderSources(sources: UiIr["queryConditions"][number]["sources"]): string {
  return sources
    .map((source) => `${source.file}:${source.line.toString()} (${source.kind})`)
    .join(", ");
}

function renderStyles(t: Required<DesignTokens>): string {
  return [
    `:root{--surface-primary:${t.surfacePrimary};--surface-secondary:${t.surfaceSecondary};--text-primary:${t.textPrimary};--text-secondary:${t.textSecondary};--border-default:${t.borderDefault};--accent-primary:${t.accentPrimary};--accent-hover:${t.accentHover};--status-error:${t.statusError};}`,
    "@media (prefers-color-scheme:dark){:root{--surface-primary:#1a1a1a;--surface-secondary:#222;--text-primary:#f5f5f5;--text-secondary:#a8a8a8;--border-default:#333;--accent-primary:#e0e0e0;--accent-hover:#fff;--status-error:#e06c6c;}}",
    "*{box-sizing:border-box;}body{margin:0;background:var(--surface-primary);color:var(--text-primary);font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.55;}.shell{max-width:1180px;margin:0 auto;padding:32px 24px;}.panel{margin-block-end:24px;}.route,.meta,.helper{color:var(--text-secondary);}.route,.meta{font-family:ui-monospace,monospace;font-size:12px;}h1,h2{margin:0 0 16px;}h1{font-size:28px;}h2{font-size:20px;}",
    ".panel{background:var(--surface-secondary);border:1px solid var(--border-default);padding:16px;}.field,.action-row,.state{display:grid;gap:8px;padding:12px 0;border-top:1px solid var(--border-default);}label{font-weight:600;}input,select,button{width:100%;border:1px solid var(--border-default);background:var(--surface-primary);color:var(--text-primary);font:inherit;padding:8px 12px;}button{background:var(--accent-primary);color:var(--surface-primary);cursor:pointer;}button:hover{background:var(--accent-hover);}",
    ".table-wrap{overflow-x:auto;border:1px solid var(--border-default);}table{width:100%;border-collapse:collapse;}th,td{padding:12px;border-bottom:1px solid var(--border-default);text-align:left;}th{background:var(--surface-secondary);}.state{background:var(--surface-secondary);padding:16px;}.state.error{border-color:var(--status-error);}input:focus-visible,select:focus-visible,button:focus-visible{outline:2px solid var(--accent-primary);outline-offset:2px;}",
    "@media (min-width:768px){.field,.action-row{grid-template-columns:180px minmax(0,1fr);align-items:start;}.meta{grid-column:2;}}",
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function assertNever(value: never): never {
  throw new Error(`Unhandled control: ${value}`);
}
