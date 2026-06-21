// UNIT: install plan computation (SPEC-TINY-YEAH-002 REQ-TY2-009/010, strategy §4 plan.ts).
//
// Maps source bundle paths to target <project>/.opencode/ paths. The opencode.json[c] deep-merge
// entry is represented as kind:"merge" (executed in Phase 2); Phase 1 just computes the plan.

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BundleManifest, VerifiedBundle } from "../../../src/head/installer/bundle-reader.js";
import {
  computeInstallPlan,
  formatDryRun,
  formatDryRunJson,
  type InstallPlan,
  type InstallPlanEntry,
} from "../../../src/head/installer/plan.js";

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

async function makeBundle(dir: string): Promise<{ bundleDir: string; vendorTarballName: string }> {
  const bundleDir = path.join(dir, "bundle");
  const distDir = path.join(bundleDir, "dist");
  const vendorDir = path.join(bundleDir, "vendor");
  const templatesDir = path.join(bundleDir, "templates", "opencode");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(distDir, { recursive: true });
  await mkdir(vendorDir, { recursive: true });
  await mkdir(templatesDir, { recursive: true });
  await mkdir(path.join(templatesDir, "plugins"), { recursive: true });
  await writeFile(path.join(distDir, "index.js"), "export const VERSION='0.7.0';\n");
  const vendorTarballName = "tiny-yeah-v0.7.0-bundled.tgz";
  await writeFile(path.join(vendorDir, vendorTarballName), "tarball\n");
  await writeFile(path.join(templatesDir, "package.json"), "{}\n");
  await writeFile(path.join(templatesDir, "tui.json"), "{}\n");
  await writeFile(path.join(templatesDir, "plugins", "tiny-yeah.ts"), "export {}\n");
  return { bundleDir, vendorTarballName };
}

async function makeVerifiedBundle(
  dir: string,
): Promise<{ verified: VerifiedBundle; vendorTarballName: string }> {
  const { bundleDir, vendorTarballName } = await makeBundle(dir);
  const distHashes: Record<string, string> = {
    "dist/index.js": await sha256(path.join(bundleDir, "dist", "index.js")),
  };
  const manifest: BundleManifest = {
    name: "tiny-yeah-offline-bundle",
    packageName: "tiny-yeah",
    version: "0.7.0",
    airGapComplete: true,
    packageTarball: `vendor/${vendorTarballName}`,
    distHashes,
    verifiedEntrypoints: [".", "./opencode", "./tui"],
    installer: {
      bin: "bin/tiny-yeah.js",
      entrypoint: "install-offline.ps1",
      templatesDir: "templates/opencode",
    },
  };
  const verified: VerifiedBundle = {
    manifest,
    bundleDir,
    entries: [
      {
        relPath: "dist/index.js",
        absPath: path.join(bundleDir, "dist", "index.js"),
        sha256: distHashes["dist/index.js"] ?? "",
      },
    ],
  };
  return { verified, vendorTarballName };
}

describe("computeInstallPlan — source→target mapping (strategy §6)", () => {
  it("maps all five sources to the correct <project>/.opencode/ dests", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-plan-map-"));
    try {
      const { verified, vendorTarballName } = await makeVerifiedBundle(tmp);
      const plan = await computeInstallPlan({ verifiedBundle: verified, projectRoot: tmp });
      const dests = plan.entries.map((e) => e.dest).sort();
      const expected = [
        path.join(tmp, ".opencode", ".tiny-yeah-install.json"),
        path.join(tmp, ".opencode", "package.json"),
        path.join(tmp, ".opencode", "plugins", "tiny-yeah.ts"),
        path.join(tmp, ".opencode", "tui.json"),
        path.join(tmp, ".opencode", "vendor", vendorTarballName),
        // The opencode.json[c] merge entry is also present (kind:"merge").
      ];
      for (const e of expected) {
        expect(dests).toContain(e);
      }
      // The opencode.jsonc merge entry targets .opencode/opencode.jsonc (Phase 2 executes it).
      const mergeEntry = plan.entries.find((e) => e.kind === "merge");
      expect(mergeEntry).toBeDefined();
      expect(mergeEntry?.dest.startsWith(path.join(tmp, ".opencode"))).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("each plan entry carries src, dest, kind, managed, expectedSha256 where applicable", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-plan-shape-"));
    try {
      const { verified } = await makeVerifiedBundle(tmp);
      const plan = await computeInstallPlan({ verifiedBundle: verified, projectRoot: tmp });
      for (const entry of plan.entries) {
        expect(typeof entry.src).toBe("string");
        expect(typeof entry.dest).toBe("string");
        expect(["copy", "write", "merge"]).toContain(entry.kind);
        expect(typeof entry.managed).toBe("boolean");
        // copy/write entries that originate from the bundle carry an expectedSha256.
        if (entry.kind === "copy") {
          expect(typeof entry.expectedSha256).toBe("string");
          expect((entry.expectedSha256 ?? "").length).toBe(64);
        }
      }
      // Vendor tarball + templates are managed; the opencode.jsonc merge is managed too.
      expect(plan.entries.every((e) => e.managed)).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("the vendor tarball source resolves from manifest.packageTarball", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-plan-vendor-"));
    try {
      const { verified, vendorTarballName } = await makeVerifiedBundle(tmp);
      const plan = await computeInstallPlan({ verifiedBundle: verified, projectRoot: tmp });
      const vendorEntry = plan.entries.find((e) => e.dest.endsWith(vendorTarballName));
      expect(vendorEntry).toBeDefined();
      expect(vendorEntry?.src).toBe(path.join(verified.bundleDir, "vendor", vendorTarballName));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("computeInstallPlan — path confinement (REQ-TY2-007)", () => {
  it("rejects a projectRoot-relative escape in any computed dest (defensive)", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-plan-confine-"));
    try {
      const { verified } = await makeVerifiedBundle(tmp);
      // The plan computes dests deterministically from projectRoot; passing a projectRoot that is
      // itself a subdir and asserting every dest stays under it.
      const plan = await computeInstallPlan({ verifiedBundle: verified, projectRoot: tmp });
      for (const entry of plan.entries) {
        const rel = path.relative(tmp, entry.dest);
        expect(rel.startsWith("..")).toBe(false);
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("formatDryRun / formatDryRunJson (REQ-TY2-009 --dry-run)", () => {
  it("formatDryRun produces human-readable text listing every entry", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-plan-dryrun-"));
    try {
      const { verified } = await makeVerifiedBundle(tmp);
      const plan = await computeInstallPlan({ verifiedBundle: verified, projectRoot: tmp });
      const text = formatDryRun(plan);
      expect(typeof text).toBe("string");
      expect(text.length).toBeGreaterThan(0);
      // Every dest path appears in the dry-run output.
      for (const entry of plan.entries) {
        expect(text).toContain(entry.dest);
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("formatDryRunJson produces a machine-readable object with the expected shape", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-plan-json-"));
    try {
      const { verified } = await makeVerifiedBundle(tmp);
      const plan: InstallPlan = await computeInstallPlan({
        verifiedBundle: verified,
        projectRoot: tmp,
      });
      const obj = formatDryRunJson(plan);
      expect(obj.version).toBe(verified.manifest.version);
      expect(obj.projectRoot).toBe(tmp);
      expect(Array.isArray(obj.entries)).toBe(true);
      expect(obj.entries.length).toBe(plan.entries.length);
      const first = obj.entries[0] as InstallPlanEntry;
      expect(first).toHaveProperty("src");
      expect(first).toHaveProperty("dest");
      expect(first).toHaveProperty("kind");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
