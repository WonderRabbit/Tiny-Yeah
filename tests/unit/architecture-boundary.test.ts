// UNIT: architecture boundary firewall (SPEC-TINY-YEAH-001 plan.md §3.1, REQ-TY-012).
// Mirrors Tiny-Chu's `architecture-boundary.test.mjs`. Asserts the call-graph firewall:
//   - composer MUST NOT import checkpoint / state / head (composer is pure + deterministic)
//   - state MUST NOT import composer / checkpoint / head (state is the lowest layer)
// Also pins REQ-TY-012 parity: the composed registry is the single source of truth —
// toolSpecs and handlers are 1:1 (no parallel hand-edited arrays).
//
// The synthetic-edge test below proves the detector is not a no-op: it flags a forbidden
// edge when fed one.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  composeFeaturePackages,
  createDefaultTinyYeahFeaturePackages,
} from "../../src/core/composer/index.js";

const SRC_ROOT = path.resolve("src");

type Layer = "state" | "checkpoint" | "schema" | "composer" | "head" | "other";

function layerFor(repoPath: string): Layer {
  if (repoPath.startsWith("src/core/state/")) return "state";
  if (repoPath.startsWith("src/core/checkpoint/")) return "checkpoint";
  if (repoPath.startsWith("src/core/schema/")) return "schema";
  if (repoPath.startsWith("src/core/composer/")) return "composer";
  if (repoPath.startsWith("src/head/")) return "head";
  return "other";
}

interface Edge {
  readonly source: string;
  readonly target: string;
}

interface Violation extends Edge {
  readonly code: string;
}

/**
 * The firewall rules. composer must not reach checkpoint/state/head; state must not
 * reach composer/checkpoint/head. schema is an allowed intermediary (composer → schema
 * → checkpoint type re-export is permitted; the forbidden edge is composer → checkpoint
 * directly).
 *
 * Phase 4 additions (REQ-TY-001/019): `core/` must not import `@opencode-ai/plugin` or
 * `src/head/` (the host dep lives ONLY in src/head/opencode/). The bare specifier
 * `@opencode-ai/plugin` may appear ONLY under src/head/opencode/.
 */
function firewallViolations(edges: readonly Edge[]): Violation[] {
  const violations: Violation[] = [];
  for (const edge of edges) {
    const sourceLayer = layerFor(edge.source);
    const targetLayer = layerFor(edge.target);
    if (sourceLayer === "composer") {
      if (targetLayer === "checkpoint" || targetLayer === "state" || targetLayer === "head") {
        violations.push({ code: `composer_to_${targetLayer}`, ...edge });
      }
    }
    if (sourceLayer === "state") {
      if (
        targetLayer === "composer" ||
        targetLayer === "checkpoint" ||
        targetLayer === "head" ||
        targetLayer === "schema"
      ) {
        violations.push({ code: `state_to_${targetLayer}`, ...edge });
      }
    }
  }
  return violations;
}

/**
 * Phase 4 host-dep firewall (REQ-TY-001/019). `@opencode-ai/plugin` is the ONLY allowed host
 * coupling and it may appear ONLY in src/head/opencode/. Anywhere else (core/, model-contract/,
 * head/library/) is a violation. `src/head/` itself may be imported only by other head modules
 * or the top-level barrel — never by core/.
 */
function hostDepViolations(
  specifiers: ReadonlyArray<{ source: string; specifier: string }>,
): Violation[] {
  const violations: Violation[] = [];
  for (const { source, specifier } of specifiers) {
    const isPlugin =
      specifier === "@opencode-ai/plugin" || specifier.startsWith("@opencode-ai/plugin/");
    if (isPlugin && !source.startsWith("src/head/opencode/")) {
      violations.push({ code: "host_dep_outside_head_opencode", source, target: specifier });
    }
    // core/ must not import src/head/ at all.
    if (source.startsWith("src/core/") && specifier.includes("/head/")) {
      violations.push({ code: "core_imports_head", source, target: specifier });
    }
  }
  return violations;
}

