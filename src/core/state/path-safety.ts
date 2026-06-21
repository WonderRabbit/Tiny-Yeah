// Tiny-Yeah path-safety primitive (SPEC-TINY-YEAH-001 REQ-TY-007, plan.md §2 Phase 1).
//
// Ported verbatim in behavior from Tiny-Chu `src/state/path-safety.ts`. Combines:
//   - lexical (string) check: resolvePathInsideRoot / isPathInsideRoot / isLexicallyInsideRoot
//   - realpath (filesystem) check: resolveExistingPathInsideRoot
//   - Windows absolute-path handling via WINDOWS_ABSOLUTE regex + win32 resolver branch
//
// Outside-root candidates -> undefined (lexical) or undefined (realpath, when symlink escapes).
// `..`-escape attempts -> undefined. Windows-absolute candidates -> routed through win32.
// Symlink whose realpath escapes root -> undefined; symlink whose realpath stays inside -> allowed.
// realpath ENOENT on a lexically-valid candidate is PROPAGATED (not swallowed) — caller decides.

import { realpath } from "node:fs/promises";
import path from "node:path";

const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/;

function isWindowsAbsolute(filePath: string): boolean {
  return WINDOWS_ABSOLUTE.test(filePath);
}

function isSafeRelative(relative: string): boolean {
  return (
    relative === "" ||
    !(
      relative === ".." ||
      relative.startsWith("../") ||
      relative.startsWith("..\\") ||
      WINDOWS_ABSOLUTE.test(relative)
    )
  );
}

export function resolvePathInsideRoot(root: string, candidate: string): string | undefined {
  if (isWindowsAbsolute(root) || isWindowsAbsolute(candidate)) {
    const absoluteRoot = path.win32.resolve(root);
    const absoluteCandidate = path.win32.resolve(absoluteRoot, candidate);
    const relative = path.win32.relative(absoluteRoot, absoluteCandidate);
    return isSafeRelative(relative) ? absoluteCandidate : undefined;
  }
  const absoluteRoot = path.resolve(root);
  const absoluteCandidate = path.resolve(absoluteRoot, candidate);
  const relative = path.relative(absoluteRoot, absoluteCandidate);
  return isSafeRelative(relative) ? absoluteCandidate : undefined;
}

export function isPathInsideRoot(root: string, candidate: string): boolean {
  return resolvePathInsideRoot(root, candidate) !== undefined;
}

export function isLexicallyInsideRoot(root: string, candidate: string): boolean {
  return resolvePathInsideRoot(root, candidate) !== undefined;
}

export async function resolveExistingPathInsideRoot(
  root: string,
  candidate: string,
): Promise<string | undefined> {
  const lexical = resolvePathInsideRoot(root, candidate);
  if (!lexical) return undefined;
  const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(lexical)]);
  const relative = path.relative(realRoot, realCandidate);
  return isSafeRelative(relative) ? realCandidate : undefined;
}
