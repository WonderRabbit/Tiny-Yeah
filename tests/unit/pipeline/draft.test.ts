// UNIT: draftUiDefinition — pure UiIr → Markdown table transform.
// Ported from ui_pop `commands/draft.ts` renderUiMarkdown (the pure renderer, NOT the CLI shell).

import { describe, expect, it } from "vitest";
import { draftUiDefinition } from "../../../src/core/pipeline/draft.js";
import type { UiIr } from "../../../src/core/schema/ui-ir.js";

const uiIr: UiIr = {
  schemaVersion: 1,
  screen: { id: "s", title: "Search", route: "/search" },
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
      id: "go",
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

describe("draftUiDefinition — Markdown structure", () => {
  it("emits the four sections: Screen, Query Conditions, Actions, Results", () => {
    const md = draftUiDefinition(uiIr);
    expect(md).toContain("# UI Definition");
    expect(md).toContain("## Screen");
    expect(md).toContain("## Query Conditions");
    expect(md).toContain("## Actions");
    expect(md).toContain("## Results");
  });

  it("emits the screen title + route in the Screen section", () => {
    const md = draftUiDefinition(uiIr);
    expect(md).toContain("Search (/search)");
  });

  it("renders a markdown table with the header row", () => {
    const md = draftUiDefinition(uiIr);
    expect(md).toContain("| Label | Type/Role/Kind | Confidence | Source |");
    expect(md).toContain("| --- | --- | --- | --- |");
  });

  it("includes source file:line (kind) in the Source column", () => {
    const md = draftUiDefinition(uiIr);
    expect(md).toContain("Page.tsx:10 (jsx)");
  });
});

describe("draftUiDefinition — empty sections", () => {
  it("renders a 'No entries recorded' row for an empty query section", () => {
    const empty: UiIr = { ...uiIr, queryConditions: [] };
    const md = draftUiDefinition(empty);
    expect(md).toContain("No entries recorded");
  });
});

describe("draftUiDefinition — escaping", () => {
  it("escapes pipe characters in cell values", () => {
    const withPipe: UiIr = {
      ...uiIr,
      queryConditions: [
        {
          id: "q",
          label: "a|b",
          control: "text",
          confidence: "source-static",
          sources: [{ file: "P.tsx", line: 1, kind: "jsx" }],
        },
      ],
    };
    const md = draftUiDefinition(withPipe);
    expect(md).toContain("a\\|b");
  });
});