describe("architecture firewall — detector is not a no-op", () => {
  it("flags synthetic forbidden edges (composer→checkpoint, composer→state, state→composer)", () => {
    const violations = firewallViolations([
      { source: "src/core/composer/composer.ts", target: "src/core/checkpoint/contracts.ts" },
      { source: "src/core/composer/composer.ts", target: "src/core/state/file-store.ts" },
      { source: "src/core/state/file-store.ts", target: "src/core/composer/index.ts" },
      { source: "src/core/schema/registry.ts", target: "src/core/checkpoint/contracts.ts" },
    ]);

    expect(violations.map((v) => v.code).sort()).toEqual(
      ["composer_to_checkpoint", "composer_to_state", "state_to_composer"].sort(),
    );
    // schema → checkpoint is ALLOWED (schema re-exports checkpoint contracts)
    expect(violations.find((v) => v.code === "schema_to_checkpoint")).toBeUndefined();
  });

  it("RED->GREEN proof: host-dep detector flags @opencode-ai/plugin outside src/head/opencode/", () => {
    // RED: a forbidden import (in core/) is flagged.
    const redViolations = hostDepViolations([
      { source: "src/core/composer/composer.ts", specifier: "@opencode-ai/plugin" },
      { source: "src/core/checkpoint/apply.ts", specifier: "@opencode-ai/plugin" },
    ]);
    expect(redViolations.map((v) => v.code).sort()).toEqual(
      ["host_dep_outside_head_opencode", "host_dep_outside_head_opencode"].sort(),
    );

    // GREEN: the allowed location is NOT flagged.
    const greenViolations = hostDepViolations([
      { source: "src/head/opencode/plugin.ts", specifier: "@opencode-ai/plugin" },
    ]);
    expect(greenViolations).toEqual([]);
  });

  it("RED->GREEN proof: core/ importing src/head/ is flagged", () => {
    const red = hostDepViolations([
      { source: "src/core/pipeline/plan.ts", specifier: "../../head/opencode/plugin.js" },
    ]);
    expect(red.map((v) => v.code)).toContain("core_imports_head");
  });
});

describe("architecture firewall — current source tree respects boundaries", () => {
  it("has zero firewall violations across src/", async () => {
    const files = await listTsFiles(SRC_ROOT);
    const edges: Edge[] = [];
    const allSpecifiers: Array<{ source: string; specifier: string }> = [];
    for (const file of files) {
      const source = toRepoPath(file);
      for (const specifier of await staticImports(file)) {
        allSpecifiers.push({ source, specifier });
        const target = resolveRelativeImport(file, specifier);
        if (target) edges.push({ source, target });
      }
    }
    expect(firewallViolations(edges)).toEqual([]);
    expect(hostDepViolations(allSpecifiers)).toEqual([]);
  });

  it("@opencode-ai/plugin appears ONLY under src/head/opencode/ (REQ-TY-001/019)", async () => {
    const files = await listTsFiles(SRC_ROOT);
    const locations: string[] = [];
    for (const file of files) {
      const source = toRepoPath(file);
      for (const specifier of await staticImports(file)) {
        if (specifier === "@opencode-ai/plugin" || specifier.startsWith("@opencode-ai/plugin/")) {
          locations.push(source);
        }
      }
    }
    expect(locations.length).toBeGreaterThan(0);
    for (const loc of locations) {
      expect(loc.startsWith("src/head/opencode/")).toBe(true);
    }
  });
});

describe("architecture firewall — REQ-TY-012 parity (no parallel hand-edited arrays)", () => {
  it("default seed registry has 1:1 toolSpecs ↔ handlers (no orphan, no spec drift)", () => {
    const registry = composeFeaturePackages(createDefaultTinyYeahFeaturePackages());
    const specNames = registry.toolSpecs.map((spec) => spec.name).sort();
    const handlerNames = Object.keys(registry.tools).sort();
    expect(specNames).toEqual(handlerNames);
    expect(specNames.length).toBeGreaterThan(0);
  });
});

