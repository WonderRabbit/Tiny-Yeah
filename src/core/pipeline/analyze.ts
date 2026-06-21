// Tiny-Yeah analyze stage — the SINGLE builtin TS AST analysis engine (REQ-TY-017, REQ-TY-018).
// Ported from Tinker.Gen `builtin-provider.ts` but Tiny-Yeah's OWN inventory schema
// (`tiny-yeah.inventory.v1`, not Tinker's) and a built-in .gitignore matcher (no `ignore` dep —
// Tiny-Yeah runtime is zod-only per CLAUDE.md). REQ-TY-018: there is NO external graph-tool path,
// NO external binary spawn, NO provider-selection branch. This is the ONLY analysis engine.

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import ts from "typescript";
import { z } from "zod";

export const diagnosticSchema = z.object({
  level: z.enum(["info", "warning", "error"]),
  code: z.string().min(1),
  message: z.string().min(1),
});

export const inventorySchema = z.object({
  schemaVersion: z.literal("tiny-yeah.inventory.v1"),
  providerId: z.literal("builtin"),
  providerVersion: z.string().min(1),
  artifactSchemaVersion: z.literal("tiny-yeah.analysis-artifacts.v1"),
  command: z.literal("tiny-yeah analyze"),
  cwd: z.string().min(1),
  projectPath: z.string().min(1),
  timestamp: z.string().min(1),
  indexed: z.object({ fileCount: z.number().int().nonnegative() }),
  diagnostics: z.array(diagnosticSchema),
  sourceRefs: z.array(z.object({ path: z.string().min(1), kind: z.string().min(1) })),
  files: z.array(
    z.object({
      path: z.string().min(1),
      language: z.string().min(1),
      bytes: z.number().int().nonnegative(),
    }),
  ),
  languageCounts: z.record(z.string(), z.number().int().nonnegative()),
  packageManifests: z.array(
    z.object({
      path: z.string().min(1),
      name: z.string().optional(),
      version: z.string().optional(),
      type: z.string().optional(),
    }),
  ),
  importGraph: z.object({
    nodes: z.array(z.string().min(1)),
    edges: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })),
  }),
});

export type Diagnostic = z.infer<typeof diagnosticSchema>;
export type Inventory = z.infer<typeof inventorySchema>;

const PROVIDER_VERSION = "0.1.0";

// Directories never traversed during analysis. These are well-known build/output/dependency
// dirs. REQ-TY-018: there is NO external-graph-tool directory concept here; Tiny-Yeah's single
// builtin engine walks source directly.
const SKIPPED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".tiny-yeah",
  ".tinker",
  ".omo",
]);

const packageJsonSchema = z
  .object({
    name: z.string().optional(),
    version: z.string().optional(),
    type: z.string().optional(),
  })
  .passthrough();

type FileEntry = Inventory["files"][number];
type PackageManifest = Inventory["packageManifests"][number];
type ImportEdge = Inventory["importGraph"]["edges"][number];

/**
 * Analyze a project at `projectPath` using the SINGLE builtin TS AST engine. REQ-TY-017: the
 * only analysis path. REQ-TY-018: no external graph tool, no external binary, no provider branch.
 */
export async function analyzeProject(projectPath: string): Promise<Inventory> {
  const gitignore = await loadGitignore(projectPath);
  const files = await collectFiles(projectPath, projectPath, gitignore);
  const packageManifests = await collectPackageManifests(projectPath, files);
  const importGraph = await collectImportGraph(projectPath, files);

  return {
    schemaVersion: "tiny-yeah.inventory.v1",
    providerId: "builtin",
    providerVersion: PROVIDER_VERSION,
    artifactSchemaVersion: "tiny-yeah.analysis-artifacts.v1",
    command: "tiny-yeah analyze",
    cwd: process.cwd(),
    projectPath,
    timestamp: new Date().toISOString(),
    indexed: { fileCount: files.length },
    diagnostics: [],
    sourceRefs: files.map((file) => ({ path: file.path, kind: "file" })),
    files,
    languageCounts: languageCounts(files),
    packageManifests,
    importGraph,
  };
}

async function loadGitignore(projectPath: string): Promise<GitignoreMatcher> {
  const matcher = new GitignoreMatcher();
  const gitignorePath = join(projectPath, ".gitignore");
  try {
    const content = await readFile(gitignorePath, "utf8");
    matcher.add(content);
  } catch (error) {
    if (!isEnoent(error)) throw error;
    // No .gitignore — matcher matches nothing, which is correct.
  }
  return matcher;
}

