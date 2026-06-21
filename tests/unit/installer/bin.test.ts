// UNIT: bin/tiny-yeah.js hermeticity + CLI contract (SPEC-TINY-YEAH-002 REQ-TY2-018).
//
// Exercises the dep-free installer bin via child_process. Proves:
//   - --version resolves the package version (REQ-TY2-018 bin scaffold note).
//   - --help prints usage covering all four subcommands.
//   - doctor is implemented (Phase 4): runs diagnostics end-to-end. The deeper E2E coverage
//     lives in bin-doctor.test.ts; this file asserts doctor is wired (not a Phase-4 stub).
//     install/update/uninstall are implemented (Phases 2–3) and have dedicated E2E tests.
//   - HERMETICITY (REQ-TY2-018 AC): the bin runs from a tmpdir with NO node_modules — it
//     imports only node: built-ins, so `node bin/tiny-yeah.js --version` succeeds there.
//   - the bin source itself imports ONLY `node:` specifiers (AST/grep check, inventory risk 8).

import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const binPath = path.join(repoRoot, "bin", "tiny-yeah.js");
const packageJsonPath = path.join(repoRoot, "package.json");

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version: string };
const EXPECTED_VERSION = packageJson.version;

describe("bin/tiny-yeah.js — Phase 0 CLI contract", () => {
  it("--version resolves the package version from adjacent manifest/package.json", async () => {
    // Run from the repo root: bin resolves ../package.json (repo layout).
    const { stdout } = await execFileAsync("node", [binPath, "--version"], { cwd: repoRoot });
    expect(stdout.trim()).toBe(EXPECTED_VERSION);
  });

  it("--help prints usage covering all four subcommands", async () => {
    const { stdout } = await execFileAsync("node", [binPath, "--help"], { cwd: repoRoot });
    const text = stdout;
    expect(text).toContain("Usage:");
    for (const sub of ["install", "update", "doctor", "uninstall"]) {
      expect(text).toContain(sub);
    }
    // Global flags appear in help.
    for (const flag of ["--project", "--bundle", "--force", "--dry-run", "--json", "--yes"]) {
      expect(text).toContain(flag);
    }
  });

  // Phase 4 implemented doctor. doctor runs diagnostics end-to-end; the deeper E2E coverage lives
  // in bin-doctor.test.ts. Here we just assert doctor is now wired (not a Phase-4 stub) by running
  // it against a bare tmpdir: it completes with a categorized report (exit 0, no "not implemented").
  it("doctor is implemented (runs diagnostics, exits 0 on a bare project)", async () => {
    const tmp = await mkdtemp(
      path.join(path.parse(binPath).root === "/" ? "/tmp" : repoRoot, "ty2-bin-doctor-impl-"),
    );
    try {
      const result = (await execFileAsync("node", [binPath, "doctor", "--project", tmp], {
        cwd: repoRoot,
        reject: false,
      }).catch((error: unknown) => error)) as {
        code?: number;
        stderr: string;
        stdout: string;
      };
      // On success execFileAsync resolves with {stdout, stderr} (no code); on failure the error
      // carries `.code`. Normalize: code absent = exit 0.
      const code = typeof result.code === "number" ? result.code : 0;
      expect(code, `stderr: ${result.stderr}`).toBe(0);
      expect(result.stderr).not.toContain("not implemented");
      expect(result.stdout).toContain("doctor");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("install without a bundle is rejected with exit 2 (bundle not found)", async () => {
    // Run from a tmpdir with no manifest.json so resolveBundleDir returns undefined.
    const tmp = await mkdtemp(
      path.join(path.parse(binPath).root === "/" ? "/tmp" : repoRoot, "ty2-bin-nobundle-"),
    );
    try {
      const result = (await execFileAsync("node", [binPath, "install", "--project", tmp], {
        cwd: tmp,
        reject: false,
      }).catch((error: unknown) => error)) as { code: number; stderr: string };
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("could not locate the offline bundle");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects unknown subcommands with exit 2", async () => {
    const result = (await execFileAsync("node", [binPath, "frobnicate"], {
      cwd: repoRoot,
      reject: false,
    }).catch((error: unknown) => error)) as { code: number; stderr: string };
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("unknown command");
  });

  it("rejects unknown flags with exit 2", async () => {
    const result = (await execFileAsync("node", [binPath, "install", "--bogus"], {
      cwd: repoRoot,
      reject: false,
    }).catch((error: unknown) => error)) as { code: number; stderr: string };
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("unknown flag");
  });

  it("no command given -> exit 2 with usage hint", async () => {
    const result = (await execFileAsync("node", [binPath], {
      cwd: repoRoot,
      reject: false,
    }).catch((error: unknown) => error)) as { code: number; stderr: string };
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("no command given");
  });
});

// REQ-TY2-018 AC: the bin MUST be dependency-free. This runs the bin from a tmpdir that has
// NO node_modules anywhere on its resolution path, proving only node: built-ins are needed.
describe("bin/tiny-yeah.js — hermeticity (REQ-TY2-018)", () => {
  let hermeticDir: string;

  beforeAll(async () => {
    hermeticDir = await mkdtemp(
      path.join(path.parse(binPath).root === "/" ? "/tmp" : repoRoot, "tiny-yeah-bin-hermetic-"),
    );
    // Copy ONLY the bin into the bare dir. NO node_modules, NO package.json adjacent at first.
    await mkdir(path.join(hermeticDir, "bin"), { recursive: true });
    await copyFile(binPath, path.join(hermeticDir, "bin", "tiny-yeah.js"));
    // Stage a manifest.json at the hermetic dir root so --version has an authoritative source
    // (mirrors the bundle layout: manifest.json sits next to bin/tiny-yeah.js at bundle root).
    await writeFile(
      path.join(hermeticDir, "manifest.json"),
      `${JSON.stringify({ version: EXPECTED_VERSION }, null, 2)}\n`,
    );
  });

  afterAll(async () => {
    await rm(hermeticDir, { recursive: true, force: true });
  });

  it("runs --version with NO node_modules on the resolution path", async () => {
    // Run from the hermetic dir. The bin's BIN_DIR = hermeticDir/bin; manifest.json is at
    // hermeticDir/manifest.json (parent of bin). No node_modules exists anywhere here.
    const { stdout } = await execFileAsync(
      "node",
      [path.join("bin", "tiny-yeah.js"), "--version"],
      {
        cwd: hermeticDir,
      },
    );
    expect(stdout.trim()).toBe(EXPECTED_VERSION);
  });

  it("runs install subcommand hermetically (lifecycle-not-found error, NOT a module-resolution crash)", async () => {
    const result = (await execFileAsync(
      "node",
      [path.join("bin", "tiny-yeah.js"), "install", "--dry-run", "--project", hermeticDir],
      {
        cwd: hermeticDir,
        reject: false,
      },
    ).catch((error: unknown) => error)) as { code: number; stderr: string; stdout: string };
    // The hermetic dir stages a manifest.json (for --version) so resolveBundleDir SUCCEEDS, but
    // there is no dist/head/installer/lifecycle.js to dynamically import. The bin MUST surface
    // this as a clean "lifecycle not found" message and exit 1 — NOT a "Cannot find module"
    // crash from a non-hermetic dependency leak (REQ-TY2-018 AC).
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("installer lifecycle not found");
    expect(result.stderr).not.toContain("Cannot find module");
  });
});

// REQ-TY2-018 AC: bin source imports ONLY `node:` specifiers. Static grep over the bin file
// catches any future leak of commander/zod/jsonc-parser (inventory risk 8).
describe("bin/tiny-yeah.js — source imports only node: built-ins", () => {
  it("has no non-node: imports", async () => {
    const source = await readFile(binPath, "utf8");
    const importSpecifiers: string[] = [];
    const pattern =
      /(?:import|export)\b[^"']*?\bfrom\s*["']([^"']+)["']|(?:import|export)\s*["']([^"']+)["']/g;
    for (const match of source.matchAll(pattern)) {
      const spec = (match[1] ?? match[2]) as string | undefined;
      if (spec !== undefined) importSpecifiers.push(spec);
    }
    // Sanity: the bin has at least the 3 known static imports (node:fs, node:path, node:url).
    // This guards against a broken regex that matches nothing and false-passes.
    expect(importSpecifiers.length).toBeGreaterThanOrEqual(3);
    for (const spec of importSpecifiers) {
      expect(spec.startsWith("node:")).toBe(true);
    }
    // Explicit guardrails: these MUST NOT appear as imported specifiers.
    for (const forbidden of ["commander", "zod", "jsonc-parser"]) {
      const importLine = new RegExp(`(?:from|require\\()\\s*["']${forbidden}(?:/|["'])`);
      expect(importLine.test(source)).toBe(false);
    }
  });
});
