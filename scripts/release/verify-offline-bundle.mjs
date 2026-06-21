#!/usr/bin/env node
// Tiny-Yeah offline-bundle verify (SPEC-TINY-YEAH-001 REQ-TY-022 + SPEC-TINY-YEAH-002 REQ-TY2-001/018).
//
// Extracts the tarball produced by build-offline-bundle.mjs to a temp dir, reads the manifest,
// and verifies the bundled project is importable. When manifest.airGapComplete is true, it also
// attempts `npm install --offline` in a consumer dir against a dummy registry (no network) and a
// smoke import. When airGapComplete is false (deps could not be vendored), it verifies only the
// bundled dist/ imports and reports the gap honestly — it does NOT claim the offline install is
// air-gapped-complete.
//
// SPEC-TINY-YEAH-002 Phase 0 extension: also asserts the bundle is SELF-INSTALLING — the new
// entries (bin/tiny-yeah.js, templates/opencode/{package.json,plugins/tiny-yeah.ts,tui.json},
// install-offline.ps1) are present, manifest.installer describes them, and the bin runs
// hermetically (node bin/tiny-yeah.js --version works WITHOUT node_modules — REQ-TY2-018).

import { execFile } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { runNpm } from "./npm-runner.mjs";

const execFileAsync = promisify(execFile);
const maxBuffer = 1024 * 1024 * 32;

