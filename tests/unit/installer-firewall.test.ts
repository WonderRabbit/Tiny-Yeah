// UNIT: installer-firewall (SPEC-TINY-YEAH-002 REQ-TY2-004/005/018/003, strategy §8).
//
// ARCHITECTURE FIREWALL — seven mechanically-enforced edges. Each edge is proven non-no-op via
// a synthetic forbidden fixture: a tmpdir tree containing the forbidden construct is fed to the
// SAME scanner used on the real src/ tree, and the test asserts the scanner flags it. This is
// the "detector is not a no-op" proof — if the scanner silently accepted the forbidden tree, the
// real-src assertion would be vacuous.
//
// EDGE 1 (model-contract → installer, transitive closure, REQ-TY2-004 F1):
//   No module under src/model-contract/** may transitively import any module under
//   src/head/installer/**. Catches barrel re-export leakage.
// EDGE 2 (plugin-tool-surface → installer, transitive closure, REQ-TY2-004):
//   No module under src/head/opencode/** may transitively import src/head/installer/**.
// EDGE 3 (child_process shell-out bypass, REQ-TY2-004 F2):
//   No module under src/model-contract/** or src/head/opencode/** may spawn/exec/fork
//   bin/tiny-yeah.js / install-offline / head/installer.
// EDGE 4 (core → installer reverse ban, REQ-TY2-004 F3):
//   No module under src/core/** may transitively import src/head/installer/**.
// EDGE 5 (installer → checkpoint ban, REQ-TY2-003):
//   No module under src/head/installer/** may import src/core/checkpoint/preview.ts |
//   apply.ts | universal-write-path.ts (the create-only model-emission path).
// EDGE 6 (installer writes .tiny-yeah/ ban, REQ-TY2-005):
//   No module under src/head/installer/** may contain a write call whose target resolves under
//   .tiny-yeah/ (the installer domain writes only under the project's .opencode/).
// EDGE 7 (lock-store hardwired path, REQ-TY2-003 MAJOR #4):
//   No module under src/head/installer/** may import src/core/state/lock-store.ts (it is
//   hardwired to .tiny-yeah/locks/ — INV-1 violation if reused).
//
// CONTINUING INVARIANTS (kept green):
//   - jsonc-parser confinement (REQ-TY2-008 + REQ-TY2-018): jsonc-parser imported only under
//     head/installer/**, never in bin/tiny-yeah.js.
//   - .tiny-yeah/ write firewall (REQ-TY2-003 MAJOR #4): installer never constructs .tiny-yeah/
//     as a write/lock target.
//
// DYNAMIC-IMPORT EXCEPTION (documented):
//   The bin's dynamic `import()` of the installer lifecycle is the bootstrap and is ALLOWED — it
//   is NOT part of the static graph reachability the firewall enforces (the firewall is about
//   model/plugin/core modules statically reaching installer, plus shell-out string literals).

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractSpecifiers,
  findForbiddenEdges,
  listTsFilesSync,
  resolveRelative,
  stripComments,
} from "../helpers/import-graph.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC_ROOT = path.join(repoRoot, "src");
const BIN_PATH = path.join(repoRoot, "bin", "tiny-yeah.js");
const INSTALLER_DIR = path.join(SRC_ROOT, "head", "installer");
const MODEL_CONTRACT_DIR = path.join(SRC_ROOT, "model-contract");
const OPENCODE_DIR = path.join(SRC_ROOT, "head", "opencode");
const CORE_DIR = path.join(SRC_ROOT, "core");

// ===========================================================================
// EDGE 1 — model-contract → installer (transitive closure, REQ-TY2-004 F1)
// ===========================================================================

