// Import-graph scanner helper for installer-firewall tests (SPEC-TINY-YEAH-002 REQ-TY2-004/005).
//
// A small, dependency-free static ESM import-graph scanner. It parses .ts files for static
// import/export specifiers, resolves relative specifiers (`./`, `../`) to module paths within an
// arbitrary root, and walks the transitive closure. Bare specifiers (e.g. `zod`, `node:fs`,
// `jsonc-parser`, `@opencode-ai/plugin`) are treated as EXTERNAL and NOT followed — only the
// internal module graph is closed over.
//
// This is used by tests/unit/installer-firewall.test.ts to mechanically enforce the seven
// firewall edges (REQ-TY2-004 F1/F2/F3, REQ-TY2-003 MAJOR #4, REQ-TY2-005) — each edge is proven
// non-no-op by a synthetic forbidden fixture that the scanner MUST flag.

import { type Dirent, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Match all static ESM import/export forms and capture the module specifier:
 *   import "pkg"                          (side-effect)
 *   import x from "pkg"                   (default)
 *   import { a, b } from "pkg"            (named)
 *   import * as ns from "pkg"             (namespace)
 *   import type { T } from "pkg"          (type-only)
 *   export { x } from "pkg"               (re-export)
 *   export * from "pkg"                   (wildcard re-export)
 *   export type { T } from "pkg"          (type-only re-export)
 *
 * Dynamic `import("...")` is intentionally NOT matched here — the bin's dynamic-import bootstrap
 * is the exception (documented in the firewall test), and dynamic imports are not part of the
 * static graph reachability the firewall enforces.
 */
const STATIC_IMPORT_RE =
  /(?:import|export)\b[^"'"]*?\bfrom\s*["']([^"']+)["']|(?:import|export)\s*["']([^"']+)["']/g;

/**
 * Strip `//` line comments and `/* ... *\/` block comments from TS source. String literals are
 * preserved — the firewall write-ban scan wants to flag string literals containing forbidden
 * path segments (they could be runtime path targets).
 *
 * A small state machine walks the source char-by-char, tracking whether we are inside a string
 * (single/double/backtick) so comment markers inside strings are not treated as comments.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    // Handle string state transitions first so comment markers inside strings are literal.
    if (!inSingle && !inDouble && !inBacktick) {
      if (ch === "/" && next === "/") {
        // Skip to end of line.
        const nl = source.indexOf("\n", i);
        const end = nl === -1 ? source.length : nl;
        i = end;
        continue;
      }
      if (ch === "/" && next === "*") {
        const close = source.indexOf("*/", i + 2);
        const end = close === -1 ? source.length : close + 2;
        i = end;
        continue;
      }
      if (ch === "'") inSingle = true;
      else if (ch === '"') inDouble = true;
      else if (ch === "`") inBacktick = true;
      out += ch;
      i += 1;
      continue;
    }
    // Inside a string: copy until the closing quote (respect backslash escapes).
    if (inSingle && ch === "\\") {
      out += ch + (next ?? "");
      i += 2;
      continue;
    }
    if (inDouble && ch === "\\") {
      out += ch + (next ?? "");
      i += 2;
      continue;
    }
    if (inBacktick && ch === "\\") {
      out += ch + (next ?? "");
      i += 2;
      continue;
    }
    if (inSingle && ch === "'") inSingle = false;
    else if (inDouble && ch === '"') inDouble = false;
    else if (inBacktick && ch === "`") inBacktick = false;
    out += ch;
    i += 1;
  }
  return out;
}

/** Extract static import/export specifiers from a TS source string (after comment stripping). */
export function extractSpecifiers(strippedSource: string): string[] {
  const specs: string[] = [];
  for (const match of strippedSource.matchAll(STATIC_IMPORT_RE)) {
    const spec = (match[1] ?? match[2]) as string | undefined;
    if (spec !== undefined) specs.push(spec);
  }
  return specs;
}

/** Recursively list every `.ts` file under a directory. Returns absolute, sorted paths. */
export function listTsFilesSync(directory: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTsFilesSync(child));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(child);
    }
  }
  return files.sort();
}

/**
 * Resolve a relative specifier (`./`, `../`) from an importer file to an absolute module path.
 * Honors NodeNext ESM conventions: `./foo` and `./foo.js` both resolve to `foo.ts`. Returns the
 * resolved absolute path, or undefined when no candidate exists on disk.
 *
 * Bare specifiers (anything that does not start with `./` or `../`) return undefined — they are
 * external to the internal module graph and not followed by the closure walker.
 */
