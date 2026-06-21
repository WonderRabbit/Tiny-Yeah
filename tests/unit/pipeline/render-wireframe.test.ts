// UNIT: renderWireframe — pure UiIr → HTML wireframe transform.
// Ported from ui_pop `commands/render-wireframe.ts` BUT design tokens are PARAMETERIZED (donor
// hardcodes ui_pop's CSS custom properties; Tiny-Yeah accepts a token bag and defaults to a
// neutral palette). Only the pure renderer is ported — no CLI shell, no fs IO.

import { describe, expect, it } from "vitest";
import {
  NEUTRAL_DESIGN_TOKENS,
  renderWireframe,
} from "../../../src/core/pipeline/render-wireframe.js";
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

describe("renderWireframe — HTML structure", () => {
  it("emits a valid HTML5 doctype + document wrapper", () => {
    const html = renderWireframe(uiIr);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
  });

  it("renders the screen title and route in the header", () => {
    const html = renderWireframe(uiIr);
    expect(html).toContain("Search");
    expect(html).toContain("/search");
  });

  it("renders query controls, action buttons, result columns, and state sections", () => {
    const html = renderWireframe(uiIr);
    expect(html).toContain("Query Conditions");
    expect(html).toContain("Actions");
    expect(html).toContain("Results");
    expect(html).toContain("States");
    expect(html).toContain("Name");
  });

  it("escapes HTML metacharacters in labels", () => {
    const withHtml: UiIr = {
      ...uiIr,
      queryConditions: [
        {
          id: "q",
          label: "<script>",
          control: "text",
          confidence: "source-static",
          sources: [{ file: "P.tsx", line: 1, kind: "jsx" }],
        },
      ],
    };
    const html = renderWireframe(withHtml);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});

describe("renderWireframe — parameterized design tokens", () => {
  it("uses the neutral palette by default (no hardcoded ui_pop brand colors)", () => {
    const html = renderWireframe(uiIr);
    // The default neutral accent is present.
    expect(html).toContain(NEUTRAL_DESIGN_TOKENS.accentPrimary);
  });

  it("injects a custom accent color when a token bag is supplied", () => {
    const html = renderWireframe(uiIr, { accentPrimary: "#ff0000" });
    expect(html).toContain("#ff0000");
  });

  it("falls back to neutral tokens for any unspecified token", () => {
    const html = renderWireframe(uiIr, { accentHover: "#00ff00" });
    expect(html).toContain("#00ff00");
    expect(html).toContain(NEUTRAL_DESIGN_TOKENS.accentPrimary);
  });
});
