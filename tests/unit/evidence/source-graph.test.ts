// UNIT: Tiny-Yeah source-graph port (SPEC-TINY-YEAH-001 plan.md §4 Phase 3).
// Ported from ui_pop `src/source-graph/source-graph.ts` but PARAMETERIZED: the donor hardcodes
// the `.tsx` entry requirement; Tiny-Yeah accepts any entry extension so it stays
// framework-agnostic. Bounded import-graph: depth-limited (maxDepth=2), file-limited
// (maxFiles=80), relative-import-only resolution.

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSourceGraph } from "../../../src/core/evidence/source-graph.js";

async function fixture(structure: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ty-sourcegraph-"));
  for (const [relative, content] of Object.entries(structure)) {
    const absolute = join(root, relative);
    await mkdir(join(absolute, ".."), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }
  return root;
}

describe("source-graph — entry validation", () => {
  it("rejects an entry whose extension is not in the allowed set", async () => {
    const root = await fixture({ "page.txt": "hello" });
    const result = await buildSourceGraph({
      entry: join(root, "page.txt"),
      entryExtensions: [".tsx", ".ts"],
      maxDepth: 2,
      maxFiles: 80,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ERR_UNSUPPORTED_ENTRY");
    }
  });

  it("accepts a parameterized entry extension (.ts when allowed)", async () => {
    const root = await fixture({
      "page.ts": 'import "./util.js";',
      "util.ts": "export const x = 1;",
    });
    const result = await buildSourceGraph({
      entry: join(root, "page.ts"),
      entryExtensions: [".ts"],
      maxDepth: 2,
      maxFiles: 80,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.graph.files.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("rejects a malformed entry (no JSX-like markup when .tsx required)", async () => {
    const root = await fixture({ "page.tsx": "const x = 1;" });
    const result = await buildSourceGraph({
      entry: join(root, "page.tsx"),
      entryExtensions: [".tsx"],
      maxDepth: 2,
      maxFiles: 80,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ERR_MALFORMED_TSX");
    }
  });

  it("rejects maxDepth < 1", async () => {
    const root = await fixture({ "page.tsx": "<div>export default function Page()</div>" });
    const result = await buildSourceGraph({
      entry: join(root, "page.tsx"),
      entryExtensions: [".tsx"],
      maxDepth: 0,
      maxFiles: 80,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ERR_GRAPH_DEPTH_EXCEEDED");
    }
  });

  it("rejects maxFiles < 1", async () => {
    const root = await fixture({ "page.tsx": "<div>export default function Page()</div>" });
    const result = await buildSourceGraph({
      entry: join(root, "page.tsx"),
      entryExtensions: [".tsx"],
      maxDepth: 2,
      maxFiles: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ERR_GRAPH_FILE_LIMIT_EXCEEDED");
    }
  });
});

describe("source-graph — bounded traversal", () => {
  it("walks relative imports and collects reachable files", async () => {
    // Chain depth 1→2→3 with maxDepth=3: every file fully walked, no truncation.
    const root = await fixture({
      "page.tsx": 'import "./Header.js";\nexport default function Page(){return <Header/>}',
      "Header.tsx": 'import "./Logo.js";\nexport function Header(){return <header/>}',
      "Logo.tsx": "export function Logo(){return <div/>}",
    });
    const result = await buildSourceGraph({
      entry: join(root, "page.tsx"),
      entryExtensions: [".tsx"],
      maxDepth: 3,
      maxFiles: 80,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.graph.files.length).toBe(3);
      expect(result.graph.truncated).toBe(false);
    }
  });

  it("flags truncated=true when maxDepth is reached before exhausting imports", async () => {
    // Chain: page → Header → Logo. maxDepth=1 stops at Header, truncating the Logo branch.
    const root = await fixture({
      "page.tsx": 'import "./Header.js";\nexport default function Page(){return <Header/>}',
      "Header.tsx": 'import "./Logo.js";\nexport function Header(){return <header/>}',
      "Logo.tsx": "export function Logo(){return <div/>}",
    });
    const result = await buildSourceGraph({
      entry: join(root, "page.tsx"),
      entryExtensions: [".tsx"],
      maxDepth: 1,
      maxFiles: 80,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.graph.truncated).toBe(true);
    }
  });

  it("stops with a file-limit failure when maxFiles is exceeded", async () => {
    const files: Record<string, string> = {
      "page.tsx": 'import "./a.js";\nexport default function Page(){return <div/>}',
    };
    // Build a chain a <- b <- c ... so each is a separate file.
    const chain = ["a", "b", "c", "d", "e"];
    for (let i = 0; i < chain.length; i += 1) {
      const current = chain[i];
      const next = chain[i + 1];
      files[`${current}.tsx`] =
        next !== undefined
          ? `import "./${next}.js";\nexport function ${current}(){return <div/>}`
          : `export function ${current}(){return <div/>}`;
    }
    const root = await fixture(files);
    const result = await buildSourceGraph({
      entry: join(root, "page.tsx"),
      entryExtensions: [".tsx"],
      maxDepth: 10,
      maxFiles: 2,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ERR_GRAPH_FILE_LIMIT_EXCEEDED");
    }
  });

  it("does not revisit a file already in the graph (cycle-safe)", async () => {
    const root = await fixture({
      "page.tsx": 'import "./Header.js";\nexport default function Page(){return <Header/>}',
      // Header imports back into page — must not loop.
      "Header.tsx": 'import "./page.js";\nexport function Header(){return <header/>}',
    });
    const result = await buildSourceGraph({
      entry: join(root, "page.tsx"),
      entryExtensions: [".tsx"],
      maxDepth: 5,
      maxFiles: 80,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.graph.files.length).toBe(2);
    }
  });
});
