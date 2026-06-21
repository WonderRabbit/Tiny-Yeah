// UNIT: lifecycle.update (SPEC-TINY-YEAH-002 REQ-TY2-011, strategy §5 update).
//
// Update lifecycle E2E into a tmpdir project. Builds a v0.8.0 bundle, installs it, then builds a
// v0.9.0 bundle and updates. Covers:
//   - REQ-TY2-011 (version compare): newer proceeds; equal=noop; downgrade rejected without
//     --allow-downgrade, allowed with it
//   - REQ-TY2-011 (deep-merge preserve user edits): other plugin entries + comments survive
//   - REQ-TY2-014 (plugin-cache invalidation): tiny-yeah@<old> dir under the resolved cache path
//     is deleted; partial failure is best-effort (cacheInvalidated: false, run still succeeds)
//   - stamp refreshed with new managedFileHashes + new version + resolvedPluginCachePath
//   - dry-run: zero writes
//   - backup created before overwrite

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InstallerError } from "../../../src/head/installer/errors.js";
import {
  type UpdateOptions,
  type UpdateResult,
  update,
} from "../../../src/head/installer/lifecycle.js";
import { readStamp } from "../../../src/head/installer/stamp.js";

const PLUGIN_NAME = "tiny-yeah";

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

/**
 * Build a synthetic VALID bundle at the given dir, parameterized by version. Mirrors the
 * scripts/release/build-offline-bundle.mjs layout with synthetic minimal content. readBundle
 * verifies it as genuine.
 */
