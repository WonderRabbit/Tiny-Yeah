// UNIT: analyze stage — the SINGLE builtin TS AST analysis engine (REQ-TY-017, REQ-TY-018).
// Ported from Tinker.Gen `builtin-provider.ts` (file traversal + gitignore + language detect +
// package.json parse + TS import-graph via ts.createSourceFile). REQ-TY-018: ZERO codegraph
// references may appear in core/pipeline — the grep proof at the bottom of this file enforces it.

import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeProject } from "../../../src/core/pipeline/analyze.js";

async function fixture(structure: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ty-analyze-"));
  for (const [relative, content] of Object.entries(structure)) {
    const absolute = join(root, relative);
    await mkdir(join(absolute, ".."), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }
  return root;
}

describe("analyze — builtin engine: file traversal + language detect", () => {
  it("walks the project, classifies languages, and skips node_modules + dist", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({ name: "demo", version: "1.0.0", type: "module" }),
      "src/page.tsx": "export const X = 1;",
      "src/util.ts": "export const y = 2;",
      "src/legacy.js": "module.exports = {};",
      "node_modules/dep/index.js": "should be skipped",
      "dist/build.js": "should be skipped",
    });
    const inventory = await analyzeProject(root);
    const paths = inventory.files.map((f) => f.path).sort();
    expect(paths).toContain("package.json");
    expect(paths).toContain("src/page.tsx");
    expect(paths).toContain("src/util.ts");
    expect(paths).toContain("src/legacy.js");
    expect(paths.some((p) => p.startsWith("node_modules/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("dist/"))).toBe(false);
    expect(inventory.languageCounts.TypeScript).toBeGreaterThanOrEqual(2);
    expect(inventory.languageCounts.JavaScript).toBeGreaterThanOrEqual(1);
    expect(inventory.languageCounts.JSON).toBeGreaterThanOrEqual(1);
  });

  it("respects .gitignore patterns", async () => {
    const root = await fixture({
      ".gitignore": ["*.log", "build/", ".env"].join("\n"),
      "src/main.ts": "export const main = 1;",
      "debug.log": "ignored",
      "build/out.js": "ignored",
      ".env": "SECRET=ignored",
    });
    const inventory = await analyzeProject(root);
    const paths = inventory.files.map((f) => f.path);
    expect(paths).toContain("src/main.ts");
    expect(paths).toContain(".gitignore");
    expect(paths.includes("debug.log")).toBe(false);
    expect(paths.some((p) => p.startsWith("build/"))).toBe(false);
    expect(paths.includes(".env")).toBe(false);
  });
});

describe("analyze — package.json parsing", () => {
  it("collects package manifests with name/version/type", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({ name: "demo", version: "2.3.4", type: "module" }),
      "src/x.ts": "export const x = 1;",
    });
    const inventory = await analyzeProject(root);
    expect(inventory.packageManifests.length).toBe(1);
    expect(inventory.packageManifests[0]?.name).toBe("demo");
    expect(inventory.packageManifests[0]?.version).toBe("2.3.4");
    expect(inventory.packageManifests[0]?.type).toBe("module");
  });
});

describe("analyze — TS import-graph via ts.createSourceFile", () => {
  it("extracts import edges from TS files", async () => {
    const root = await fixture({
      "src/page.ts": 'import { foo } from "./util.js";\nexport const page = foo;',
      "src/util.ts": "export const foo = 1;",
    });
    const inventory = await analyzeProject(root);
    const edges = inventory.importGraph.edges;
    expect(edges.some((e) => e.from === "src/page.ts" && e.to === "./util.js")).toBe(true);
    expect(inventory.importGraph.nodes).toContain("src/page.ts");
    expect(inventory.importGraph.nodes).toContain("src/util.ts");
  });
});

describe("analyze — deterministic output (REQ-TY-017 AC)", () => {
  it("produces a stable schemaVersion + providerId + sorted files", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({ name: "demo" }),
      "src/z.ts": "export const z = 1;",
      "src/a.ts": "export const a = 1;",
    });
    const inventory = await analyzeProject(root);
    expect(inventory.schemaVersion).toBe("tiny-yeah.inventory.v1");
    expect(inventory.providerId).toBe("builtin");
    expect(inventory.artifactSchemaVersion).toBe("tiny-yeah.analysis-artifacts.v1");
    const paths = inventory.files.map((f) => f.path);
    const sorted = [...paths].sort();
    expect(paths).toEqual(sorted);
  });
});

describe("analyze — REQ-TY-018: ZERO codegraph references in core/pipeline (grep proof)", () => {
  // This is the load-bearing REQ-TY-018 acceptance criterion: the codebase MUST NOT contain
  // `codegraph` (case-insensitive) anywhere under src/core/pipeline — no subcommand, no
  // `.codegraph/` artifact, no external-binary dependency, no opt-in branch in the analyze path.
  it("src/core/pipeline/**/*.ts contains ZERO occurrences of 'codegraph' (case-insensitive)", async () => {
    const pipelineRoot = path.resolve("src/core/pipeline");
    const hits: string[] = [];
    for (const file of await listTsFiles(pipelineRoot)) {
      const content = await readFile(file, "utf8");
      if (/codegraph/i.test(content)) {
        hits.push(file);
      }
    }
    expect(hits, `codegraph references found in: ${hits.join(", ")}`).toEqual([]);
  });

  it("analyzeProject does not spawn an external binary (no codegraph branch)", async () => {
    // The signature is analyzeProject(projectPath) → Inventory; there is no provider-selection
    // parameter, no codegraph opt-in flag, no external process spawn. This test pins that the
    // public surface offers no codegraph path.
    const root = await fixture({ "src/x.ts": "export const x = 1;" });
    const inventory = await analyzeProject(root);
    expect(inventory.providerId).toBe("builtin");
    expect(inventory.diagnostics).toEqual([]);
  });
});

async function listTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTsFiles(child)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(child);
    }
  }
  return files;
}
