// UNIT: offline-bundle self-installing layout (SPEC-TINY-YEAH-002 REQ-TY2-001).
//
// After `npm run release:offline`, asserts the produced tarball carries the five self-installing
// entries and a manifest.installer block. This is the unit-level assertion; the authoritative
// gate is scripts/release/verify-offline-bundle.mjs (which also runs the bin-hermeticity smoke).
//
// Gating: if release:offline has not been run (no release/*.tar.gz), this test SKIPS with a
// clear message rather than failing — CI runs release:offline + verify:offline separately.

import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const releaseDir = path.join(repoRoot, "release");

/**
 * Synchronous release-bundle presence check, evaluated once at module load so vitest's
 * `it.skipIf(boolean)` can gate on a real boolean (it does not await promises).
 */
function releaseBundleAvailable(): boolean {
  if (!existsSync(releaseDir)) return false;
  let entries: string[];
  try {
    entries = readdirSync(releaseDir);
  } catch {
    return false;
  }
  return entries.some((name) => name.startsWith("tiny-yeah-offline-v") && name.endsWith(".tar.gz"));
}

const HAS_BUNDLE = releaseBundleAvailable();

interface FoundBundle {
  readonly archive: string;
  readonly topDir: string;
}

async function findLatestBundle(): Promise<FoundBundle | undefined> {
  let entries: string[];
  try {
    entries = await readdir(releaseDir);
  } catch {
    return undefined;
  }
  const tarballs = entries
    .filter((name) => name.startsWith("tiny-yeah-offline-v") && name.endsWith(".tar.gz"))
    .sort()
    .reverse();
  if (tarballs.length === 0) return undefined;
  const archive = path.join(releaseDir, tarballs[0] as string);
  // topDir = archive name without .tar.gz (e.g. tiny-yeah-offline-v0.6.0).
  const topDir = (tarballs[0] as string).replace(/\.tar\.gz$/, "");
  return { archive, topDir };
}

async function listTarEntries(archive: string): Promise<string[]> {
  const { stdout } = await execFileAsync("tar", ["-tzf", archive]);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function readTarEntry(archive: string, entry: string): Promise<string> {
  const { stdout } = await execFileAsync("tar", ["-xzf", archive, "-O", entry]);
  return stdout;
}

describe("offline-bundle self-installing layout (REQ-TY2-001)", () => {
  it.skipIf(!HAS_BUNDLE)(
    "contains all five self-installing entries + manifest.installer",
    async () => {
      const bundle = await findLatestBundle();
      if (!bundle) {
        // Defensive: skipIf covers this, but keep a guard for type narrowing.
        expect.fail("no release tarball found; run `npm run release:offline` first");
      }
      const entries = await listTarEntries(bundle.archive);

      const required = [
        "bin/tiny-yeah.js",
        "templates/opencode/package.json",
        "templates/opencode/plugins/tiny-yeah.ts",
        "templates/opencode/tui.json",
        "install-offline.ps1",
      ];
      for (const rel of required) {
        const fullEntry = `${bundle.topDir}/${rel}`;
        expect(entries).toContain(fullEntry);
      }

      // manifest.installer block present with the expected shape.
      const manifestText = await readTarEntry(bundle.archive, `${bundle.topDir}/manifest.json`);
      const manifest = JSON.parse(manifestText) as {
        installer?: { bin?: string; entrypoint?: string; templatesDir?: string };
      };
      expect(manifest.installer).toBeDefined();
      expect(manifest.installer?.bin).toBe("bin/tiny-yeah.js");
      expect(manifest.installer?.entrypoint).toBe("install-offline.ps1");
      expect(manifest.installer?.templatesDir).toBe("templates/opencode");
    },
  );

  it.skipIf(!HAS_BUNDLE)(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${VERSION} placeholder text under test
    "template package.json dependency is materialized (no ${VERSION} placeholder)",
    async () => {
      const bundle = await findLatestBundle();
      if (!bundle) expect.fail("no release tarball found");
      const templateText = await readTarEntry(
        bundle.archive,
        `${bundle.topDir}/templates/opencode/package.json`,
      );
      const template = JSON.parse(templateText) as { dependencies?: { "tiny-yeah"?: string } };
      const depRef = template.dependencies?.["tiny-yeah"];
      expect(typeof depRef).toBe("string");
      expect(depRef).toMatch(/^file:\.\/vendor\/tiny-yeah-v\d+\.\d+\.\d+(-bundled)?\.tgz$/);
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${VERSION} placeholder text under test
      expect(depRef).not.toContain("${VERSION}");
    },
  );

  it("install-offline.sh is NOT shipped (REQ-TY2-016 PowerShell-only)", async () => {
    const bundle = await findLatestBundle();
    if (!bundle) {
      // No bundle to inspect — the absence is asserted by the absence of the file in the repo
      // root, which is a static property verified elsewhere. Skip here.
      return;
    }
    const entries = await listTarEntries(bundle.archive);
    const shEntries = entries.filter((e) => e.endsWith("/install-offline.sh"));
    expect(shEntries).toEqual([]);
  });
});
