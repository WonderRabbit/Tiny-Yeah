// Tiny-Yeah source-graph — ported from ui_pop `src/source-graph/source-graph.ts`.
// DIFFERENCE from donor: the entry extension is PARAMETERIZED (donor hardcodes `.tsx`) so the
// graph stays framework-agnostic — Tiny-Yeah's core pipeline does not assume React/Next.
// Bounded import-graph: depth-limited (maxDepth), file-limited (maxFiles), relative-import-only.

import { access, readFile } from "node:fs/promises";
import * as path from "node:path";

export type SourceGraphOptions = {
  readonly entry: string;
  /** Allowed entry-file extensions (e.g. [".tsx"] for React screens, [".ts"] for plain modules). */
  readonly entryExtensions: readonly string[];
  readonly maxDepth: number;
  readonly maxFiles: number;
};

export type SourceGraphResult = {
  readonly entry: string;
  readonly files: readonly string[];
  readonly truncated: boolean;
};

export type SourceGraphErrorCode =
  | "ERR_UNSUPPORTED_ENTRY"
  | "ERR_MALFORMED_TSX"
  | "ERR_GRAPH_DEPTH_EXCEEDED"
  | "ERR_GRAPH_FILE_LIMIT_EXCEEDED";

export type SourceGraphFailure = {
  readonly ok: false;
  readonly code: SourceGraphErrorCode;
  readonly message: string;
};

export type SourceGraphSuccess = {
  readonly ok: true;
  readonly graph: SourceGraphResult;
};

export type SourceGraphBuildResult = SourceGraphSuccess | SourceGraphFailure;

export async function buildSourceGraph(
  options: SourceGraphOptions,
): Promise<SourceGraphBuildResult> {
  if (!options.entryExtensions.includes(path.extname(options.entry))) {
    return failure(
      "ERR_UNSUPPORTED_ENTRY",
      `Entry extension ${path.extname(options.entry)} is not in the allowed set: ${options.entryExtensions.join(", ")}`,
    );
  }

  const source = await readFile(options.entry, "utf8");
  if (options.entryExtensions.includes(".tsx") && !looksLikeTsx(source)) {
    return failure("ERR_MALFORMED_TSX", "Entry file does not contain parseable TSX screen markup.");
  }

  if (options.maxDepth < 1) {
    return failure("ERR_GRAPH_DEPTH_EXCEEDED", "Import graph maxDepth must be at least 1.");
  }

  if (options.maxFiles < 1) {
    return failure("ERR_GRAPH_FILE_LIMIT_EXCEEDED", "Import graph maxFiles must be at least 1.");
  }

  const graph = await collectGraph(
    options.entry,
    options.entryExtensions,
    options.maxDepth,
    options.maxFiles,
  );
  if (!graph.ok) {
    return graph;
  }

  return {
    graph: {
      entry: options.entry,
      files: graph.files,
      truncated: graph.truncated,
    },
    ok: true,
  };
}

type GraphCollection =
  | {
      readonly ok: true;
      readonly files: readonly string[];
      readonly truncated: boolean;
    }
  | SourceGraphFailure;

async function collectGraph(
  entry: string,
  entryExtensions: readonly string[],
  maxDepth: number,
  maxFiles: number,
): Promise<GraphCollection> {
  const visited = new Set<string>();
  const files: string[] = [];
  let truncated = false;

  async function walk(file: string, depth: number): Promise<SourceGraphFailure | undefined> {
    if (visited.has(file)) {
      return undefined;
    }
    if (files.length >= maxFiles) {
      return failure("ERR_GRAPH_FILE_LIMIT_EXCEEDED", "Import graph file limit was exceeded.");
    }

    visited.add(file);
    files.push(file);

    const source = await readFile(file, "utf8");
    const imports = findRelativeImports(source);

    if (depth >= maxDepth) {
      // Truncation only signals ACTUAL elision: if this file has further relative imports
      // that we cannot descend into because the depth budget is exhausted. This avoids
      // false-positive truncation flags on leaf files that happen to sit at maxDepth.
      if (imports.length > 0) {
        truncated = true;
      }
      return undefined;
    }

    for (const specifier of imports) {
      const resolved = await resolveImport(file, specifier, entryExtensions);
      if (resolved === undefined) {
        continue;
      }
      const failureResult = await walk(resolved, depth + 1);
      if (failureResult !== undefined) {
        return failureResult;
      }
    }

    return undefined;
  }

  const failureResult = await walk(entry, 1);
  if (failureResult !== undefined) {
    return failureResult;
  }

  return { files, ok: true, truncated };
}

function findRelativeImports(source: string): readonly string[] {
  const imports: string[] = [];
  const importPattern = /import\s+(?:[^'"]+\s+from\s+)?["'](\.[^"']+)["']/g;
  let match = importPattern.exec(source);

  while (match !== null) {
    const specifier = match[1];
    if (specifier !== undefined) {
      imports.push(specifier);
    }
    match = importPattern.exec(source);
  }

  return imports;
}

async function resolveImport(
  fromFile: string,
  specifier: string,
  entryExtensions: readonly string[],
): Promise<string | undefined> {
  const rawBase = path.normalize(path.join(path.dirname(fromFile), specifier));
  // NodeNext convention: relative specifiers carry a `.js` extension that points at a sibling
  // `.ts` file. Strip a trailing `.js`/`.mjs`/`.cjs` so the extension-appended candidates resolve.
  const stripped = rawBase.replace(/\.(?:mjs|cjs|js)$/, "");
  const candidates = [
    rawBase,
    stripped,
    ...entryExtensions.flatMap((ext) => [`${stripped}${ext}`]),
    ...entryExtensions.flatMap((ext) => [path.join(stripped, `index${ext}`)]),
  ];

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error instanceof Error) {
      return false;
    }
    throw error;
  }
}

function looksLikeTsx(source: string): boolean {
  return (
    /<[A-Za-z][\s\S]*>/.test(source) &&
    /export\s+default|export\s+function|const\s+\w+/.test(source)
  );
}

function failure(code: SourceGraphErrorCode, message: string): SourceGraphFailure {
  return {
    code,
    message,
    ok: false,
  };
}
