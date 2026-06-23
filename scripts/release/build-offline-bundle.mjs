#!/usr/bin/env node
// Tiny-Yeah offline-bundle build (SPEC-TINY-YEAH-001 REQ-TY-022 + SPEC-TINY-YEAH-002 REQ-TY2-001).
//
// Produces tiny-yeah-offline-v{VERSION}.tar.gz: bundles dist/, package.json, package-lock.json,
// README, and (when the build machine has network/cache access) ALL production dependency
// tarballs so `npm install --offline` works air-gapped.
//
// SPEC-TINY-YEAH-002 Phase 0 extension: the bundle is now SELF-INSTALLING. In addition to the
// dist/vendor/manifest payload, the bundle also carries:
//   - bin/tiny-yeah.js (the hermetic, dep-free installer CLI — REQ-TY2-018)
//   - templates/opencode/{package.json, plugins/tiny-yeah.ts, tui.json} (install templates,
//     copied verbatim with the template package.json's dependency string materialized to the
//     actual vendored tarball name — strategy §4 "emit=copy for templates")
//   - install-offline.ps1 (the PowerShell air-gapped entrypoint — D1, REQ-TY2-016)
// The manifest gains an `installer` block pointing at these. airGapComplete semantics are
// unchanged (these are repo files — no network needed to include them).
//
// HONEST DEGRADATION: if dependency materialization fails (no network / empty cache), the script
// falls back to `npm pack` of the project alone and sets manifest.dependencyStrategy =
// "project-only-pack" + manifest.airGapComplete = false. This is reported plainly — the bundle
// is still a valid self-contained tarball of the PROJECT, but a consumer must run
// `npm install` (online) to fetch dependencies. The manifest never claims air-gap completeness
// that could not be verified.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, copyFile, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runNpm } from "./npm-runner.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const maxBuffer = 1024 * 1024 * 32;