describe("installer-firewall — EDGE 1: model-contract → installer transitive closure (F1)", () => {
  it("scanner flags a synthetic barrel re-export leak (detector non-no-op proof)", () => {
    // Build a tmpdir tree that models the forbidden pattern:
    //   model-contract/intent.ts -> barrel.ts
    //   model-contract/barrel.ts -> ../head/installer/index.ts (re-export)
    //   head/installer/index.ts  -> (any content)
    // The scanner MUST flag this as a violation. If it did not, the real-src assertion below
    // would be vacuously green even if the violation existed.
    const tmp = mkdtempSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), ".firewall-edge1-"),
    );
    try {
      mkdirSync(path.join(tmp, "model-contract"), { recursive: true });
      mkdirSync(path.join(tmp, "head", "installer"), { recursive: true });
      writeFileSync(
        path.join(tmp, "model-contract", "intent.ts"),
        `export { x } from "./barrel.js";\n`,
      );
      writeFileSync(
        path.join(tmp, "model-contract", "barrel.ts"),
        `export * from "../head/installer/index.js";\n`,
      );
      writeFileSync(
        path.join(tmp, "head", "installer", "index.ts"),
        `export const LIFECYCLE = 1;\n`,
      );

      const seeds = listTsFilesSync(path.join(tmp, "model-contract"));
      const violations = findForbiddenEdges(seeds, [path.join(tmp, "head", "installer")]);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.some((v) => v.importer.endsWith("barrel.ts"))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("src/model-contract/** does NOT transitively reach src/head/installer/**", () => {
    const seeds = listTsFilesSync(MODEL_CONTRACT_DIR);
    expect(seeds.length).toBeGreaterThan(0);
    const violations = findForbiddenEdges(seeds, [INSTALLER_DIR]);
    expect(
      violations,
      `transitive leak from model-contract to installer:\n${violations.map((v) => `  ${v.importer} (${v.specifier})`).join("\n")}`,
    ).toEqual([]);
  });
});

// ===========================================================================
// EDGE 2 — plugin-tool-surface → installer (transitive closure, REQ-TY2-004)
// ===========================================================================

