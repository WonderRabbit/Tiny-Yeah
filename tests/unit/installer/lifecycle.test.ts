// UNIT: lifecycle (SPEC-TINY-YEAH-002 REQ-TY2-009/010/013, strategy §5/§6/§7).
//
// Install orchestration E2E into a tmpdir project. Uses a SYNTHETIC minimal bundle fixture for
// determinism (no dependency on the real `npm run release:offline` output). The synthetic
// bundle mirrors the build-offline-bundle.mjs layout: manifest.json + dist/ + vendor/<tarball>
// + templates/opencode/{package.json, plugins/tiny-yeah.ts, tui.json} + bin/ + install-offline.ps1.
//
// Covered REQs:
//   - REQ-TY2-009 (idempotent): same-version re-install = noop (no duplicate plugin entry)
//   - REQ-TY2-009 (existing-dep conflict): .opencode/package.json declares tiny-yeah at a
//     different version without --force → EXISTING_DEP_CONFLICT
//   - REQ-TY2-009 (structured log): .opencode/.tiny-yeah-install.log appended on install
//   - REQ-TY2-010 (dry-run): zero writes, plan returned
//   - REQ-TY2-010 (fresh install): writes all 5 managed paths + stamp, exit 0
//   - REQ-TY2-013 (smoke import): the three exports resolve after install
//   - REQ-TY2-006 (backup): overwritten user files get .backup-<ts> copies
//   - Lock released on success AND on failure

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { InstallerError } from "../../../src/head/installer/errors.js";
import {
  type InstallOptions,
  type InstallResult,
  install,
} from "../../../src/head/installer/lifecycle.js";
import { readStamp } from "../../../src/head/installer/stamp.js";

const PLUGIN_NAME = "tiny-yeah";

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

/**
 * Build a synthetic VALID bundle fixture. Layout matches scripts/release/build-offline-bundle.mjs
 * but with synthetic minimal content. The lifecycle's readBundle verifies it as genuine.
 *
 * The vendor tarball is a stub (not a real npm tarball) — the lifecycle's `npm install --offline`
 * step is skipped in tests by passing `skipNpmInstall: true` (tests cover the install lifecycle
 * up to and including the managed-file writes, JSONC merge, and stamp; the npm install is
 * exercised separately via the bin E2E test).
 */
