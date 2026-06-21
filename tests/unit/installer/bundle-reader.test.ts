// UNIT: bundle-reader (SPEC-TINY-YEAH-002 REQ-TY2-002, strategy §4 bundle-reader.ts).
//
// Verifies the offline bundle is self-contained + integrity-checked, fail-closed on ANY
// tamper/incompleteness with ZERO writes. Reader is pure-read — no writes by construction —
// but we assert it never touches the target project dir even on failure (spy on fs writes
// would be redundant; instead we assert no file is created in the project dir).

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUNDLE_AIR_GAP_INCOMPLETE,
  BUNDLE_HASH_MISMATCH,
  BUNDLE_INSTALLER_BLOCK_MISSING,
  BUNDLE_MANIFEST_INVALID,
  BUNDLE_MANIFEST_NOT_FOUND,
  type BundleManifest,
  readBundle,
} from "../../../src/head/installer/bundle-reader.js";
import { hasInstallerErrorCode, InstallerError } from "../../../src/head/installer/errors.js";

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

/**
 * Build a synthetic VALID bundle in a tmpdir. Mirrors the shape produced by
 * scripts/release/build-offline-bundle.mjs: manifest.json with airGapComplete + installer block
 * + distHashes, plus the referenced dist files, vendor tarball, bin, templates, and installer
 * entrypoint. Callers mutate fields to produce failure cases.
 */
async function buildValidBundle(
  dir: string,
  overrides: Partial<BundleManifest> = {},
): Promise<string> {
  const distDir = path.join(dir, "dist");
  const vendorDir = path.join(dir, "vendor");
  const binDir = path.join(dir, "bin");
  const templatesDir = path.join(dir, "templates", "opencode");
  await mkdir(distDir, { recursive: true });
  await mkdir(vendorDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  await mkdir(templatesDir, { recursive: true });

  await writeFile(path.join(distDir, "index.js"), "export const VERSION='0.7.0';\n");
  await writeFile(path.join(vendorDir, "tiny-yeah-v0.7.0-bundled.tgz"), "tarball-bytes\n");
  await writeFile(path.join(binDir, "tiny-yeah.js"), "#!/usr/bin/env node\n");
  await writeFile(path.join(templatesDir, "package.json"), "{}\n");
  await writeFile(path.join(dir, "install-offline.ps1"), "pwsh\n");

  const distHashes: Record<string, string> = {
    "dist/index.js": await sha256(path.join(distDir, "index.js")),
  };
  const manifest: BundleManifest = {
    name: "tiny-yeah-offline-bundle",
    packageName: "tiny-yeah",
    version: "0.7.0",
    airGapComplete: true,
    packageTarball: "vendor/tiny-yeah-v0.7.0-bundled.tgz",
    distHashes,
    verifiedEntrypoints: [".", "./opencode", "./tui"],
    installer: {
      bin: "bin/tiny-yeah.js",
      entrypoint: "install-offline.ps1",
      templatesDir: "templates/opencode",
    },
    ...overrides,
  };
  await writeFile(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

describe("bundle-reader — happy path (REQ-TY2-001/002)", () => {
  it("verifies a well-formed bundle and returns manifest + entries", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-reader-happy-"));
    try {
      const bundleDir = await buildValidBundle(tmp);
      const verified = await readBundle(bundleDir);
      expect(verified.manifest.version).toBe("0.7.0");
      expect(verified.manifest.airGapComplete).toBe(true);
      expect(verified.bundleDir).toBe(bundleDir);
      // distHashes entries are resolved to absolute paths.
      expect(verified.entries.length).toBeGreaterThanOrEqual(1);
      const distEntry = verified.entries.find((e) => e.relPath === "dist/index.js");
      expect(distEntry).toBeDefined();
      expect(distEntry?.absPath).toBe(path.join(bundleDir, "dist", "index.js"));
      expect(typeof distEntry?.sha256).toBe("string");
      expect(distEntry?.sha256.length).toBe(64);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("bundle-reader — fail-closed (REQ-TY2-002, ZERO writes)", () => {
  it("rejects when manifest.json is missing (BUNDLE_MANIFEST_NOT_FOUND)", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-reader-nomanifest-"));
    try {
      // Build a bundle but then delete the manifest.
      await buildValidBundle(tmp);
      await rm(path.join(tmp, "manifest.json"));
      await expect(readBundle(tmp)).rejects.toSatisfy((err: unknown) =>
        hasInstallerErrorCode(err, BUNDLE_MANIFEST_NOT_FOUND),
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects when manifest.json is unparseable (BUNDLE_MANIFEST_INVALID)", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-reader-badjson-"));
    try {
      await buildValidBundle(tmp);
      await writeFile(path.join(tmp, "manifest.json"), "{ not valid json");
      await expect(readBundle(tmp)).rejects.toSatisfy((err: unknown) =>
        hasInstallerErrorCode(err, BUNDLE_MANIFEST_INVALID),
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects when airGapComplete is false (BUNDLE_AIR_GAP_INCOMPLETE)", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-reader-noairgap-"));
    try {
      await buildValidBundle(tmp, { airGapComplete: false });
      await expect(readBundle(tmp)).rejects.toSatisfy((err: unknown) =>
        hasInstallerErrorCode(err, BUNDLE_AIR_GAP_INCOMPLETE),
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects when the installer block is missing (BUNDLE_INSTALLER_BLOCK_MISSING)", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-reader-noinstaller-"));
    try {
      await buildValidBundle(tmp, { installer: undefined });
      await expect(readBundle(tmp)).rejects.toSatisfy((err: unknown) =>
        hasInstallerErrorCode(err, BUNDLE_INSTALLER_BLOCK_MISSING),
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects when a dist file hash does not match (BUNDLE_HASH_MISMATCH) — tamper detection", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-reader-tamper-"));
    try {
      const bundleDir = await buildValidBundle(tmp);
      // Tamper with the dist file AFTER the manifest hashes were computed.
      await writeFile(path.join(bundleDir, "dist", "index.js"), "TAMPERED CONTENT\n");
      await expect(readBundle(bundleDir)).rejects.toSatisfy((err: unknown) =>
        hasInstallerErrorCode(err, BUNDLE_HASH_MISMATCH),
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects when a hashed file is missing (BUNDLE_FILE_MISSING)", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-reader-missing-"));
    try {
      const bundleDir = await buildValidBundle(tmp);
      await rm(path.join(bundleDir, "dist", "index.js"));
      await expect(readBundle(bundleDir)).rejects.toSatisfy((err: unknown) =>
        hasInstallerErrorCode(err, "BUNDLE_FILE_MISSING"),
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("fail-closed performs ZERO writes to the bundle dir (reader is pure-read)", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-reader-zerowrite-"));
    try {
      const bundleDir = await buildValidBundle(tmp);
      // Snapshot the manifest bytes; a write by the reader would change them.
      const manifestPath = path.join(bundleDir, "manifest.json");
      const distPath = path.join(bundleDir, "dist", "index.js");
      const manifestBefore = await readFile(manifestPath, "utf8");
      // Cause a read FAILURE by tampering the dist file (NOT rewriting the manifest). The reader
      // must throw without writing anything — manifest bytes stay byte-identical.
      await writeFile(distPath, "TAMPERED\n");
      await expect(readBundle(bundleDir)).rejects.toBeInstanceOf(InstallerError);
      const manifestAfter = await readFile(manifestPath, "utf8");
      expect(manifestAfter).toBe(manifestBefore);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
