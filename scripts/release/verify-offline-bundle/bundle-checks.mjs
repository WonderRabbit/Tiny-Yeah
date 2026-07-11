import { execFile } from "node:child_process";
import { access, cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { runNpm } from "../npm-runner.mjs";
import { maxBuffer } from "./constants.mjs";
import { stableStringify, VerifyOfflineBundleError } from "./errors.mjs";

const execFileAsync = promisify(execFile);

/**
 * Subpaths that MUST NOT appear inside the unpacked offline bundle. The published tiny-yeah
 * package ships only dist/ + package.json (per package.json `files`), so any `src/` tree
 * inside node_modules/tiny-yeah indicates a packaging leak — typically test files smuggled
 * into the standalone runtime copy. REQ-TY2-018.
 */
const FORBIDDEN_STANDALONE_SUBPATHS = ["node_modules/tiny-yeah/src/"];

/**
 * Walk the unpacked bundle and reject forbidden standalone-runtime entries by exact subpath.
 * Runs after extraction and before installer checks so a tampered bundle fails fast with a
 * precise, machine-readable error whose message contains the offending absolute path.
 *
 * readdir(recursive) yields both files and directories; among all matches we report the
 * DEEPEST path (longest relative path) so the leaked leaf file — not its parent directory —
 * appears in the diagnostic, keeping the error precise and stable for assertion by callers.
 */
export async function verifyNoForbiddenStandaloneEntries(bundleDir) {
  const entries = await readdir(bundleDir, { recursive: true });
  let deepest = null;
  for (const entry of entries) {
    const rel = String(entry).replaceAll("\\", "/");
    const lowered = rel.toLowerCase();
    if (!FORBIDDEN_STANDALONE_SUBPATHS.some((sub) => lowered.includes(sub))) continue;
    if (deepest === null || rel.length > deepest.length) deepest = rel;
  }
  if (deepest !== null) {
    throw new VerifyOfflineBundleError(
      "FORBIDDEN_BUNDLE_ENTRY",
      `bundle contains forbidden standalone runtime entry: ${path.join(bundleDir, deepest)}`,
      { entry: deepest, phase: "forbidden-entries" },
    );
  }
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function findBundleDir(tempRoot) {
  const entries = await readdir(tempRoot, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith("tiny-yeah-offline-v"));
  if (dirs.length !== 1) throw new Error(`expected one unpacked tiny-yeah-offline directory, found ${dirs.length}`);
  return path.join(tempRoot, dirs[0].name);
}

export async function prepareConsumer(bundleDir, tempRoot, manifest) {
  const consumerRoot = path.join(tempRoot, "consumer");
  const consumerNodeModules = path.join(consumerRoot, "node_modules");
  await mkdir(consumerRoot, { recursive: true });
  await mkdir(consumerNodeModules, { recursive: true });
  const tarballName = path.basename(manifest.packageTarball);
  const packageJson = {
    name: "tiny-yeah-offline-consumer",
    private: true,
    type: "module",
    dependencies: { "tiny-yeah": `file:./${path.basename(manifest.packageTarball)}` },
  };
  await cp(path.join(bundleDir, manifest.packageTarball), path.join(consumerRoot, tarballName));
  await writeFile(path.join(consumerRoot, "package.json"), stableStringify(packageJson));
  return { consumerRoot, tarballName };
}

export async function runSmoke(consumerRoot) {
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

export async function installConsumerForSmoke(consumerRoot, manifest, tempRoot) {
  if (manifest.airGapComplete) {
    const emptyCache = path.join(tempRoot, "empty-npm-cache");
    await mkdir(emptyCache, { recursive: true });
    try {
      await runNpm(
        [
          "install",
          "--offline",
          "--cache",
          emptyCache,
          "--legacy-peer-deps",
          "--ignore-scripts",
          "--no-audit",
          "--fund=false",
        ],
        {
          cwd: consumerRoot,
          env: {
            ...process.env,
            npm_config_registry: "http://127.0.0.1:9/",
            npm_config_legacy_peer_deps: "true",
            npm_config_audit: "false",
            npm_config_fund: "false",
          },
          maxBuffer,
        },
      );
      return { ok: true, mode: "offline", offlineInstallOk: true };
    } catch (error) {
      return {
        ok: false,
        mode: "offline",
        offlineInstallOk: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const cacheDir = path.join(tempRoot, "online-npm-cache");
  await mkdir(cacheDir, { recursive: true });
  try {
    await runNpm(
      ["install", "--cache", cacheDir, "--legacy-peer-deps", "--ignore-scripts", "--no-audit", "--fund=false"],
      {
        cwd: consumerRoot,
        env: {
          ...process.env,
          npm_config_legacy_peer_deps: "true",
          npm_config_audit: "false",
          npm_config_fund: "false",
        },
        maxBuffer,
      },
    );
    return { ok: true, mode: "online", offlineInstallOk: null };
  } catch (error) {
    return {
      ok: false,
      mode: "online",
      offlineInstallOk: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function verifyInstallerEntries(bundleDir, manifest, tempRoot) {
  const requiredEntries = [
    "package.json",
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
  const bundlePackage = JSON.parse(await readFile(path.join(bundleDir, "package.json"), "utf8"));
  if (bundlePackage.type !== "module") {
    throw new Error("bundle package.json must set type: module so bin/tiny-yeah.js runs as ESM");
  }
  if (
    !manifest.installer ||
    typeof manifest.installer.bin !== "string" ||
    typeof manifest.installer.entrypoint !== "string" ||
    typeof manifest.installer.templatesDir !== "string"
  ) {
    throw new Error("manifest.installer block is missing or malformed (REQ-TY2-001)");
  }
  if (manifest.airGapComplete) {
    const standalonePackageDir = manifest.installer.standalonePackageDir;
    if (typeof standalonePackageDir !== "string") {
      throw new Error("manifest.installer.standalonePackageDir is required for air-gap-complete bundles");
    }
    await access(path.join(bundleDir, standalonePackageDir, "package.json"));
    await access(path.join(bundleDir, standalonePackageDir, "dist", "index.js"));
  }

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

  const bareDir = path.join(tempRoot, "bare-bin-smoke");
  await mkdir(path.join(bareDir, "bin"), { recursive: true });
  await cp(path.join(bundleDir, "bin", "tiny-yeah.js"), path.join(bareDir, "bin", "tiny-yeah.js"));
  await writeFile(path.join(bareDir, "package.json"), stableStringify({ private: true, type: "module" }));
  await writeFile(path.join(bareDir, "manifest.json"), stableStringify({ version: manifest.version }));
  const versionResult = await execFileAsync("node", ["bin/tiny-yeah.js", "--version"], {
    cwd: bareDir,
    maxBuffer,
  });
  const printedVersion = versionResult.stdout.trim();
  if (printedVersion !== manifest.version) {
    throw new Error(
      `bin hermeticity smoke failed: --version printed '${printedVersion}' but manifest version is '${manifest.version}'`,
    );
  }
  return {
    entriesPresent: requiredEntries.length,
    binVersion: printedVersion,
    standalonePackageDir: manifest.installer.standalonePackageDir ?? null,
  };
}

export async function runStandaloneInstallSmoke(bundleDir, manifest, tempRoot) {
  const standalonePackageDir = manifest.installer?.standalonePackageDir;
  if (typeof standalonePackageDir !== "string") {
    return { standaloneInstall: { available: false }, standaloneDoctor: null };
  }
  const targetRoot = path.join(tempRoot, "standalone-install-target");
  await mkdir(targetRoot, { recursive: true });
  const installResult = await execFileAsync(
    process.execPath,
    [
      path.join(bundleDir, "bin", "tiny-yeah.js"),
      "install",
      "--project",
      targetRoot,
      "--bundle",
      bundleDir,
      "--yes",
      "--json",
    ],
    {
      cwd: targetRoot,
      env: { ...process.env, PATH: "", Path: "" },
      maxBuffer,
    },
  );
  const parsed = JSON.parse(installResult.stdout.trim());
  const packageJson = await readJson(
    path.join(targetRoot, ".opencode", "node_modules", "tiny-yeah", "package.json"),
  );
  const doctorResult = await execFileAsync(
    process.execPath,
    [
      path.join(bundleDir, "bin", "tiny-yeah.js"),
      "doctor",
      "--project",
      targetRoot,
      "--bundle",
      bundleDir,
      "--mode",
      "full",
      "--json",
    ],
    {
      cwd: targetRoot,
      env: { ...process.env, PATH: "", Path: "" },
      maxBuffer,
    },
  );
  return {
    standaloneInstall: {
      available: true,
      kind: parsed.kind,
      version: parsed.version,
      packageName: packageJson.name,
    },
    standaloneDoctor: JSON.parse(doctorResult.stdout.trim()),
  };
}
