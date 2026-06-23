import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { doctor } from "../../../src/head/installer/doctor.js";
import { type InstallOptions, install } from "../../../src/head/installer/lifecycle.js";

const PLUGIN_NAME = "tiny-yeah";

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

async function buildSyntheticBundle(dir: string, version = "0.8.0"): Promise<string> {
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
  await writeFile(path.join(vendorDir, `tiny-yeah-v${version}-bundled.tgz`), "tarball-bytes\n");
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

function testInstallOptions(projectRoot: string, bundleDir: string): InstallOptions {
  return { bundleDir, projectRoot, skipNpmInstall: true, skipSmokeImport: true };
}

async function materializeNodeModulesPackage(
  projectRoot: string,
  version = "0.8.0",
): Promise<void> {
  const pkgRoot = path.join(projectRoot, ".opencode", "node_modules", "tiny-yeah");
  await mkdir(pkgRoot, { recursive: true });
  await writeFile(path.join(pkgRoot, "index.js"), `export const VERSION = "${version}";\n`);
  await writeFile(path.join(pkgRoot, "opencode.js"), `export const NAME = "tiny-yeah/opencode";\n`);
  await writeFile(path.join(pkgRoot, "tui.js"), `export const NAME = "tiny-yeah/tui";\n`);
  const pkgJson = {
    name: "tiny-yeah",
    version,
    type: "module",
    exports: {
      ".": { import: "./index.js", default: "./index.js" },
      "./opencode": { import: "./opencode.js", default: "./opencode.js" },
      "./tui": { import: "./tui.js", default: "./tui.js" },
    },
  };
  await writeFile(path.join(pkgRoot, "package.json"), `${JSON.stringify(pkgJson, null, 2)}\n`);
}

describe("doctor — release archive SHA256SUMS full-mode check", () => {
  it("verifies SHA256SUMS when bundleDir is a release archive path", async () => {
    const bundleTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-doc-full-archive-bundle-"));
    const projectTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-doc-full-archive-proj-"));
    try {
      const bundleDir = await buildSyntheticBundle(bundleTmp);
      const archiveName = "tiny-yeah-offline-v0.8.0.tar.gz";
      const archivePath = path.join(bundleTmp, archiveName);
      const archiveBytes = "archive-bytes\n";
      const archiveHash = createHash("sha256").update(archiveBytes).digest("hex");
      await writeFile(archivePath, archiveBytes);
      await writeFile(path.join(bundleTmp, "SHA256SUMS"), `${archiveHash}  ${archiveName}\n`);
      await install(testInstallOptions(projectTmp, bundleDir));
      await materializeNodeModulesPackage(projectTmp);

      const full = await doctor({
        projectRoot: projectTmp,
        mode: "full",
        bundleDir: archivePath,
      });

      const sha = full.checks.find((check) => check.id === "bundle-sha256sums-full");
      expect(sha?.status).toBe("pass");
      expect(full.summary.overall).not.toBe("broken");
    } finally {
      await rm(bundleTmp, { recursive: true, force: true });
      await rm(projectTmp, { recursive: true, force: true });
    }
  });
});