function parseArgs(argv) {
  const parsed = { bundle: undefined, keepTemp: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--bundle") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error("--bundle requires an archive path");
      parsed.bundle = path.resolve(value);
      index += 1;
    } else if (arg === "--keep-temp") {
      parsed.keepTemp = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (parsed.bundle === undefined) {
    throw new Error("usage: npm run verify:offline -- --bundle /path/to/tiny-yeah-offline-vX.Y.Z.tar.gz");
  }
  return parsed;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function findBundleDir(tempRoot) {
  const entries = await readdir(tempRoot, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith("tiny-yeah-offline-v"));
  if (dirs.length !== 1) throw new Error(`expected one unpacked tiny-yeah-offline directory, found ${dirs.length}`);
  return path.join(tempRoot, dirs[0].name);
}

async function prepareConsumer(bundleDir, tempRoot, manifest) {
  const consumerRoot = path.join(tempRoot, "consumer");
  const consumerNodeModules = path.join(consumerRoot, "node_modules");
  await mkdir(consumerRoot, { recursive: true });
  await mkdir(consumerNodeModules, { recursive: true });
  const tarballName = path.basename(manifest.packageTarball);
  // Place the project tarball where node can resolve it via file: protocol.
  const packageJson = {
    name: "tiny-yeah-offline-consumer",
    private: true,
    type: "module",
    dependencies: { "tiny-yeah": `file:./${path.basename(manifest.packageTarball)}` },
  };
  await cp(path.join(bundleDir, manifest.packageTarball), path.join(consumerRoot, tarballName));
  await writeFile(path.join(consumerRoot, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  return { consumerRoot, tarballName };
}

async function runSmoke(consumerRoot) {
  // Import the project's entry points from the extracted consumer node_modules. This verifies the
  // bundled dist/ is structurally valid (the ./, ./opencode, ./tui exports resolve).
  const smoke = `
import { createTinyYeahLibrarySurface, VERSION } from "tiny-yeah";
const root = process.cwd();
const surface = createTinyYeahLibrarySurface({ root });
const install = surface.tiny_yeah_install_check;
const pluginMod = await import("tiny-yeah/opencode");
const tuiMod = await import("tiny-yeah/tui");
console.log(JSON.stringify({
  version: VERSION,
  toolCount: Object.keys(surface).length,
  hasInstallCheck: typeof install?.run === "function",
  hasPlugin: typeof pluginMod.createTinyYeahPlugin === "function",
  hasTui: typeof tuiMod.TinyYeahOpenCodeTuiPlugin?.tui === "function",
  tuiId: tuiMod.TinyYeahOpenCodeTuiPlugin?.id,
}));
`;
  const result = await execFileAsync("node", ["--input-type=module", "-e", smoke], {
    cwd: consumerRoot,
    maxBuffer,
  });
  return JSON.parse(result.stdout.trim());
}

/**
 * SPEC-TINY-YEAH-002 Phase 0: verify the bundle is self-installing.
 *
 * Checks (REQ-TY2-001 AC):
 *   - manifest.installer block is present with bin/entrypoint/templatesDir.
 *   - all five new entries exist on disk:
 *       bin/tiny-yeah.js
 *       templates/opencode/package.json
 *       templates/opencode/plugins/tiny-yeah.ts
 *       templates/opencode/tui.json
 *       install-offline.ps1
 *   - the template package.json's dependency string references the actual vendored tarball
 *     (materialization check — no `${VERSION}` placeholder leakage).
 *   - bin hermeticity smoke (REQ-TY2-018 AC): `node <unpack>/bin/tiny-yeah.js --version`
 *     runs from a bare tmpdir with NO node_modules and prints the version. This proves the bin
 *     imports only node: built-ins.
 *
 * Throws on any failure (non-zero exit propagation).
 */
async function verifyInstallerEntries(bundleDir, manifest, tempRoot) {
  const requiredEntries = [
    "bin/tiny-yeah.js",
    "templates/opencode/package.json",
    "templates/opencode/plugins/tiny-yeah.ts",
    "templates/opencode/tui.json",
    "install-offline.ps1",
  ];
  const missing = [];
  for (const rel of requiredEntries) {
    try {
      await access(path.join(bundleDir, rel));
    } catch {
      missing.push(rel);
    }
  }
  if (missing.length > 0) {
    throw new Error(`bundle is missing self-installing entries: ${missing.join(", ")} (REQ-TY2-001)`);
  }
  if (
    !manifest.installer ||
    typeof manifest.installer.bin !== "string" ||
    typeof manifest.installer.entrypoint !== "string" ||
    typeof manifest.installer.templatesDir !== "string"
  ) {
    throw new Error("manifest.installer block is missing or malformed (REQ-TY2-001)");
  }

  // Template package.json materialization: the dependency must point at the real tarball,
  // not the repo-side ${VERSION} placeholder.
  const templatePackage = JSON.parse(
    await readFile(path.join(bundleDir, "templates", "opencode", "package.json"), "utf8"),
  );
  const depRef = templatePackage?.dependencies?.["tiny-yeah"];
  if (typeof depRef !== "string" || !depRef.startsWith("file:./vendor/")) {
    throw new Error(`template package.json tiny-yeah dependency is not a file:./vendor/* ref: ${String(depRef)}`);
  }
  if (depRef.includes("${VERSION}")) {
    throw new Error(`template package.json dependency still carries the \${VERSION} placeholder: ${depRef}`);
  }

  // Bin hermeticity smoke (REQ-TY2-018). Run from a bare tmpdir with no node_modules.
  const bareDir = path.join(tempRoot, "bare-bin-smoke");
  await mkdir(bareDir, { recursive: true });
  // Copy ONLY the bin into the bare dir — no node_modules, no package.json adjacent.
  await cp(path.join(bundleDir, "bin", "tiny-yeah.js"), path.join(bareDir, "tiny-yeah.js"));
  // Stage a manifest.json next to the bin so --version has an authoritative source. This mirrors
  // the bundle layout (manifest.json adjacent to bin/tiny-yeah.js).
  await writeFile(
    path.join(bareDir, "manifest.json"),
    `${JSON.stringify({ version: manifest.version }, null, 2)}\n`,
  );
  const versionResult = await execFileAsync("node", ["tiny-yeah.js", "--version"], {
    cwd: bareDir,
    maxBuffer,
  });
  const printedVersion = versionResult.stdout.trim();
  if (printedVersion !== manifest.version) {
    throw new Error(
      `bin hermeticity smoke failed: --version printed '${printedVersion}' but manifest version is '${manifest.version}'`,
    );
  }
  return { entriesPresent: requiredEntries.length, binVersion: printedVersion };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tiny-yeah-offline-verify-"));
  const report = { bundle: args.bundle, tempRoot: args.keepTemp ? tempRoot : undefined };
  try {
    await execFileAsync("tar", ["-xzf", args.bundle, "-C", tempRoot], { maxBuffer });
    const bundleDir = await findBundleDir(tempRoot);
    const manifest = await readJson(path.join(bundleDir, "manifest.json"));
    report.version = manifest.version;
    report.airGapComplete = manifest.airGapComplete;
    report.dependencyStrategy = manifest.dependencyStrategy;

    // SPEC-TINY-YEAH-002 Phase 0: assert the bundle is self-installing (entries present,
    // manifest.installer block, template materialization, bin hermeticity smoke).
    report.installer = await verifyInstallerEntries(bundleDir, manifest, tempRoot);

    const consumer = await prepareConsumer(bundleDir, tempRoot, manifest);

    let offlineInstallOk = null;
    if (manifest.airGapComplete) {
      // Attempt air-gapped install against a dummy registry (no network).
      const emptyCache = path.join(tempRoot, "empty-npm-cache");
      await mkdir(emptyCache, { recursive: true });
      try {
        await runNpm(
          ["install", "--offline", "--cache", emptyCache, "--ignore-scripts", "--no-audit", "--fund=false"],
          {
            cwd: consumer.consumerRoot,
            env: {
              ...process.env,
              npm_config_registry: "http://127.0.0.1:9/",
              npm_config_audit: "false",
              npm_config_fund: "false",
            },
            maxBuffer,
          },
        );
        offlineInstallOk = true;
      } catch {
        offlineInstallOk = false;
      }
    }
    report.offlineInstallOk = offlineInstallOk;

    // Verify the bundled dist/ imports structurally. This is the part that MUST pass regardless
    // of air-gap status — it proves the project tarball's exports resolve.
    report.smoke = await runSmoke(consumer.consumerRoot);

    // Honest exit policy: if airGapComplete is true but offline install failed, exit non-zero
    // (the bundle claimed completeness it could not deliver). If airGapComplete is false, the
    // smoke import is the gate — we do NOT fail on the absent offline install (documented gap).
    if (manifest.airGapComplete && offlineInstallOk === false) {
      console.error(JSON.stringify({ ...report, exitReason: "air-gapped install failed despite airGapComplete=true" }, null, 2));
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (!args.keepTemp) await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