async function collectFiles(
  root: string,
  current: string,
  matcher: GitignoreMatcher,
): Promise<FileEntry[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const collected: FileEntry[] = [];
  for (const entry of entries) {
    const absolute = join(current, entry.name);
    const relativePath = relative(root, absolute);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name) && !matcher.matches(`${relativePath}/`)) {
        collected.push(...(await collectFiles(root, absolute, matcher)));
      }
      continue;
    }
    if (entry.isFile() && !matcher.matches(relativePath)) {
      const info = await stat(absolute);
      collected.push({
        path: relativePath,
        language: languageForPath(entry.name),
        bytes: info.size,
      });
    }
  }
  return collected.sort((left, right) => left.path.localeCompare(right.path));
}

function languageForPath(filePath: string): string {
  const extension = extname(filePath);
  if (extension === ".ts" || extension === ".tsx") return "TypeScript";
  if (extension === ".js" || extension === ".jsx" || extension === ".mjs" || extension === ".cjs") {
    return "JavaScript";
  }
  if (basename(filePath) === "package.json" || extension === ".json") return "JSON";
  return "Other";
}

function languageCounts(files: readonly FileEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of files) {
    counts[file.language] = (counts[file.language] ?? 0) + 1;
  }
  return counts;
}

async function collectPackageManifests(
  root: string,
  files: readonly FileEntry[],
): Promise<PackageManifest[]> {
  const manifests: PackageManifest[] = [];
  for (const file of files) {
    if (basename(file.path) !== "package.json") continue;
    const parsed = packageJsonSchema.safeParse(
      JSON.parse(await readFile(join(root, file.path), "utf8")),
    );
    if (parsed.success) {
      manifests.push({
        path: file.path,
        name: parsed.data.name,
        version: parsed.data.version,
        type: parsed.data.type,
      });
    }
  }
  return manifests;
}

async function collectImportGraph(
  root: string,
  files: readonly FileEntry[],
): Promise<Inventory["importGraph"]> {
  const nodes = files.filter((file) => isScript(file.path)).map((file) => file.path);
  const edges: ImportEdge[] = [];
  for (const filePath of nodes) {
    const source = await readFile(join(root, filePath), "utf8");
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        edges.push({ from: filePath, to: statement.moduleSpecifier.text });
      }
    }
  }
  return { nodes, edges };
}

function isScript(filePath: string): boolean {
  return [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(extname(filePath));
}

function isEnoent(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error as { code?: string }).code === "ENOENT"
  );
}

/**
 * Minimal built-in .gitignore matcher (no external `ignore` dependency — Tiny-Yeah runtime is
 * zod-only per CLAUDE.md). Supports the common subset: exact paths, glob `*`, directory trailing
 * slash, and negation `!`. Sufficient for analysis-time traversal control; not a full gitignore
 * implementation.
 */
class GitignoreMatcher {
  private readonly patterns: GitignorePattern[] = [];

  add(content: string): void {
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (line === "" || line.startsWith("#")) continue;
      this.patterns.push(parsePattern(line));
    }
  }

  matches(relativePath: string): boolean {
    let ignored = false;
    for (const pattern of this.patterns) {
      if (pattern.test(relativePath)) {
        ignored = !pattern.negate;
      }
    }
    return ignored;
  }
}

type GitignorePattern = {
  readonly negate: boolean;
  readonly dirOnly: boolean;
  readonly test: (relativePath: string) => boolean;
};

function parsePattern(line: string): GitignorePattern {
  let negate = false;
  let body = line;
  if (body.startsWith("!")) {
    negate = true;
    body = body.slice(1);
  }
  let dirOnly = false;
  if (body.endsWith("/")) {
    dirOnly = true;
    body = body.slice(0, -1);
  }
  const regex = globToRegex(body);
  return {
    negate,
    dirOnly,
    test: (relativePath: string) => {
      if (dirOnly && !relativePath.endsWith("/")) {
        // Directory patterns match any path segment that starts with the pattern as a directory.
        return relativePath.startsWith(`${body}/`);
      }
      // Match against the full relative path OR any trailing path segment.
      if (regex.test(relativePath)) return true;
      return relativePath.split("/").some((segment) => regex.test(segment));
    },
  };
}

function globToRegex(glob: string): RegExp {
  // Escape regex metachars except `*`, then convert `*` to `[^/]*`.
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}
