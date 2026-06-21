// UNIT: lifecycle.uninstall (SPEC-TINY-YEAH-002 REQ-TY2-012, strategy §7 uninstall safety).
//
// Uninstall lifecycle E2E into a tmpdir project. The LOAD-BEARING safety property is the
// HASH-COMPARE skip (REQ-TY2-012 AC + MAJOR #2): a managed file whose current SHA-256 no longer
// matches the stamp's recorded hash MUST be skipped (the user edited it), NEVER deleted.
//
// Covered:
//   - REQ-TY2-012 (hash-compare): unmodified managed files removed; user-modified skipped + reported
//   - REQ-TY2-012 (missing = alreadyAbsent, not an error)
//   - REQ-TY2-012 (plugin entry stripped from opencode.json, backup created)
//   - REQ-TY2-012 (--purge-backups removes .backup-<ts>; default PRESERVES them — F6)
//   - REQ-TY2-012 (uninstall when not installed = noop exit 0)
//   - REQ-TY2-012 (user-owned files NEVER deleted — regression guard)
//   - stamp removed at the end

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type UninstallOptions,
  type UninstallResult,
  uninstall,
} from "../../../src/head/installer/lifecycle.js";
import { readStamp } from "../../../src/head/installer/stamp.js";

const PLUGIN_NAME = "tiny-yeah";

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

async function buildBundle(dir: string, version = "0.8.0"): Promise<string> {
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
    airGapComplete: true,
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

function testOptions(projectRoot: string): UninstallOptions {
  return { projectRoot };
}

/**
 * Fixture: a tmpdir project with a prior v0.8.0 install. The hash-compare baseline is established
 * by the install's stamp.managedFileHashes.
 */
async function makeInstalledProject(): Promise<{ projectRoot: string; bundleDir: string }> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ty2-uninst-proj-"));
  const bundleDir = await mkdtemp(path.join(os.tmpdir(), "ty2-uninst-bundle-"));
  await buildBundle(bundleDir, "0.8.0");
  const { install } = await import("../../../src/head/installer/lifecycle.js");
  await install({
    bundleDir,
    projectRoot,
    skipNpmInstall: true,
    skipSmokeImport: true,
  });
  return { projectRoot, bundleDir };
}