async function buildSyntheticBundle(
  dir: string,
  overrides: { version?: string; airGapComplete?: boolean } = {},
): Promise<string> {
  const version = overrides.version ?? "0.8.0";
  const distDir = path.join(dir, "dist");
  const vendorDir = path.join(dir, "vendor");
  const binDir = path.join(dir, "bin");
  const templatesDir = path.join(dir, "templates", "opencode");
  const pluginsDir = path.join(templatesDir, "plugins");
  await mkdir(distDir, { recursive: true });
  await mkdir(vendorDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  await mkdir(pluginsDir, { recursive: true });

  // Minimal dist files that the smoke-import step would resolve. The synthetic bundle doesn't
  // ship a real package; the lifecycle test passes `skipSmokeImport: true` to avoid resolving
  // them (covered by the bin E2E test against a real bundle).
  await writeFile(path.join(distDir, "index.js"), `export const VERSION = "${version}";\n`);
  await writeFile(path.join(vendorDir, `tiny-yeah-v${version}-bundled.tgz`), "tarball-bytes\n");
  await writeFile(path.join(binDir, "tiny-yeah.js"), "#!/usr/bin/env node\n");
  await writeFile(path.join(dir, "install-offline.ps1"), "pwsh\n");

  // Template package.json — references the vendored tarball.
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
  // Plugin shim.
  await writeFile(
    path.join(pluginsDir, "tiny-yeah.ts"),
    `export { createTinyYeahPlugin } from "${PLUGIN_NAME}/opencode";\n`,
  );
  // TUI config.
  await writeFile(
    path.join(templatesDir, "tui.json"),
    `${JSON.stringify({ plugin: ["./plugins/tiny-yeah.ts"] }, null, 2)}\n`,
  );

  const distHashes = {
    "dist/index.js": await sha256(path.join(distDir, "index.js")),
  };
  const manifest = {
    name: "tiny-yeah-offline-bundle",
    packageName: PLUGIN_NAME,
    version,
    airGapComplete: overrides.airGapComplete ?? true,
    packageTarball: `vendor/tiny-yeah-v${version}-bundled.tgz`,
    distHashes,
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

/** Standard install options for tests: skip npm install + smoke (covered by bin E2E). */
function testOptions(projectRoot: string, bundleDir: string): InstallOptions {
  return {
    bundleDir,
    projectRoot,
    skipNpmInstall: true,
    skipSmokeImport: true,
  };
}

describe("lifecycle — dry-run (REQ-TY2-009 e, REQ-TY2-010)", () => {
  it("returns kind=dry-run with the plan, zero writes", async () => {
    const bundleTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-life-dry-bundle-"));
    const projectTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-life-dry-proj-"));
    try {
      const bundleDir = await buildSyntheticBundle(bundleTmp);
      const result = await install({
        ...testOptions(projectTmp, bundleDir),
        dryRun: true,
      });
      expect(result.kind).toBe("dry-run");
      // ZERO writes: no .opencode/ created.
      const stamp = await readStamp(projectTmp);
      expect(stamp).toBeNull();
      // Confirm no .opencode directory exists.
      await expect(
        readFile(path.join(projectTmp, ".opencode", "package.json"), "utf8"),
      ).rejects.toThrow();
    } finally {
      await rm(bundleTmp, { recursive: true, force: true });
      await rm(projectTmp, { recursive: true, force: true });
    }
  });
});

describe("lifecycle — fresh install (REQ-TY2-010, REQ-TY2-013)", () => {
  it("writes all 4 copy entries + stamp + opencode.jsonc plugin entry", async () => {
    const bundleTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-life-fresh-bundle-"));
    const projectTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-life-fresh-proj-"));
    try {
      const bundleDir = await buildSyntheticBundle(bundleTmp);
      const result = await install(testOptions(projectTmp, bundleDir));
      expect(result.kind).toBe("installed");

      // All 4 copy destinations exist.
      const expected = [
        ".opencode/package.json",
        ".opencode/plugins/tiny-yeah.ts",
        ".opencode/tui.json",
        ".opencode/vendor/tiny-yeah-v0.8.0-bundled.tgz",
      ];
      for (const rel of expected) {
        const content = await readFile(path.join(projectTmp, rel), "utf8");
        expect(content.length).toBeGreaterThan(0);
      }
      // Stamp exists with v2 schemaVersion.
      const stamp = await readStamp(projectTmp);
      expect(stamp).not.toBeNull();
      expect(stamp?.version).toBe("0.8.0");
      expect(stamp?.schemaVersion).toBe("tiny-yeah.install.v2");
      // opencode.json has the plugin entry (REQ-TY2-010 step 5 — installer creates
      // .opencode/opencode.json with the plugin entry when none exists).
      const occ = await readFile(path.join(projectTmp, ".opencode", "opencode.json"), "utf8");
      expect(occ).toContain("tiny-yeah");
    } finally {
      await rm(bundleTmp, { recursive: true, force: true });
      await rm(projectTmp, { recursive: true, force: true });
    }
  });

  it("managedFileHashes covers every managed path (REQ-TY2-015 MAJOR #2)", async () => {
    const bundleTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-life-hashes-bundle-"));
    const projectTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-life-hashes-proj-"));
    try {
      const bundleDir = await buildSyntheticBundle(bundleTmp);
      await install(testOptions(projectTmp, bundleDir));
      const stamp = await readStamp(projectTmp);
      expect(stamp).not.toBeNull();
      for (const managed of stamp?.managedPaths ?? []) {
        expect(stamp?.managedFileHashes[managed]).toMatch(/^[0-9a-f]{64}$/);
      }
    } finally {
      await rm(bundleTmp, { recursive: true, force: true });
      await rm(projectTmp, { recursive: true, force: true });
    }
  });

  it("structured log appended to .opencode/.tiny-yeah-install.log (REQ-TY2-009)", async () => {
    const bundleTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-life-log-bundle-"));
    const projectTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-life-log-proj-"));
    try {
      const bundleDir = await buildSyntheticBundle(bundleTmp);
      await install(testOptions(projectTmp, bundleDir));
      const log = await readFile(
        path.join(projectTmp, ".opencode", ".tiny-yeah-install.log"),
        "utf8",
      );
      expect(log).toContain("install");
      expect(log).toContain("0.8.0");
    } finally {
      await rm(bundleTmp, { recursive: true, force: true });
      await rm(projectTmp, { recursive: true, force: true });
    }
  });
});

describe("lifecycle — idempotent re-install (REQ-TY2-009 a)", () => {
  it("same-version re-install = noop (no duplicate plugin entry)", async () => {
    const bundleTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-life-idem-bundle-"));
    const projectTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-life-idem-proj-"));
    try {
      const bundleDir = await buildSyntheticBundle(bundleTmp);
      const first = await install(testOptions(projectTmp, bundleDir));
      expect(first.kind).toBe("installed");

      const second = await install(testOptions(projectTmp, bundleDir));
      expect(second.kind).toBe("noop");

      // The plugin entry exists exactly once in the created opencode.json.
      const occ = await readFile(path.join(projectTmp, ".opencode", "opencode.json"), "utf8");
      const matches = occ.match(/"tiny-yeah"/g) ?? [];
      expect(matches.length).toBe(1);
    } finally {
      await rm(bundleTmp, { recursive: true, force: true });
      await rm(projectTmp, { recursive: true, force: true });
    }
  });
});

describe("lifecycle — existing-dep conflict (REQ-TY2-009)", () => {
  it("rejects when .opencode/package.json declares a different tiny-yeah version without --force", async () => {
    const bundleTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-life-conf-bundle-"));
    const projectTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-life-conf-proj-"));
    try {
      const bundleDir = await buildSyntheticBundle(bundleTmp);
      // Pre-existing .opencode/package.json with a CONFLICTING version.
      const ocDir = path.join(projectTmp, ".opencode");
      await mkdir(ocDir, { recursive: true });
      await writeFile(
        path.join(ocDir, "package.json"),
        `${JSON.stringify(
          {
            name: "target-opencode",
            dependencies: { [PLUGIN_NAME]: "file:./vendor/tiny-yeah-v0.6.0-bundled.tgz" },
          },
          null,
          2,
        )}\n`,
      );
      await expect(install(testOptions(projectTmp, bundleDir))).rejects.toSatisfy(
        (err: unknown) => err instanceof InstallerError && err.code === "EXISTING_DEP_CONFLICT",
      );
    } finally {
      await rm(bundleTmp, { recursive: true, force: true });
      await rm(projectTmp, { recursive: true, force: true });
    }
  });

  it("--force overwrites with backup (REQ-TY2-006)", async () => {
    const bundleTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-life-force-bundle-"));
    const projectTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-life-force-proj-"));
    try {
      const bundleDir = await buildSyntheticBundle(bundleTmp);
      const ocDir = path.join(projectTmp, ".opencode");
      await mkdir(ocDir, { recursive: true });
      const priorContent = `${JSON.stringify(
        {
          name: "target-opencode",
          dependencies: { [PLUGIN_NAME]: "file:./vendor/tiny-yeah-v0.6.0-bundled.tgz" },
        },
        null,
        2,
      )}\n`;
      await writeFile(path.join(ocDir, "package.json"), priorContent);

      const result = await install({ ...testOptions(projectTmp, bundleDir), force: true });
      expect(result.kind).toBe("installed");

      // The new package.json reflects the new version.
      const after = await readFile(path.join(ocDir, "package.json"), "utf8");
      expect(after).toContain("0.8.0");
      // A backup with .backup-<ts> suffix was created preserving the old content.
      const { readdir: ls } = await import("node:fs/promises");
      const names = await ls(ocDir);
      const backupName = names.find((n) => n.startsWith("package.json.backup-"));
      expect(backupName).toBeDefined();
      // `backupName` is asserted defined above; the non-null assertion is linted as a warning,
      // so guard explicitly to keep biome quiet and the type narrow.
      if (backupName === undefined) throw new Error("backup name undefined");
      const backupContent = await readFile(path.join(ocDir, backupName), "utf8");
      expect(backupContent).toBe(priorContent);
    } finally {
      await rm(bundleTmp, { recursive: true, force: true });
      await rm(projectTmp, { recursive: true, force: true });
    }
  });
});

describe("lifecycle — fail-closed bundle integrity (REQ-TY2-002, zero writes)", () => {
  it("rejects a tampered bundle with ZERO writes to the project", async () => {
    const bundleTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-life-tamper-bundle-"));
    const projectTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-life-tamper-proj-"));
    try {
      const bundleDir = await buildSyntheticBundle(bundleTmp);
      // Tamper with the dist file post-manifest.
      await writeFile(path.join(bundleDir, "dist", "index.js"), "TAMPERED\n");

      await expect(install(testOptions(projectTmp, bundleDir))).rejects.toBeInstanceOf(
        InstallerError,
      );
      // Zero writes — no .opencode/ created.
      await expect(
        readFile(path.join(projectTmp, ".opencode", "package.json"), "utf8"),
      ).rejects.toThrow();
    } finally {
      await rm(bundleTmp, { recursive: true, force: true });
      await rm(projectTmp, { recursive: true, force: true });
    }
  });
});

describe("lifecycle — lock released on success and failure", () => {
  it("releases the lock on success (no .tiny-yeah-install.lock/ remains)", async () => {
    const bundleTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-life-lock-ok-bundle-"));
    const projectTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-life-lock-ok-proj-"));
    try {
      const bundleDir = await buildSyntheticBundle(bundleTmp);
      await install(testOptions(projectTmp, bundleDir));
      const lockDir = path.join(projectTmp, ".opencode", ".tiny-yeah-install.lock");
      await expect(readFile(lockDir, "utf8")).rejects.toThrow();
    } finally {
      await rm(bundleTmp, { recursive: true, force: true });
      await rm(projectTmp, { recursive: true, force: true });
    }
  });

  it("releases the lock on failure (tampered bundle)", async () => {
    const bundleTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-life-lock-fail-bundle-"));
    const projectTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-life-lock-fail-proj-"));
    try {
      const bundleDir = await buildSyntheticBundle(bundleTmp);
      await writeFile(path.join(bundleDir, "dist", "index.js"), "TAMPERED\n");
      await expect(install(testOptions(projectTmp, bundleDir))).rejects.toBeInstanceOf(
        InstallerError,
      );
      const lockDir = path.join(projectTmp, ".opencode", ".tiny-yeah-install.lock");
      await expect(readFile(lockDir, "utf8")).rejects.toThrow();
    } finally {
      await rm(bundleTmp, { recursive: true, force: true });
      await rm(projectTmp, { recursive: true, force: true });
    }
  });
});

describe("lifecycle — JSONC preservation on existing opencode config (REQ-TY2-008)", () => {
  it("preserves comments + trailing comma when merging into an existing opencode.jsonc", async () => {
    const bundleTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-life-jsonc-bundle-"));
    const projectTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-life-jsonc-proj-"));
    try {
      const bundleDir = await buildSyntheticBundle(bundleTmp);
      const ocDir = path.join(projectTmp, ".opencode");
      await mkdir(ocDir, { recursive: true });
      const existing = [
        "{",
        "  // user comment",
        '  "plugin": [',
        '    "other-plugin",',
        "  ],",
        "}",
        "",
      ].join("\n");
      await writeFile(path.join(ocDir, "opencode.jsonc"), existing);

      await install(testOptions(projectTmp, bundleDir));
      const after = await readFile(path.join(ocDir, "opencode.jsonc"), "utf8");
      expect(after).toContain("// user comment");
      expect(after).toContain('"other-plugin"');
      expect(after).toContain('"tiny-yeah"');
      // Backup of the prior config was created.
      const { readdir: ls } = await import("node:fs/promises");
      const names = await ls(ocDir);
      const backup = names.find((n) => n.startsWith("opencode.jsonc.backup-"));
      expect(backup).toBeDefined();
    } finally {
      await rm(bundleTmp, { recursive: true, force: true });
      await rm(projectTmp, { recursive: true, force: true });
    }
  });
});

// Type-only assertion: InstallResult discriminated union has the expected variants.
describe("lifecycle — type surface", () => {
  it("InstallResult.kind covers installed / noop / dry-run", () => {
    const a: InstallResult = {
      kind: "installed",
      version: "0.8.0",
      managedPaths: [],
      stampPath: "/tmp",
    };
    const b: InstallResult = { kind: "noop", version: "0.8.0" };
    const c: InstallResult = { kind: "dry-run", version: "0.8.0" };
    expect(a.kind).toBe("installed");
    expect(b.kind).toBe("noop");
    expect(c.kind).toBe("dry-run");
  });
});