describe("installer-firewall — EDGE 2: head/opencode → installer transitive closure", () => {
  it("scanner flags a synthetic plugin→installer leak (detector non-no-op proof)", () => {
    const tmp = mkdtempSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), ".firewall-edge2-"),
    );
    try {
      mkdirSync(path.join(tmp, "head", "opencode"), { recursive: true });
      mkdirSync(path.join(tmp, "head", "installer"), { recursive: true });
      writeFileSync(
        path.join(tmp, "head", "opencode", "plugin.ts"),
        `import { install } from "../installer/index.js";\n`,
      );
      writeFileSync(
        path.join(tmp, "head", "installer", "index.ts"),
        `export const install = () => {};\n`,
      );
      const seeds = listTsFilesSync(path.join(tmp, "head", "opencode"));
      const violations = findForbiddenEdges(seeds, [path.join(tmp, "head", "installer")]);
      expect(violations.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("src/head/opencode/** does NOT transitively reach src/head/installer/**", () => {
    const seeds = listTsFilesSync(OPENCODE_DIR);
    expect(seeds.length).toBeGreaterThan(0);
    const violations = findForbiddenEdges(seeds, [INSTALLER_DIR]);
    expect(
      violations,
      `transitive leak from head/opencode to installer:\n${violations.map((v) => `  ${v.importer} (${v.specifier})`).join("\n")}`,
    ).toEqual([]);
  });
});

// ===========================================================================
// EDGE 3 — child_process shell-out bypass (REQ-TY2-004 F2)
// ===========================================================================

/**
 * Scan a TS source for child_process spawn/exec/execSync/fork calls whose arguments include a
 * forbidden installer reference (bin/tiny-yeah, install-offline, head/installer). Source is
 * comment-stripped first so commented-out shell-outs do not trip the detector.
 */
function detectShellOutBypass(strippedSource: string): string[] {
  const hits: string[] = [];
  // Match child_process spawn/exec/execSync/fork followed by a parenthesized call. Then check
  // whether the call's argument list mentions an installer reference.
  const callRe = /\b(?:spawn|exec|execSync|execFile|execFileSync|fork)\s*\(([^;]*?)\)/gs;
  const installerRefs =
    /(["'`])(?:[^"'`]*?\b)?(?:bin[\\/]tiny-yeah|tiny-yeah\.js|install-offline|head[\\/]installer)\b/;
  for (const match of strippedSource.matchAll(callRe)) {
    const argList = match[1] ?? "";
    if (installerRefs.test(argList)) {
      hits.push(argList.trim().slice(0, 120));
    }
  }
  return hits;
}

describe("installer-firewall — EDGE 3: child_process shell-out bypass (F2)", () => {
  it("detector flags a synthetic spawn('node', ['bin/tiny-yeah.js']) (non-no-op proof)", () => {
    const sample = stripComments(`
      import { spawn } from "node:child_process";
      function bad() {
        spawn("node", ["bin/tiny-yeah.js", "install", "--force"]);
      }
    `);
    expect(detectShellOutBypass(sample).length).toBe(1);
  });

  it("detector does NOT flag a benign spawn (no installer ref)", () => {
    const sample = stripComments(`
      import { spawn } from "node:child_process";
      function ok() { spawn("git", ["status"]); }
    `);
    expect(detectShellOutBypass(sample)).toEqual([]);
  });

  it("src/model-contract/** does NOT shell out to the installer", () => {
    const files = listTsFilesSync(MODEL_CONTRACT_DIR);
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const stripped = stripComments(readFileSync(file, "utf8"));
      for (const hit of detectShellOutBypass(stripped)) {
        offenders.push(`${path.relative(SRC_ROOT, file)}: ${hit}`);
      }
    }
    expect(offenders, `shell-out bypass in model-contract:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("src/head/opencode/** does NOT shell out to the installer", () => {
    const files = listTsFilesSync(OPENCODE_DIR);
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const stripped = stripComments(readFileSync(file, "utf8"));
      for (const hit of detectShellOutBypass(stripped)) {
        offenders.push(`${path.relative(SRC_ROOT, file)}: ${hit}`);
      }
    }
    expect(offenders, `shell-out bypass in head/opencode:\n${offenders.join("\n")}`).toEqual([]);
  });
});

// ===========================================================================
// EDGE 4 — core → installer reverse ban (REQ-TY2-004 F3)
// ===========================================================================

describe("installer-firewall — EDGE 4: core → installer reverse ban (F3)", () => {
  it("scanner flags a synthetic core→installer import (detector non-no-op proof)", () => {
    const tmp = mkdtempSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), ".firewall-edge4-"),
    );
    try {
      mkdirSync(path.join(tmp, "core", "state"), { recursive: true });
      mkdirSync(path.join(tmp, "head", "installer"), { recursive: true });
      writeFileSync(
        path.join(tmp, "core", "state", "file-store.ts"),
        `import { writeStamp } from "../../head/installer/index.js";\n`,
      );
      writeFileSync(
        path.join(tmp, "head", "installer", "index.ts"),
        `export const writeStamp = () => {};\n`,
      );
      const seeds = listTsFilesSync(path.join(tmp, "core"));
      const violations = findForbiddenEdges(seeds, [path.join(tmp, "head", "installer")]);
      expect(violations.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("src/core/** does NOT transitively reach src/head/installer/**", () => {
    const seeds = listTsFilesSync(CORE_DIR);
    expect(seeds.length).toBeGreaterThan(0);
    const violations = findForbiddenEdges(seeds, [INSTALLER_DIR]);
    expect(
      violations,
      `reverse-direction import from core to installer:\n${violations.map((v) => `  ${v.importer} (${v.specifier})`).join("\n")}`,
    ).toEqual([]);
  });
});

// ===========================================================================
// EDGE 5 — installer → checkpoint ban (REQ-TY2-003)
// ===========================================================================

/** The three create-only checkpoint modules the installer MUST NOT import. */
const CHECKPOINT_BAN_TARGETS = [
  path.join(CORE_DIR, "checkpoint", "preview.ts"),
  path.join(CORE_DIR, "checkpoint", "apply.ts"),
  path.join(CORE_DIR, "checkpoint", "universal-write-path.ts"),
];

describe("installer-firewall — EDGE 5: installer → checkpoint ban (REQ-TY2-003)", () => {
  it("scanner flags a synthetic installer→checkpoint import (detector non-no-op proof)", () => {
    // The findForbiddenEdges primitive takes forbidden DIRS; for individual files we use a
    // dedicated single-file scan here to prove the underlying import scanner works.
    const tmp = mkdtempSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), ".firewall-edge5-"),
    );
    try {
      mkdirSync(path.join(tmp, "head", "installer"), { recursive: true });
      mkdirSync(path.join(tmp, "core", "checkpoint"), { recursive: true });
      writeFileSync(
        path.join(tmp, "head", "installer", "writer.ts"),
        `import { commitManifest } from "../../core/checkpoint/universal-write-path.js";\n`,
      );
      writeFileSync(
        path.join(tmp, "core", "checkpoint", "universal-write-path.ts"),
        `export const commitManifest = () => {};\n`,
      );
      const installerFiles = listTsFilesSync(path.join(tmp, "head", "installer"));
      const offenders: string[] = [];
      const checkpointDir = path.join(tmp, "core", "checkpoint");
      for (const file of installerFiles) {
        const specs = extractSpecifiers(stripComments(readFileSync(file, "utf8")));
        for (const spec of specs) {
          const resolved = resolveRelative(file, spec);
          if (resolved === undefined) continue;
          const isCheckpoint =
            resolved === path.join(checkpointDir, "preview.ts") ||
            resolved === path.join(checkpointDir, "apply.ts") ||
            resolved === path.join(checkpointDir, "universal-write-path.ts");
          if (isCheckpoint) offenders.push(`${file} (${spec})`);
        }
      }
      expect(offenders.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("src/head/installer/** does NOT import preview.ts / apply.ts / universal-write-path.ts", () => {
    const files = listTsFilesSync(INSTALLER_DIR);
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const specs = extractSpecifiers(stripComments(readFileSync(file, "utf8")));
      for (const spec of specs) {
        const resolved = resolveRelative(file, spec);
        if (resolved === undefined) continue;
        if (CHECKPOINT_BAN_TARGETS.includes(resolved)) {
          offenders.push(`${path.relative(SRC_ROOT, file)} imports ${spec}`);
        }
      }
    }
    expect(
      offenders,
      `installer imports forbidden checkpoint modules:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("src/head/installer/writer.ts DOES reuse the allowed atomic primitives (withWriteRetry, writeJsonAtomic)", () => {
    // Sanity: the writer SHOULD import the ALLOWED primitives (atomic-write, file-store). This
    // counter-assertion guards against a false-positive regression where the ban becomes "no
    // core/* import at all" — the SPEC explicitly ALLOWS atomic primitives, just not the
    // checkpoint preview/apply/universal-write-path trio.
    const writerPath = path.join(INSTALLER_DIR, "writer.ts");
    const stripped = stripComments(readFileSync(writerPath, "utf8"));
    const specs = extractSpecifiers(stripped);
    expect(specs.some((s) => s.includes("atomic-write"))).toBe(true);
    // writeJsonAtomic lives in file-store.
    expect(specs.some((s) => s.includes("file-store"))).toBe(true);
  });
});

// ===========================================================================
// EDGE 6 — installer writes .tiny-yeah/ ban (REQ-TY2-005)
// ===========================================================================

/**
 * Scan installer source (comment-stripped) for write calls whose target contains the literal
 * `.tiny-yeah` segment. The installer domain writes only under .opencode/; any write to
 * `.tiny-yeah/` would cross into the model-state domain (INV-1 violation).
 *
 * Heuristic: flag any of (writeFile|writeJson|writeJsonAtomic|mkdir|copyFile|copyFileSync|rm|rmSync|
 * rename|renameSync|appendFile|appendFileSync) appearing within a few characters of a `.tiny-yeah`
 * string literal. Strings are preserved by stripComments so string-literal path targets are
 * caught.
 */
function detectTinyYeahWriteTarget(strippedSource: string): string[] {
  const hits: string[] = [];
  const writeCallRe =
    /\b(?:writeFile|writeJson|writeJsonAtomic|writeFileSync|mkdir|mkdirSync|mkdirSync|copyFile|copyFileSync|rm|rmSync|rename|renameSync|appendFile|appendFileSync|backupAndWrite|atomicCopyFile|atomicOverwriteFile|atomicWriteJson|atomicCopyFileBinary)\b[^;]{0,400}?["'`][^"'`]*?\.tiny-yeah(?:[\\/"'`]|["'`])/gs;
  // Also catch path-construction calls: join/resolve(arg, ".tiny-yeah", ...).
  const joinRe = /\b(?:join|resolve)\s*\([^)]*?["'`]\.tiny-yeah["'`]/s;
  for (const match of strippedSource.matchAll(writeCallRe)) {
    hits.push(match[0].trim().slice(0, 160));
  }
  if (joinRe.test(strippedSource)) {
    hits.push("path-construct(.tiny-yeah)");
  }
  return hits;
}

describe("installer-firewall — EDGE 6: installer writes .tiny-yeah/ ban (REQ-TY2-005)", () => {
  it("detector flags a synthetic writeFile(..., '.tiny-yeah/x') (non-no-op proof)", () => {
    const sample = stripComments(`
      import { writeFile } from "node:fs/promises";
      function bad() { return writeFile(".tiny-yeah/state.json", "{}"); }
    `);
    expect(detectTinyYeahWriteTarget(sample).length).toBeGreaterThan(0);
  });

  it("detector does NOT flag a benign writeFile to .opencode/", () => {
    const sample = stripComments(`
      import { writeFile } from "node:fs/promises";
      function ok() { return writeFile(".opencode/opencode.json", "{}"); }
    `);
    expect(detectTinyYeahWriteTarget(sample)).toEqual([]);
  });

  it("detector ignores a .tiny-yeah reference inside a comment", () => {
    const sample = stripComments(`
      // Do not write to .tiny-yeah/ — that's the model-state domain.
      function ok() { return writeFile(".opencode/x.json", "{}"); }
    `);
    expect(detectTinyYeahWriteTarget(sample)).toEqual([]);
  });

  it("src/head/installer/** contains no write targeting .tiny-yeah/", () => {
    const files = listTsFilesSync(INSTALLER_DIR);
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const stripped = stripComments(readFileSync(file, "utf8"));
      for (const hit of detectTinyYeahWriteTarget(stripped)) {
        offenders.push(`${path.relative(SRC_ROOT, file)}: ${hit}`);
      }
    }
    expect(offenders, `installer writes targeting .tiny-yeah/:\n${offenders.join("\n")}`).toEqual(
      [],
    );
  });
});

// ===========================================================================
// EDGE 7 — lock-store hardwired path (REQ-TY2-003 MAJOR #4)
// ===========================================================================

const LOCK_STORE_TARGET = path.join(CORE_DIR, "state", "lock-store.ts");

describe("installer-firewall — EDGE 7: lock-store hardwired path ban (REQ-TY2-003 MAJOR #4)", () => {
  it("scanner flags a synthetic installer→lock-store import (detector non-no-op proof)", () => {
    const tmp = mkdtempSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), ".firewall-edge7-"),
    );
    try {
      mkdirSync(path.join(tmp, "head", "installer"), { recursive: true });
      mkdirSync(path.join(tmp, "core", "state"), { recursive: true });
      writeFileSync(
        path.join(tmp, "head", "installer", "lock.ts"),
        `import { acquireTinyYeahLock } from "../../core/state/lock-store.js";\n`,
      );
      writeFileSync(
        path.join(tmp, "core", "state", "lock-store.ts"),
        `export const acquireTinyYeahLock = () => {};\n`,
      );
      const installerFiles = listTsFilesSync(path.join(tmp, "head", "installer"));
      const offenders: string[] = [];
      for (const file of installerFiles) {
        const specs = extractSpecifiers(stripComments(readFileSync(file, "utf8")));
        for (const spec of specs) {
          const resolved = resolveRelative(file, spec);
          if (resolved === path.join(tmp, "core", "state", "lock-store.ts")) {
            offenders.push(`${file} (${spec})`);
          }
        }
      }
      expect(offenders.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("src/head/installer/** does NOT import src/core/state/lock-store.ts", () => {
    const files = listTsFilesSync(INSTALLER_DIR);
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const specs = extractSpecifiers(stripComments(readFileSync(file, "utf8")));
      for (const spec of specs) {
        const resolved = resolveRelative(file, spec);
        if (resolved === LOCK_STORE_TARGET) {
          offenders.push(`${path.relative(SRC_ROOT, file)} imports ${spec}`);
        }
      }
    }
    expect(
      offenders,
      `installer imports hardwired lock-store (.tiny-yeah/locks/):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("src/head/installer/** DOES use its own installer-local lock (head/installer/lock.ts)", () => {
    // Sanity: the installer lock module exists and is imported from at least one installer file.
    const installerLockPath = path.join(INSTALLER_DIR, "lock.ts");
    expect(existsSync(installerLockPath)).toBe(true);
    const files = listTsFilesSync(INSTALLER_DIR);
    let importers = 0;
    for (const file of files) {
      const specs = extractSpecifiers(stripComments(readFileSync(file, "utf8")));
      if (specs.some((s) => resolveRelative(file, s) === installerLockPath)) {
        importers += 1;
      }
    }
    expect(importers).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// CONTINUING INVARIANTS — jsonc-parser confinement (REQ-TY2-008 + REQ-TY2-018)
// ===========================================================================

describe("installer-firewall — jsonc-parser confinement (REQ-TY2-008 + REQ-TY2-018)", () => {
  it("jsonc-parser is imported ONLY under src/head/installer/** across src/", () => {
    const allSrc = listTsFilesSync(SRC_ROOT);
    expect(allSrc.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    // Sanity counter: opencode-config.ts imports jsonc-parser. If this stays 0 the regex is
    // broken and the offenders check would false-pass.
    let installerFilesImportingJsoncParser = 0;
    for (const file of allSrc) {
      const relative = path.relative(SRC_ROOT, file).replaceAll(path.sep, "/");
      const isInstallerFile = relative.startsWith("head/installer/");
      const specs = extractSpecifiers(stripComments(readFileSync(file, "utf8")));
      const hasJsoncParser = specs.some(
        (s) => s === "jsonc-parser" || s.startsWith("jsonc-parser/"),
      );
      if (isInstallerFile && hasJsoncParser) {
        installerFilesImportingJsoncParser += 1;
      }
      if (isInstallerFile) continue;
      for (const specifier of specs) {
        if (specifier === "jsonc-parser" || specifier.startsWith("jsonc-parser/")) {
          offenders.push(`${relative} imports '${specifier}'`);
        }
      }
    }
    expect(installerFilesImportingJsoncParser).toBeGreaterThanOrEqual(1);
    expect(offenders, `jsonc-parser leaked outside installer:\n${offenders.join("\n")}`).toEqual(
      [],
    );
  });

  it("bin/tiny-yeah.js does NOT import jsonc-parser (hermeticity, REQ-TY2-018)", () => {
    const source = readFileSync(BIN_PATH, "utf8");
    const stripped = stripComments(source);
    // No static import of jsonc-parser.
    const specs = extractSpecifiers(stripped);
    const jsoncStatic = specs.some((s) => s === "jsonc-parser" || s.startsWith("jsonc-parser/"));
    expect(jsoncStatic, "bin/tiny-yeah.js statically imports jsonc-parser").toBe(false);
    // The dynamic-import escape hatch MUST point at the lifecycle, never at jsonc-parser.
    const dynamicJsonc = /import\s*\(\s*["'][^"']*jsonc-parser[^"']*["']/;
    expect(dynamicJsonc.test(stripped), "bin/tiny-yeah.js dynamically imports jsonc-parser").toBe(
      false,
    );
  });
});

// ===========================================================================
// CONTINUING INVARIANT — .tiny-yeah/ write firewall (REQ-TY2-003 MAJOR #4, structural)
// ===========================================================================

describe("installer-firewall — .tiny-yeah/ write firewall (REQ-TY2-003 MAJOR #4, structural)", () => {
  it("src/head/installer/** does NOT construct .tiny-yeah/ as a write/lock target", () => {
    // This is the original Phase-0 structural guard, kept as a second layer on top of EDGE 6's
    // broader write-call scan. Both must stay green.
    const files = listTsFilesSync(INSTALLER_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      const writeTarget = /(?:join|resolve)\s*\([^)]*["'`]\.tiny-yeah["'`]/;
      expect(writeTarget.test(content), `${file} constructs a .tiny-yeah/ path`).toBe(false);
    }
  });
});