describe("lifecycle.uninstall — removes unmodified managed files (REQ-TY2-012)", () => {
  let projectRoot: string;
  let bundleDir: string;
  beforeAll(async () => {
    ({ projectRoot, bundleDir } = await makeInstalledProject());
  });
  afterAll(async () => {
    await rm(projectRoot, { recursive: true, force: true }).catch(() => undefined);
    await rm(bundleDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("removes all managed paths that still match their recorded hash (except opencode config)", async () => {
    const stamp = await readStamp(projectRoot);
    expect(stamp).not.toBeNull();
    const result = await uninstall(testOptions(projectRoot));
    expect(result.kind).toBe("uninstalled");
    if (result.kind !== "uninstalled") return;
    // Every managed path that existed + matched is reported as removed — EXCEPT the opencode
    // config, which is surgically edited (plugin entry stripped) rather than deleted wholesale.
    for (const managed of stamp?.managedPaths ?? []) {
      const abs = path.join(projectRoot, managed);
      const isOpencodeConfig = /opencode\.json[c]?$/.test(managed);
      if (isOpencodeConfig) {
        // The config survives with the plugin entry removed.
        const text = await readFile(abs, "utf8");
        expect(text).not.toContain('"tiny-yeah"');
      } else {
        await expect(readFile(abs, "utf8")).rejects.toThrow();
      }
    }
    expect(result.removed.length).toBeGreaterThan(0);
  });

  it("removes the install stamp at the end", async () => {
    const stamp = await readStamp(projectRoot);
    expect(stamp).toBeNull();
  });
});

describe("lifecycle.uninstall — HASH-COMPARE skip (REQ-TY2-012 MAJOR #2, load-bearing)", () => {
  it("SKIPS a user-modified managed file and lists it in skippedUserModified", async () => {
    const { projectRoot, bundleDir } = await makeInstalledProject();
    try {
      const stamp = await readStamp(projectRoot);
      expect(stamp).not.toBeNull();
      // Hand-edit one managed file (the plugin shim) so its hash no longer matches the stamp.
      const shimRel = path.join(".opencode", "plugins", "tiny-yeah.ts");
      expect(stamp?.managedPaths.includes(shimRel)).toBe(true);
      await writeFile(
        path.join(projectRoot, shimRel),
        "// USER EDITED THIS FILE — uninstall must NOT delete it\n",
      );
      // Sanity: the file's current hash no longer matches the stamp.
      const currentHash = await sha256(path.join(projectRoot, shimRel));
      expect(currentHash).not.toBe(stamp?.managedFileHashes[shimRel]);

      const result = await uninstall(testOptions(projectRoot));
      expect(result.kind).toBe("uninstalled");
      if (result.kind !== "uninstalled") return;
      // The user-edited file SURVIVES.
      expect(result.skippedUserModified).toContain(shimRel);
      const survived = await readFile(path.join(projectRoot, shimRel), "utf8");
      expect(survived).toContain("USER EDITED THIS FILE");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(bundleDir, { recursive: true, force: true });
    }
  });

  it("missing managed file = alreadyAbsent (not an error)", async () => {
    const { projectRoot, bundleDir } = await makeInstalledProject();
    try {
      const stamp = await readStamp(projectRoot);
      // Pre-delete one managed file so uninstall finds it already gone.
      const tuiRel = path.join(".opencode", "tui.json");
      expect(stamp?.managedPaths.includes(tuiRel)).toBe(true);
      await rm(path.join(projectRoot, tuiRel), { force: true });

      const result = await uninstall(testOptions(projectRoot));
      expect(result.kind).toBe("uninstalled");
      if (result.kind !== "uninstalled") return;
      expect(result.alreadyAbsent).toContain(tuiRel);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(bundleDir, { recursive: true, force: true });
    }
  });
});

describe("lifecycle.uninstall — plugin entry stripped from opencode.json (REQ-TY2-012)", () => {
  it("removes the tiny-yeah plugin entry and creates a backup", async () => {
    const { projectRoot, bundleDir } = await makeInstalledProject();
    try {
      const occPath = path.join(projectRoot, ".opencode", "opencode.json");
      const before = await readFile(occPath, "utf8");
      expect(before).toContain('"tiny-yeah"');

      await uninstall(testOptions(projectRoot));

      const after = await readFile(occPath, "utf8");
      expect(after).not.toContain('"tiny-yeah"');
      // A backup of the prior config exists.
      const names = await readdir(path.join(projectRoot, ".opencode"));
      const backup = names.find((n) => n.startsWith("opencode.json.backup-"));
      expect(backup).toBeDefined();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(bundleDir, { recursive: true, force: true });
    }
  });
});

describe("lifecycle.uninstall — backups default PRESERVED, --purge-backups removes (REQ-TY2-012 F6)", () => {
  it("default preserves .backup-<ts> files", async () => {
    const { projectRoot, bundleDir } = await makeInstalledProject();
    try {
      // Run install a second time with --force to generate a backup, then uninstall.
      // (The first install creates no backup since there was no prior file.)
      const { install } = await import("../../../src/head/installer/lifecycle.js");
      // Edit a managed file so the second install is forced to back it up.
      const pkgRel = path.join(".opencode", "package.json");
      await writeFile(path.join(projectRoot, pkgRel), '{"prior":"content"}\n');
      await install({
        bundleDir,
        projectRoot,
        force: true,
        skipNpmInstall: true,
        skipSmokeImport: true,
      });
      // Now there is at least one .backup-<ts> file.
      const namesBefore = await readdir(path.join(projectRoot, ".opencode"));
      const backupsBefore = namesBefore.filter((n) => n.includes(".backup-"));
      expect(backupsBefore.length).toBeGreaterThan(0);

      await uninstall(testOptions(projectRoot));

      // Backups are PRESERVED (default).
      const namesAfter = await readdir(path.join(projectRoot, ".opencode"));
      const backupsAfter = namesAfter.filter((n) => n.includes(".backup-"));
      expect(backupsAfter.length).toBeGreaterThan(0);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(bundleDir, { recursive: true, force: true });
    }
  });

  it("--purge-backups removes the .backup-<ts> files for managed paths", async () => {
    const { projectRoot, bundleDir } = await makeInstalledProject();
    try {
      const { install } = await import("../../../src/head/installer/lifecycle.js");
      const pkgRel = path.join(".opencode", "package.json");
      await writeFile(path.join(projectRoot, pkgRel), '{"prior":"content"}\n');
      await install({
        bundleDir,
        projectRoot,
        force: true,
        skipNpmInstall: true,
        skipSmokeImport: true,
      });
      const result = await uninstall({ ...testOptions(projectRoot), purgeBackups: true });
      expect(result.kind).toBe("uninstalled");
      if (result.kind !== "uninstalled") return;
      expect(result.purgedBackups.length).toBeGreaterThan(0);
      // The purge removed the backup files.
      const names = await readdir(path.join(projectRoot, ".opencode"));
      const backups = names.filter((n) => n.includes(".backup-"));
      expect(backups.length).toBe(0);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(bundleDir, { recursive: true, force: true });
    }
  });
});

describe("lifecycle.uninstall — idempotent when not installed (REQ-TY2-012)", () => {
  it("returns kind=noop when no stamp exists", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ty2-uninst-noop-"));
    try {
      const result = await uninstall(testOptions(projectRoot));
      expect(result.kind).toBe("noop");
      if (result.kind === "noop") {
        expect(result.reason).toBe("not-installed");
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

describe("lifecycle.uninstall — user-owned files NEVER deleted (REQ-TY2-012 regression guard)", () => {
  it("preserves a user-owned file under .opencode/ that is not in managedPaths", async () => {
    const { projectRoot, bundleDir } = await makeInstalledProject();
    try {
      // Drop a user-owned file + directory under .opencode/ that the installer never tracked.
      const userFile = path.join(projectRoot, ".opencode", "my-skill.md");
      const userDir = path.join(projectRoot, ".opencode", "my-configs");
      await writeFile(userFile, "# my custom skill\n");
      await mkdir(userDir, { recursive: true });
      await writeFile(path.join(userDir, "settings.json"), "{}\n");

      const stamp = await readStamp(projectRoot);
      expect(stamp?.managedPaths.includes(path.join(".opencode", "my-skill.md"))).toBe(false);

      await uninstall(testOptions(projectRoot));

      // The user file + dir SURVIVE.
      const survived = await readFile(userFile, "utf8");
      expect(survived).toBe("# my custom skill\n");
      const survivedDir = await readdir(userDir);
      expect(survivedDir).toContain("settings.json");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(bundleDir, { recursive: true, force: true });
    }
  });
});

describe("lifecycle.uninstall — type surface", () => {
  it("UninstallResult.kind covers uninstalled / noop / dry-run", () => {
    const a: UninstallResult = {
      kind: "uninstalled",
      version: "0.8.0",
      removed: [],
      skippedUserModified: [],
      alreadyAbsent: [],
      purgedBackups: [],
    };
    const b: UninstallResult = { kind: "noop", reason: "not-installed" };
    const c: UninstallResult = { kind: "dry-run" };
    expect(a.kind).toBe("uninstalled");
    expect(b.kind).toBe("noop");
    expect(c.kind).toBe("dry-run");
  });
});