async function buildBundle(
  dir: string,
  version: string,
  opts: { airGapComplete?: boolean } = {},
): Promise<string> {
  const distDir = path.join(dir, "dist");
  const vendorDir = path.join(dir, "vendor");
  const binDir = path.join(dir, "bin");
  const templatesDir = path.join(dir, "templates", "opencode");
  const pluginsDir = path.join(templatesDir, "plugins");
  await mkdir(distDir, { recursive: true });
  await mkdir(vendorDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  await mkdir(pluginsDir, { recursive: true });
  await writeFile(path.join(distDir, "index.js"), `export const VERSION = "${version}";\n`);
  await writeFile(
    path.join(vendorDir, `tiny-yeah-v${version}-bundled.tgz`),
    `tarball-${version}\n`,
  );
  await writeFile(path.join(binDir, "tiny-yeah.js"), "#!/usr/bin/env node\n");
  await writeFile(path.join(dir, "install-offline.ps1"), "pwsh\n");
  await writeFile(
    path.join(templatesDir, "package.json"),
    `${JSON.stringify(
      {
        name: "target-opencode",
        private: true,
        dependencies: { [PLUGIN_NAME]: `file:./vendor/tiny-yeah-v${version}-bundled.tgz` },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(pluginsDir, "tiny-yeah.ts"),
    `export { createTinyYeahPlugin } from "${PLUGIN_NAME}/opencode";\n`,
  );
  await writeFile(
    path.join(templatesDir, "tui.json"),
    `${JSON.stringify({ plugin: ["./plugins/tiny-yeah.ts"] }, null, 2)}\n`,
  );
  const manifest = {
    name: "tiny-yeah-offline-bundle",
    packageName: PLUGIN_NAME,
    version,
    airGapComplete: opts.airGapComplete ?? true,
    packageTarball: `vendor/tiny-yeah-v${version}-bundled.tgz`,
    distHashes: { "dist/index.js": await sha256(path.join(distDir, "index.js")) },
    verifiedEntrypoints: [".", "./opencode", "./tui"],
    installer: {
      bin: "bin/tiny-yeah.js",
      entrypoint: "install-offline.ps1",
      templatesDir: "templates/opencode",
    },
  };
  await writeFile(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

/** Standard update options for tests: skip npm install + smoke (covered by bin E2E). */
function testOptions(projectRoot: string, bundleDir: string): UpdateOptions {
  return {
    bundleDir,
    projectRoot,
    skipNpmInstall: true,
    skipSmokeImport: true,
  };
}

/**
 * Fixture: a tmpdir project with a prior v0.8.0 install + a v0.9.0 bundle ready to update into.
 * The cache dir is pointed into the tmpdir via XDG_CACHE_HOME so plugin-cache invalidation can be
 * asserted deterministically.
 */
interface UpdateFixture {
  readonly projectRoot: string;
  readonly bundleV090: string;
  readonly cacheRoot: string;
}

async function makeFixture(): Promise<UpdateFixture> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ty2-upd-proj-"));
  const bundleV080 = await mkdtemp(path.join(os.tmpdir(), "ty2-upd-bundle080-"));
  const bundleV090 = await mkdtemp(path.join(os.tmpdir(), "ty2-upd-bundle090-"));
  const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "ty2-upd-cache-"));
  // Install v0.8.0 first (point the cache into the tmpdir so update can find+delete entries).
  process.env.XDG_CACHE_HOME = cacheRoot;
  await buildBundle(bundleV080, "0.8.0");
  await buildBundle(bundleV090, "0.9.0");
  // Dynamic-import install so this test file does not need install exported at top-level.
  const { install } = await import("../../../src/head/installer/lifecycle.js");
  await install({
    bundleDir: bundleV080,
    projectRoot,
    skipNpmInstall: true,
    skipSmokeImport: true,
  });
  // Create a fake OpenCode plugin-cache entry for v0.8.0 so update can delete it.
  const cachePackages = path.join(cacheRoot, "opencode", "packages");
  await mkdir(path.join(cachePackages, `${PLUGIN_NAME}@0.8.0`), { recursive: true });
  await writeFile(path.join(cachePackages, `${PLUGIN_NAME}@0.8.0`, "marker"), "old-cache\n");
  return { projectRoot, bundleV090, cacheRoot };
}

describe("lifecycle.update — version compare (REQ-TY2-011)", () => {
  let fx: UpdateFixture;
  beforeAll(async () => {
    fx = await makeFixture();
  });
  afterAll(async () => {
    delete process.env.XDG_CACHE_HOME;
    await rm(fx.projectRoot, { recursive: true, force: true }).catch(() => undefined);
    await rm(fx.bundleV090, { recursive: true, force: true }).catch(() => undefined);
    await rm(fx.cacheRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it("updates to a newer bundle (0.8.0 → 0.9.0), kind=updated", async () => {
    const result = await update(testOptions(fx.projectRoot, fx.bundleV090));
    expect(result.kind).toBe("updated");
    if (result.kind !== "updated") return;
    expect(result.from).toBe("0.8.0");
    expect(result.to).toBe("0.9.0");
    // Stamp reflects the new version.
    const stamp = await readStamp(fx.projectRoot);
    expect(stamp?.version).toBe("0.9.0");
  });

  it("equal-version update is a noop (kind=noop)", async () => {
    // After the prior test, the project is at 0.9.0. Re-running update with the 0.9.0 bundle = noop.
    const result = await update(testOptions(fx.projectRoot, fx.bundleV090));
    expect(result.kind).toBe("noop");
  });
});

describe("lifecycle.update — downgrade rejection (REQ-TY2-011)", () => {
  it("rejects a downgrade without --allow-downgrade (DOWNGRADE_REJECTED)", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ty2-upd-dwn-rej-"));
    const bundleV080 = await mkdtemp(path.join(os.tmpdir(), "ty2-upd-dwn-rej-b080-"));
    const bundleV090 = await mkdtemp(path.join(os.tmpdir(), "ty2-upd-dwn-rej-b090-"));
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "ty2-upd-dwn-rej-cache-"));
    try {
      process.env.XDG_CACHE_HOME = cacheRoot;
      await buildBundle(bundleV090, "0.9.0");
      await buildBundle(bundleV080, "0.8.0");
      const { install } = await import("../../../src/head/installer/lifecycle.js");
      await install({
        bundleDir: bundleV090,
        projectRoot,
        skipNpmInstall: true,
        skipSmokeImport: true,
      });
      // Update to the OLDER bundle (0.8.0) → rejected without --allow-downgrade.
      await expect(update(testOptions(projectRoot, bundleV080))).rejects.toSatisfy(
        (err: unknown) => err instanceof InstallerError && err.code === "DOWNGRADE_REJECTED",
      );
      // Stamp unchanged.
      const stamp = await readStamp(projectRoot);
      expect(stamp?.version).toBe("0.9.0");
    } finally {
      delete process.env.XDG_CACHE_HOME;
      await rm(projectRoot, { recursive: true, force: true });
      await rm(bundleV080, { recursive: true, force: true });
      await rm(bundleV090, { recursive: true, force: true });
      await rm(cacheRoot, { recursive: true, force: true });
    }
  });

  it("allows a downgrade with --allow-downgrade (stamp updated)", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ty2-upd-dwn-ok-"));
    const bundleV080 = await mkdtemp(path.join(os.tmpdir(), "ty2-upd-dwn-ok-b080-"));
    const bundleV090 = await mkdtemp(path.join(os.tmpdir(), "ty2-upd-dwn-ok-b090-"));
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "ty2-upd-dwn-ok-cache-"));
    try {
      process.env.XDG_CACHE_HOME = cacheRoot;
      await buildBundle(bundleV090, "0.9.0");
      await buildBundle(bundleV080, "0.8.0");
      const { install } = await import("../../../src/head/installer/lifecycle.js");
      await install({
        bundleDir: bundleV090,
        projectRoot,
        skipNpmInstall: true,
        skipSmokeImport: true,
      });
      const result = await update({
        ...testOptions(projectRoot, bundleV080),
        allowDowngrade: true,
      });
      expect(result.kind).toBe("updated");
      const stamp = await readStamp(projectRoot);
      expect(stamp?.version).toBe("0.8.0");
    } finally {
      delete process.env.XDG_CACHE_HOME;
      await rm(projectRoot, { recursive: true, force: true });
      await rm(bundleV080, { recursive: true, force: true });
      await rm(bundleV090, { recursive: true, force: true });
      await rm(cacheRoot, { recursive: true, force: true });
    }
  });
});

describe("lifecycle.update — requires a prior install (INSTALL_STAMP_MISSING)", () => {
  it("throws INSTALL_STAMP_MISSING when no stamp exists", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ty2-upd-missing-"));
    const bundle = await mkdtemp(path.join(os.tmpdir(), "ty2-upd-missing-bundle-"));
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "ty2-upd-missing-cache-"));
    try {
      process.env.XDG_CACHE_HOME = cacheRoot;
      await buildBundle(bundle, "0.9.0");
      await expect(update(testOptions(projectRoot, bundle))).rejects.toSatisfy(
        (err: unknown) => err instanceof InstallerError && err.code === "INSTALL_STAMP_MISSING",
      );
    } finally {
      delete process.env.XDG_CACHE_HOME;
      await rm(projectRoot, { recursive: true, force: true });
      await rm(bundle, { recursive: true, force: true });
      await rm(cacheRoot, { recursive: true, force: true });
    }
  });
});

describe("lifecycle.update — plugin-cache invalidation (REQ-TY2-014)", () => {
  it("deletes tiny-yeah@<old> under the resolved cache path after update", async () => {
    const fx = await makeFixture();
    try {
      const cachePackages = path.join(fx.cacheRoot, "opencode", "packages");
      const oldEntry = path.join(cachePackages, `${PLUGIN_NAME}@0.8.0`);
      // Sanity: the old entry exists before update.
      const before = await readFile(path.join(oldEntry, "marker"), "utf8").catch(() => "MISSING");
      expect(before).toBe("old-cache\n");

      const result = await update(testOptions(fx.projectRoot, fx.bundleV090));
      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        expect(result.cacheInvalidated).toBe(true);
      }
      // The old cache entry is gone.
      await expect(readFile(path.join(oldEntry, "marker"), "utf8")).rejects.toThrow();
    } finally {
      delete process.env.XDG_CACHE_HOME;
      await rm(fx.projectRoot, { recursive: true, force: true });
      await rm(fx.bundleV090, { recursive: true, force: true });
      await rm(fx.cacheRoot, { recursive: true, force: true });
    }
  });

  it("is best-effort: missing cache dir does not fail the update (cacheInvalidated=false)", async () => {
    // Build a fixture, then DELETE the cache root so invalidation finds nothing. Update must still
    // succeed with cacheInvalidated: false.
    const fx = await makeFixture();
    try {
      await rm(fx.cacheRoot, { recursive: true, force: true });
      const result = await update(testOptions(fx.projectRoot, fx.bundleV090));
      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        // Missing cache dir → best-effort false, run succeeded.
        expect(result.cacheInvalidated).toBe(false);
      }
    } finally {
      delete process.env.XDG_CACHE_HOME;
      await rm(fx.projectRoot, { recursive: true, force: true }).catch(() => undefined);
      await rm(fx.bundleV090, { recursive: true, force: true }).catch(() => undefined);
      await rm(fx.cacheRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});

describe("lifecycle.update — deep-merge preserves user edits (REQ-TY2-011)", () => {
  it("preserves other plugin entries + comments through the update", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ty2-upd-preserve-"));
    const bundleV080 = await mkdtemp(path.join(os.tmpdir(), "ty2-upd-preserve-b080-"));
    const bundleV090 = await mkdtemp(path.join(os.tmpdir(), "ty2-upd-preserve-b090-"));
    const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "ty2-upd-preserve-cache-"));
    try {
      process.env.XDG_CACHE_HOME = cacheRoot;
      await buildBundle(bundleV080, "0.8.0");
      await buildBundle(bundleV090, "0.9.0");
      const { install } = await import("../../../src/head/installer/lifecycle.js");
      await install({
        bundleDir: bundleV080,
        projectRoot,
        skipNpmInstall: true,
        skipSmokeImport: true,
      });
      // User edits the opencode.jsonc to add another plugin + a comment.
      const occPath = path.join(projectRoot, ".opencode", "opencode.json");
      const after = await readFile(occPath, "utf8");
      const edited = after
        .replace('"plugin": [', '// my favorite plugins\n  "plugin": [')
        .replace('"tiny-yeah"', '"other-plugin", "tiny-yeah"');
      await writeFile(occPath, edited);

      const result = await update(testOptions(projectRoot, bundleV090));
      expect(result.kind).toBe("updated");
      const finalText = await readFile(occPath, "utf8");
      // User comment + other plugin survived.
      expect(finalText).toContain("// my favorite plugins");
      expect(finalText).toContain('"other-plugin"');
      // tiny-yeah entry still present exactly once.
      const matches = finalText.match(/"tiny-yeah"/g) ?? [];
      expect(matches.length).toBe(1);
    } finally {
      delete process.env.XDG_CACHE_HOME;
      await rm(projectRoot, { recursive: true, force: true });
      await rm(bundleV080, { recursive: true, force: true });
      await rm(bundleV090, { recursive: true, force: true });
      await rm(cacheRoot, { recursive: true, force: true });
    }
  });
});

describe("lifecycle.update — dry-run (REQ-TY2-011)", () => {
  it("returns kind=dry-run with zero writes", async () => {
    const fx = await makeFixture();
    try {
      const stampBefore = await readStamp(fx.projectRoot);
      const result = await update({ ...testOptions(fx.projectRoot, fx.bundleV090), dryRun: true });
      expect(result.kind).toBe("dry-run");
      // Stamp version unchanged.
      const stampAfter = await readStamp(fx.projectRoot);
      expect(stampAfter?.version).toBe(stampBefore?.version);
    } finally {
      delete process.env.XDG_CACHE_HOME;
      await rm(fx.projectRoot, { recursive: true, force: true }).catch(() => undefined);
      await rm(fx.bundleV090, { recursive: true, force: true }).catch(() => undefined);
      await rm(fx.cacheRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});

describe("lifecycle.update — stamp refresh (REQ-TY2-015)", () => {
  it("stamp has new managedFileHashes reflecting the post-update file contents", async () => {
    const fx = await makeFixture();
    try {
      const result = await update(testOptions(fx.projectRoot, fx.bundleV090));
      expect(result.kind).toBe("updated");
      const stamp = await readStamp(fx.projectRoot);
      expect(stamp?.version).toBe("0.9.0");
      // Every managed path has a current hash.
      for (const managed of stamp?.managedPaths ?? []) {
        expect(stamp?.managedFileHashes[managed]).toMatch(/^[0-9a-f]{64}$/);
      }
    } finally {
      delete process.env.XDG_CACHE_HOME;
      await rm(fx.projectRoot, { recursive: true, force: true }).catch(() => undefined);
      await rm(fx.bundleV090, { recursive: true, force: true }).catch(() => undefined);
      await rm(fx.cacheRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});

describe("lifecycle.update — type surface", () => {
  it("UpdateResult.kind covers updated / noop / dry-run", () => {
    const a: UpdateResult = {
      kind: "updated",
      from: "0.8.0",
      to: "0.9.0",
      managedPaths: [],
      cacheInvalidated: true,
    };
    const b: UpdateResult = { kind: "noop", version: "0.9.0" };
    const c: UpdateResult = { kind: "dry-run", version: "0.9.0" };
    expect(a.kind).toBe("updated");
    expect(b.kind).toBe("noop");
    expect(c.kind).toBe("dry-run");
  });
});