// REQ-TY-024 (Unwanted) — legacy domain tools EXCLUDED.
// Tiny-Yeah MUST NOT carry Tiny-Chu's legacy detectors: legacy-analysis, ux-reverse, mybatis,
// redux-detector, RFC-detector patterns. Their absence is proven by grep over src/.
describe("architecture firewall — REQ-TY-024 legacy domain tools absent", () => {
  // Token substrings that, if found in src/, indicate a legacy detector was ported.
  const LEGACY_TOKENS = [
    "legacy-analysis",
    "legacy_analysis",
    "ux-reverse",
    "ux_reverse",
    "uxReverse",
    "mybatis",
    "MyBatis",
    "redux-detector",
    "redux_detector",
    "reduxDetector",
    "rfc-detector",
    "rfc_detector",
    "rfcDetector",
    "detectLegacy",
    "detectRfc",
    "detectRedux",
    "detectMybatis",
    "detectUx",
  ];

  it("detector is not a no-op (synthetic legacy token is flagged)", () => {
    const flagged = scanForLegacyTokens(
      [
        "    name: 'legacy-analysis',\n",
        "    name: 'ux_reverse',\n",
        "import { detectRedux } from './redux-detector.js';\n",
        "    // clean code, no legacy\n",
      ],
      LEGACY_TOKENS,
    );
    expect(flagged.sort()).toEqual(
      ["legacy-analysis", "ux_reverse", "redux-detector", "detectRedux"].sort(),
    );
  });

  it("src/ contains ZERO legacy detector tokens", async () => {
    const files = await listTsFiles(SRC_ROOT);
    const hits: Array<{ file: string; token: string }> = [];
    for (const file of files) {
      const content = await readFile(file, "utf8");
      const found = scanForLegacyTokens(content.split(/\r?\n/), LEGACY_TOKENS);
      for (const token of found) {
        hits.push({ file: toRepoPath(file), token });
      }
    }
    expect(hits).toEqual([]);
  });

  it("composed registry has NO legacy-named tools", () => {
    const registry = composeFeaturePackages(createDefaultTinyYeahFeaturePackages());
    const toolNames = registry.toolSpecs.map((spec) => spec.name);
    for (const name of toolNames) {
      for (const token of LEGACY_TOKENS) {
        const normalized = token.toLowerCase().replace(/[-_]/g, "");
        expect(name.toLowerCase().replace(/[-_]/g, "")).not.toContain(normalized);
      }
    }
  });
});

function scanForLegacyTokens(lines: readonly string[], tokens: readonly string[]): string[] {
  const found = new Set<string>();
  for (const line of lines) {
    for (const token of tokens) {
      if (line.includes(token)) found.add(token);
    }
  }
  return [...found];
}

async function listTsFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTsFiles(child)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(child);
    }
  }
  return files.sort();
}

async function staticImports(file: string): Promise<string[]> {
  const content = await readFile(file, "utf8");
  const imports: string[] = [];
  const pattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of content.matchAll(pattern)) {
    imports.push(match[1] as string);
  }
  return imports;
}

function resolveRelativeImport(sourceFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const resolved = path.resolve(path.dirname(sourceFile), specifier);
  const withoutJs = resolved.endsWith(".js") ? resolved.slice(0, -3) : resolved;
  const candidates = [
    `${withoutJs}.ts`,
    resolved,
    `${resolved}.ts`,
    path.join(resolved, "index.ts"),
  ];
  for (const candidate of candidates) {
    if (candidate.startsWith(SRC_ROOT)) return toRepoPath(candidate);
  }
  return undefined;
}

function toRepoPath(absolutePath: string): string {
  return path.relative(process.cwd(), absolutePath).split(path.sep).join("/");
}