export function resolveRelative(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return undefined;
  }
  const importerDir = path.dirname(importer);
  const base = path.resolve(importerDir, specifier);
  // NodeNext ESM conventions: `./foo` resolves to foo.ts; `./foo.js` ALSO resolves to foo.ts (the
  // `.js` in the specifier is the emitted output path, but the source is `.ts`). When `base` ends
  // in `.js`/`.mjs`/`.cjs`, generate the `.ts`/`.mts`/`.cts` sibling candidate.
  const extSwapped: string[] = [];
  if (base.endsWith(".js")) extSwapped.push(`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`);
  if (base.endsWith(".mjs")) extSwapped.push(`${base.slice(0, -4)}.mts`);
  if (base.endsWith(".cjs")) extSwapped.push(`${base.slice(0, -4)}.cts`);
  const candidates = [
    ...extSwapped,
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    path.join(base, "index.js"),
  ];
  // Deduplicate (specifier "./foo" and "./foo.ts" can produce overlapping candidates).
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      // Use readFileSync as an existence probe (no separate stat call needed).
      readFileSync(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

/** A single forbidden import edge: importer reached target via a chain starting at a seed. */
export interface ImportViolation {
  readonly seed: string;
  readonly importer: string;
  readonly specifier: string;
  /** Absolute path of the resolved target module (undefined for bare specifiers). */
  readonly resolvedTarget?: string;
}

/** Memoized cache for extractSpecifiers (file path → specifiers). */
type SpecCache = Map<string, string[]>;

/**
 * Compute the transitive closure of internally-reachable modules starting from a seed set. Returns
 * the set of absolute module paths reachable from any seed via relative imports.
 *
 * Bare specifiers are NOT followed. Cycles are handled via a visited set.
 */
export function transitiveClosure(
  seeds: readonly string[],
  cache?: SpecCache,
): { reached: Set<string>; specCache: SpecCache } {
  const specCache = cache ?? new Map<string, string[]>();
  const reached = new Set<string>();
  const queue: string[] = [...seeds];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (reached.has(current)) continue;
    reached.add(current);
    let specs = specCache.get(current);
    if (specs === undefined) {
      let raw: string;
      try {
        raw = readFileSync(current, "utf8");
      } catch {
        specs = [];
        specCache.set(current, specs);
        continue;
      }
      specs = extractSpecifiers(stripComments(raw));
      specCache.set(current, specs);
    }
    for (const spec of specs) {
      const resolved = resolveRelative(current, spec);
      if (resolved !== undefined && !reached.has(resolved)) {
        queue.push(resolved);
      }
    }
  }
  return { reached, specCache };
}

/**
 * Walk a seed set's transitive closure and return every import edge whose resolved target falls
 * under one of the forbidden target directories. This is the core firewall primitive.
 *
 * @param seedFiles  absolute paths of seed .ts modules (the closure starts here)
 * @param forbiddenDirs absolute directory prefixes; a target under any of these is a violation
 */
export function findForbiddenEdges(
  seedFiles: readonly string[],
  forbiddenDirs: readonly string[],
): ImportViolation[] {
  const specCache: SpecCache = new Map();
  const violations: ImportViolation[] = [];
  const visited = new Set<string>();
  // Track which seed each reachable module descends from, for the violation report.
  const seedOf = new Map<string, string>();
  const queue: Array<{ file: string; seed: string }> = [];
  for (const seed of seedFiles) {
    queue.push({ file: seed, seed });
    seedOf.set(seed, seed);
  }
  while (queue.length > 0) {
    const { file, seed } = queue.pop() as { file: string; seed: string };
    if (visited.has(file)) continue;
    visited.add(file);
    let specs = specCache.get(file);
    if (specs === undefined) {
      let raw: string;
      try {
        raw = readFileSync(file, "utf8");
      } catch {
        specCache.set(file, []);
        continue;
      }
      specs = extractSpecifiers(stripComments(raw));
      specCache.set(file, specs);
    }
    for (const spec of specs) {
      const resolved = resolveRelative(file, spec);
      if (resolved === undefined) continue;
      const isForbidden = forbiddenDirs.some(
        (dir) =>
          resolved === dir ||
          resolved.startsWith(`${dir}${path.sep}`) ||
          resolved.startsWith(`${dir}/`),
      );
      if (isForbidden) {
        violations.push({ seed, importer: file, specifier: spec, resolvedTarget: resolved });
      }
      if (!visited.has(resolved)) {
        seedOf.set(resolved, seed);
        queue.push({ file: resolved, seed });
      }
    }
  }
  return violations;
}
