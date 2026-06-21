// UNIT: Tiny-Yeah path-safety (SPEC-TINY-YEAH-001 REQ-TY-007, plan.md §2 Phase 1).
// Pins the lexical + realpath dual check ported from Tiny-Chu. Parity with the donor
// characterization on the OBSERVED contract, against Tiny-Yeah's own port.

import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  isLexicallyInsideRoot,
  isPathInsideRoot,
  resolveExistingPathInsideRoot,
  resolvePathInsideRoot,
} from "../../src/core/state/path-safety.js";

describe("path-safety — lexical checks (resolvePathInsideRoot)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-yeah-pathsafety-"));
  });

  it("resolves an inside-root relative path to an absolute inside-root path", () => {
    expect(resolvePathInsideRoot(root, "tasks/abc.json")).toBe(
      path.resolve(root, "tasks/abc.json"),
    );
  });

  it("rejects a `..`-escape attempt with undefined", () => {
    expect(resolvePathInsideRoot(root, "../../etc/passwd")).toBeUndefined();
  });

  it("rejects a bare `..` segment with undefined", () => {
    expect(resolvePathInsideRoot(root, "..")).toBeUndefined();
  });

  it("rejects a backslash `..\\` escape", () => {
    expect(resolvePathInsideRoot(root, "..\\etc")).toBeUndefined();
  });

  it("treats the root itself as inside-root (empty/`.` relative)", () => {
    expect(resolvePathInsideRoot(root, ".")).toBe(path.resolve(root));
  });

  it("isPathInsideRoot / isLexicallyInsideRoot agree on inside-root paths", () => {
    expect(isPathInsideRoot(root, "plans/x.md")).toBe(true);
    expect(isLexicallyInsideRoot(root, "plans/x.md")).toBe(true);
    expect(isPathInsideRoot(root, "../escape")).toBe(false);
  });
});

describe("path-safety — Windows absolute handling", () => {
  it("routes a Windows drive-absolute root through the win32 branch and rejects escapes", () => {
    expect(resolvePathInsideRoot("C:\\root", "..\\evil")).toBeUndefined();
  });

  it("accepts an inside-root Windows-absolute candidate", () => {
    expect(resolvePathInsideRoot("C:\\root", "tasks\\abc.json")).toBe("C:\\root\\tasks\\abc.json");
  });
});

describe("path-safety — realpath checks (resolveExistingPathInsideRoot)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-yeah-pathsafety-real-"));
  });

  it("rejects a symlink whose target resolves outside the root", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "ty-yeah-pathsafety-out-"));
    await mkdir(path.join(root, "inside"), { recursive: true });
    await symlink(outside, path.join(root, "inside", "escape"), "dir");
    expect(await resolveExistingPathInsideRoot(root, "inside/escape")).toBeUndefined();
  });

  it("allows a symlink whose target resolves inside the root", async () => {
    await mkdir(path.join(root, "real_dir"), { recursive: true });
    await symlink(path.join(root, "real_dir"), path.join(root, "link"), "dir");
    expect(await resolveExistingPathInsideRoot(root, "link")).toBeDefined();
  });

  it("propagates realpath ENOENT for a nonexistent lexically-valid candidate (not swallowed)", async () => {
    await expect(resolveExistingPathInsideRoot(root, "nope.json")).rejects.toThrow();
  });

  it("rejects a lexical escape before touching the filesystem", async () => {
    expect(await resolveExistingPathInsideRoot(root, "../escape")).toBeUndefined();
  });
});
