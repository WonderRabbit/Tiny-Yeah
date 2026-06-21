// CHARACTERIZATION: Tiny-Chu donor path-safety invariant.
// Source: ../../Tiny-Chu/src/state/path-safety.ts
//
// Captures the dual lexical + realpath path-safety primitive that REQ-TY-007 will integrate
// (Phase 1). The donor combines string-level (`resolvePathInsideRoot` / `isSafeRelative`) and
// filesystem-level (`resolveExistingPathInsideRoot` via `realpath`) checks, with Windows
// absolute-path handling. These tests pin the OBSERVED contract so the Phase 1 port cannot
// silently regress it.

import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  isLexicallyInsideRoot,
  isPathInsideRoot,
  resolveExistingPathInsideRoot,
  resolvePathInsideRoot,
} from "../../../Tiny-Chu/src/state/path-safety.ts";

describe("Tiny-Chu donor path-safety — lexical checks (resolvePathInsideRoot)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-pathsafety-"));
  });

  it("resolves an inside-root relative path to an absolute inside-root path", () => {
    const resolved = resolvePathInsideRoot(root, "tasks/abc.json");
    expect(resolved).toBe(path.resolve(root, "tasks/abc.json"));
  });

  it("rejects a `..`-escape attempt with undefined (REQ-TY-007 lexical layer)", () => {
    expect(resolvePathInsideRoot(root, "../../etc/passwd")).toBeUndefined();
  });

  it("rejects a bare `..` segment with undefined", () => {
    expect(resolvePathInsideRoot(root, "..")).toBeUndefined();
  });

  it("rejects a backslash `..\\` escape (Windows-style on the lexical regex)", () => {
    // The donor's isSafeRelative explicitly rejects `..\\` prefixes.
    expect(resolvePathInsideRoot(root, "..\\etc")).toBeUndefined();
  });

  it("treats the root itself as inside-root (empty relative)", () => {
    expect(resolvePathInsideRoot(root, ".")).toBe(path.resolve(root));
  });

  it("isPathInsideRoot / isLexicallyInsideRoot agree on inside-root paths", () => {
    expect(isPathInsideRoot(root, "plans/x.md")).toBe(true);
    expect(isLexicallyInsideRoot(root, "plans/x.md")).toBe(true);
    expect(isPathInsideRoot(root, "../escape")).toBe(false);
  });
});

describe("Tiny-Chu donor path-safety — Windows absolute handling", () => {
  it("routes Windows drive-absolute root/candidate through win32 resolver and rejects escapes", () => {
    // Windows-absolute root forces the win32 branch (WINDOWS_ABSOLUTE regex: C:\ or UNC).
    // A drive-relative `..` candidate must still be rejected by isSafeRelative.
    const resolved = resolvePathInsideRoot("C:\\root", "..\\evil");
    expect(resolved).toBeUndefined();
  });

  it("accepts an inside-root Windows-absolute candidate", () => {
    const resolved = resolvePathInsideRoot("C:\\root", "tasks\\abc.json");
    expect(resolved).toBe("C:\\root\\tasks\\abc.json");
  });
});

describe("Tiny-Chu donor path-safety — realpath checks (resolveExistingPathInsideRoot)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-pathsafety-real-"));
  });

  it("rejects a symlink whose target resolves outside the root (REQ-TY-007 realpath layer)", async () => {
    // root/escape -> /tmp/outside  (outside root)
    const outside = await mkdtemp(path.join(tmpdir(), "ty-pathsafety-out-"));
    await mkdir(path.join(root, "inside"), { recursive: true });
    await symlink(outside, path.join(root, "inside", "escape"), "dir");
    // The lexical check passes (escape is "inside" root), but realpath resolves outside.
    const result = await resolveExistingPathInsideRoot(root, "inside/escape");
    expect(result).toBeUndefined();
  });

  it("allows a symlink whose target resolves inside the root", async () => {
    // root/real_dir  +  root/link -> root/real_dir  (inside root)
    await mkdir(path.join(root, "real_dir"), { recursive: true });
    await symlink(path.join(root, "real_dir"), path.join(root, "link"), "dir");
    const result = await resolveExistingPathInsideRoot(root, "link");
    expect(result).toBeDefined();
  });

  it("propagates realpath ENOENT for a nonexistent candidate (donor does NOT swallow it)", async () => {
    // CHARACTERIZATION NOTE: the donor's resolveExistingPathInsideRoot calls realpath(lexical)
    // directly. A nonexistent candidate that passes the lexical check propagates ENOENT rather
    // than returning undefined. Phase 1's integrated path-safety module must decide whether to
    // preserve this or soften it; pin the CURRENT behavior here.
    await expect(resolveExistingPathInsideRoot(root, "nope.json")).rejects.toThrow();
  });

  it("rejects a lexical escape before touching the filesystem", async () => {
    const result = await resolveExistingPathInsideRoot(root, "../escape");
    expect(result).toBeUndefined();
  });
});