function parseArgs(argv) {
  const parsed = { out: path.join(repoRoot, "release"), keepTemp: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error("--out requires a directory");
      parsed.out = path.resolve(value);
      index += 1;
    } else if (arg === "--keep-temp") {
      parsed.keepTemp = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex");
}

function npmEnv(cacheDir) {
  return {
    ...process.env,
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_cache: cacheDir,
  };
}

async function tryInstallProductionDeps(stagingDir, cacheDir) {
  // Returns { materialized: boolean, closure: object|null, error: string|null }.
  try {
    await runNpm(["install", "--omit=dev", "--cache", cacheDir, "--ignore-scripts", "--no-audit", "--fund=false"], {
      cwd: stagingDir,
      env: npmEnv(cacheDir),
      maxBuffer,
    });
    const closure = JSON.parse(
      (await runNpm(["ls", "--omit=dev", "--json"], { cwd: stagingDir, maxBuffer })).stdout,
    );
    return { materialized: true, closure, error: null };
  } catch (error) {
    const stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : "";
    if (/ENOTCACHED|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|network|fetch failed/i.test(stderr)) {
      return {
        materialized: false,
        closure: null,
        error: "network/cache unavailable for production dependency materialization",
      };
    }
    return { materialized: false, closure: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function tryMaterializeProductionDepsFromRepoNodeModules(stagingDir, cacheDir) {
  try {
    await access(path.join(repoRoot, "node_modules"));
    await rm(path.join(stagingDir, "node_modules"), { recursive: true, force: true });
    await cp(path.join(repoRoot, "node_modules"), path.join(stagingDir, "node_modules"), { recursive: true });
    await runNpm(["prune", "--omit=dev", "--cache", cacheDir, "--ignore-scripts", "--no-audit", "--fund=false"], {
      cwd: stagingDir,
      env: npmEnv(cacheDir),
      maxBuffer,
    });
    const closure = JSON.parse(
      (await runNpm(["ls", "--omit=dev", "--json"], { cwd: stagingDir, maxBuffer })).stdout,
    );
    return { materialized: true, closure, error: null, source: "repo-node_modules-prune" };
  } catch (error) {
    return { materialized: false, closure: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function writeBundleReadme(bundleDir, version, tarballName, airGapComplete) {
  const status = airGapComplete
    ? "This bundle is self-contained: production dependency tarballs are vendored and `npm install --offline` works without registry access."
    : "DEPENDENCY NOTE: production dependencies could NOT be vendored (build machine lacked network/cache). This bundle contains the project tarball only; a consumer must run `npm install` (online) to fetch dependencies. The manifest reports `airGapComplete: false`.";
  await writeFile(
    path.join(bundleDir, "README-offline.md"),
    `# Tiny-Yeah Offline Bundle

Version: ${version}

Runtime: Node >=22.5, ESM. Shell: PowerShell 7+ (orchestration must not assume Unix-only tools).

Entry points (package.json exports):
- \`.\` -> dist/index.js (library surface)
- \`./opencode\` -> dist/head/opencode/plugin.js (OpenCode Plugin)
- \`./tui\` -> dist/head/opencode/tui-plugin.js (TUI surface)

Install into a consumer (air-gapped, when complete):

\`\`\`powershell
# consumer package.json: { "dependencies": { "tiny-yeah": "file:./vendor/${tarballName}" } }
npm install --offline --ignore-scripts --no-audit --fund=false
\`\`\`

${status}

Tiny-Yeah is licensed per package.json \`license\`. See the project LICENSE if present.
`,
  );
}

/**
 * SPEC-TINY-YEAH-002 Phase 0: copy the self-installing entries into the bundle and materialize
 * the template package.json's dependency string to the actual vendored tarball name.
 *
 * Entries (strategy §4 "emit=copy for templates"):
 *   - bin/tiny-yeah.js                  (verbatim; the hermetic installer CLI)
 *   - templates/opencode/package.json   (verbatim, BUT dependencies.tiny-yeah rewritten to
 *                                        `file:./vendor/<actualTarballName>` so it tracks the
 *                                        real vendored artifact including the conditional
 *                                        `-bundled` suffix)
 *   - templates/opencode/plugins/tiny-yeah.ts (verbatim)
 *   - templates/opencode/tui.json       (verbatim)
 *   - install-offline.ps1               (verbatim; PowerShell air-gapped entrypoint)
 *
 * The repo template package.json carries the `${VERSION}` placeholder as its canonical form
 * (deliverable A.3); here we replace the ENTIRE dependency value with the real tarball ref so
 * both air-gap states (bundled vs project-only) produce a correct, installable template.
 *
 * @param {string} bundleDir
 * @param {string} actualTarballName  e.g. "tiny-yeah-v0.6.0-bundled.tgz"
 * @returns {Promise<{ bin: string, entrypoint: string, templatesDir: string }>}
 */
async function writeInstallerEntries(bundleDir, actualTarballName) {
  // bin/tiny-yeah.js — verbatim copy.
  const binDest = path.join(bundleDir, "bin", "tiny-yeah.js");
  await mkdir(path.join(bundleDir, "bin"), { recursive: true });
  await copyFile(path.join(repoRoot, "bin", "tiny-yeah.js"), binDest);

  // install-offline.ps1 — verbatim copy at bundle root.
  const ps1Dest = path.join(bundleDir, "install-offline.ps1");
  await copyFile(path.join(repoRoot, "install-offline.ps1"), ps1Dest);

  // templates/opencode/ — recursive copy, then materialize package.json.
  const templatesSrc = path.join(repoRoot, "templates", "opencode");
  const templatesDest = path.join(bundleDir, "templates", "opencode");
  await cp(templatesSrc, templatesDest, { recursive: true });

  const templatePackagePath = path.join(templatesDest, "package.json");
  const templatePackage = JSON.parse(await readFile(templatePackagePath, "utf8"));
  templatePackage.dependencies = { "tiny-yeah": `file:./vendor/${actualTarballName}` };
  await writeFile(templatePackagePath, `${JSON.stringify(templatePackage, null, 2)}\n`);

  return { bin: "bin/tiny-yeah.js", entrypoint: "install-offline.ps1", templatesDir: "templates/opencode" };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const packageJson = await readJson(path.join(repoRoot, "package.json"));
  const version = packageJson.version;
  const bundleName = `tiny-yeah-offline-v${version}`;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tiny-yeah-offline-build-"));
  const stagingDir = path.join(tempRoot, "package");
  const bundleDir = path.join(tempRoot, bundleName);
  const cacheDir = process.env.TINY_YEAH_RELEASE_NPM_CACHE
    ? path.resolve(process.env.TINY_YEAH_RELEASE_NPM_CACHE)
    : path.join(tempRoot, "npm-cache");
  const packCacheDir = path.join(tempRoot, "npm-pack-cache");

  try {
    await runNpm(["run", "build"], { cwd: repoRoot, maxBuffer });
    await mkdir(args.out, { recursive: true });
    await mkdir(cacheDir, { recursive: true });
    await mkdir(packCacheDir, { recursive: true });
    await mkdir(stagingDir, { recursive: true });
    await mkdir(path.join(bundleDir, "vendor"), { recursive: true });

    // Stage dist/ + package.json + package-lock.json + README.
    await access(path.join(repoRoot, "dist"));
    await access(path.join(repoRoot, "package.json"));
    await access(path.join(repoRoot, "package-lock.json"));
    await copyTree(path.join(repoRoot, "dist"), path.join(stagingDir, "dist"));
    await copyFile(path.join(repoRoot, "package.json"), path.join(stagingDir, "package.json"));
    await copyFile(path.join(repoRoot, "package-lock.json"), path.join(stagingDir, "package-lock.json"));
    await copyFile(path.join(repoRoot, "README.md"), path.join(stagingDir, "README.md"));

    // Release package.json: bundleDependencies when materialized, otherwise plain.
    const releasePackageJson = {
      name: packageJson.name,
      version,
      private: packageJson.private ?? false,
      type: packageJson.type,
      description: packageJson.description,
      license: packageJson.license,
      engines: packageJson.engines,
      exports: packageJson.exports,
      dependencies: packageJson.dependencies,
    };

    const installDepResult = await tryInstallProductionDeps(stagingDir, cacheDir);
    const depResult = installDepResult.materialized
      ? { ...installDepResult, source: "staging-npm-install" }
      : await tryMaterializeProductionDepsFromRepoNodeModules(stagingDir, cacheDir);
    const airGapComplete = depResult.materialized;
    if (airGapComplete) {
      releasePackageJson.bundleDependencies = true;
    }
    await writeJson(path.join(stagingDir, "package.json"), releasePackageJson);

    // npm pack the staging dir into the bundle vendor/.
    const packResult = await runNpm(
      ["pack", "--json", "--pack-destination", path.join(bundleDir, "vendor"), "--cache", packCacheDir],
      { cwd: stagingDir, env: npmEnv(packCacheDir), maxBuffer },
    );
    const packed = JSON.parse(packResult.stdout);
    const generatedTarballName = packed[0]?.filename;
    if (typeof generatedTarballName !== "string") throw new Error("npm pack did not return a tarball filename");
    const tarballName = `tiny-yeah-v${version}${airGapComplete ? "-bundled" : ""}.tgz`;
    await rename(path.join(bundleDir, "vendor", generatedTarballName), path.join(bundleDir, "vendor", tarballName));

    await writeBundleReadme(bundleDir, version, tarballName, airGapComplete);

    // SPEC-TINY-YEAH-002 Phase 0: copy the self-installing entries (bin, templates, .ps1) and
    // materialize the template package.json's dependency string to the real vendored tarball.
    const installerDescriptor = await writeInstallerEntries(bundleDir, tarballName);

    // SPEC-TINY-YEAH-002 Phase 2 (REQ-TY2-001): the bundle DIRECTORY carries dist/ at its root
    // so the hermetic bin can dynamically import the installer lifecycle
    // (dist/head/installer/lifecycle.js) before `npm install` materializes the vendored tarball.
    // Without this, the bundle-reader's distHashes check would fail (BUNDLE_FILE_MISSING) because
    // the hash entries reference paths relative to the bundle dir.
    await copyTree(path.join(stagingDir, "dist"), path.join(bundleDir, "dist"));

    const distHashes = {
      "dist/index.js": await hashFile(path.join(stagingDir, "dist", "index.js")),
      "dist/head/opencode/plugin.js": await hashFile(
        path.join(stagingDir, "dist", "head", "opencode", "plugin.js"),
      ),
      "dist/head/opencode/tui-plugin.js": await hashFile(
        path.join(stagingDir, "dist", "head", "opencode", "tui-plugin.js"),
      ),
      // Phase 2: the install lifecycle is load-bearing for the bin's dynamic import. Hash it so
      // bundle-reader verifies its integrity as part of fail-closed (REQ-TY2-002).
      "dist/head/installer/lifecycle.js": await hashFile(
        path.join(stagingDir, "dist", "head", "installer", "lifecycle.js"),
      ),
      "dist/head/installer/opencode-config.js": await hashFile(
        path.join(stagingDir, "dist", "head", "installer", "opencode-config.js"),
      ),
      "dist/head/installer/stamp.js": await hashFile(
        path.join(stagingDir, "dist", "head", "installer", "stamp.js"),
      ),
    };

    const manifest = {
      name: "tiny-yeah-offline-bundle",
      packageName: packageJson.name,
      version,
      createdAt: new Date().toISOString(),
      node: process.version,
      npm: (await runNpm(["--version"], { cwd: repoRoot, maxBuffer })).stdout.trim(),
      packageTarball: `vendor/${tarballName}`,
      dependencyStrategy: airGapComplete
        ? { bundleDependencies: true, materializedFrom: depResult.source, omit: "dev" }
        : {
            projectOnlyPack: true,
            materializedFrom: "none",
            note: `${installDepResult.error}; fallback: ${depResult.error}`,
          },
      airGapComplete,
      dependencyClosure: depResult.closure,
      distHashes,
      verifiedEntrypoints: [".", "./opencode", "./tui"],
      installer: installerDescriptor,
    };
    await writeJson(path.join(bundleDir, "manifest.json"), manifest);

    const archivePath = path.join(args.out, `${bundleName}.tar.gz`);
    await execFileAsync("tar", ["-czf", archivePath, "-C", tempRoot, bundleName], { cwd: repoRoot, maxBuffer });
    await writeFile(
      path.join(args.out, "SHA256SUMS"),
      `${await hashFile(archivePath)}  ${path.basename(archivePath)}\n`,
    );

    const archiveStat = await stat(archivePath);
    console.log(
      JSON.stringify(
        {
          bundle: archivePath,
          checksumFile: path.join(args.out, "SHA256SUMS"),
          version,
          bytes: archiveStat.size,
          airGapComplete,
          dependencyStrategy: manifest.dependencyStrategy,
          tempRoot: args.keepTemp ? tempRoot : undefined,
        },
        null,
        2,
      ),
    );
  } finally {
    if (!args.keepTemp) await rm(tempRoot, { recursive: true, force: true });
  }
}

// Minimal recursive copy (Node fs.cp may be present, but cp is recursive-capable on Node >=16.7).
async function copyTree(src, dest) {
  const { cp } = await import("node:fs/promises");
  await cp(src, dest, { recursive: true });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
