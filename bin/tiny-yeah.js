#!/usr/bin/env node
// Tiny-Yeah installer CLI entrypoint (SPEC-TINY-YEAH-002, strategy §4 bin module).
//
// HERMETIC CONSTRAINT (REQ-TY2-018, inventory risk 8): this file is the FIRST thing that
// runs after a bundle is unpacked, BEFORE `npm install`. Therefore it MUST be dependency-free
// — only `node:` built-ins (fs, path, os, crypto, child_process, url). It MUST NOT import
// commander/zod/jsonc-parser or any package from node_modules. CLI argument parsing is pure
// `process.argv` string handling. JSONC deep-merge is deferred to the lifecycle module
// (head/installer/opencode-config.ts, which runs after the lifecycle is dynamically imported)
// precisely to preserve this constraint.
//
// 2-PHASE BOOTSTRAP (strategy §4):
//   Phase 1 (HERMETIC — this file): the bin runs with ONLY node: built-ins. It resolves the
//     bundle directory and dynamically imports the installer lifecycle. The lifecycle runs
//     after `npm install --offline` has populated .opencode/node_modules/tiny-yeah — that
//     package ships bundleDependencies (zod, jsonc-parser, @opencode-ai/plugin) so the
//     lifecycle's runtime imports resolve from there.
//   Phase 2 (dynamic-imported lifecycle): head/installer/lifecycle.js does verify → plan →
//     backup + write → JSONC deep-merge → npm install → stamp → smoke import. uninstall is
//     Phase 1-only (vendored package may already be gone) — Phase 3 will implement it.
//
// The dynamic import() escape hatch is the ONLY way the bin reaches non-builtin code. The
// firewall test (tests/unit/installer-firewall.test.ts) verifies the dynamic import target is
// the lifecycle module, NEVER jsonc-parser directly.
//
// Exit codes (strategy §5): 0 success, 1 other, 2 argument error / not-implemented,
// 3 bundle verification failure, 4 already installed, 5 write contention.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BIN_DIR = path.dirname(fileURLToPath(import.meta.url));

const SUBCOMMANDS = ["install", "update", "doctor", "uninstall"];

const HELP_TEXT = `tiny-yeah — Tiny-Yeah offline-bundle installer

Usage:
  tiny-yeah <command> [options]

Commands:
  install                 Install the offline bundle into the target project's .opencode/
  update                  Update an existing install to a new bundle version
  doctor                  Diagnose the install state (system/config/integration/bundle)
  uninstall               Remove Tiny-Yeah from the target project (best-effort)

Global options:
  --project <path>        Target project root (default: current working directory)
  --bundle <path>         Offline bundle directory or archive (default: adjacent to this bin)
  --force                 Force overwrite / bypass version guards
  --dry-run               Print the planned changes without writing any file
  --json                  Emit machine-readable JSON output
  --yes                   Skip interactive confirmation (also implied in non-TTY)
  --mode <standard|full>  doctor: diagnostic depth (default: standard)
  --version               Print the tiny-yeah version and exit
  --help                  Print this help and exit

Exit codes:
  0  success
  1  other error
  2  argument error / command not implemented
  3  bundle verification failure (tampered / incomplete)
  4  already installed (without --force)
  5  write contention (Defender / lock)

Note: install/update/uninstall/doctor are all implemented (Phase 4).`;

/**
 * Resolve the tiny-yeah version hermetically. Look for, in order:
 *   1. manifest.json adjacent to the bin (the bundle-grounded source — present when this bin
 *      runs from an unpacked offline bundle; manifest.version is authoritative there).
 *   2. package.json adjacent to the bin (bundle root layout).
 *   3. package.json one level up from the bin (repo layout: bin/tiny-yeah.js + ../package.json).
 * Returns "unknown" if none is found so --version never crashes in a bare environment.
 *
 * REQ-TY2-018: reads via readFileSync (node:fs), NOT `import` — keeps the bin dep-free.
 */
function resolveVersion() {
  const candidates = [
    { file: path.join(BIN_DIR, "manifest.json"), field: "version" },
    { file: path.join(BIN_DIR, "package.json"), field: "version" },
    { file: path.join(BIN_DIR, "..", "package.json"), field: "version" },
    { file: path.join(process.cwd(), "manifest.json"), field: "version" },
    { file: path.join(process.cwd(), "package.json"), field: "version" },
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(candidate.file, "utf8"));
      const value = parsed?.[candidate.field];
      if (typeof value === "string" && value.length > 0) return value;
    } catch {
      // try next candidate
    }
  }
  return "unknown";
}

/**
 * Parse process.argv into { subcommand, flags, positional }. Pure string handling — no
 * commander/zod (REQ-TY2-018). Flags that take a value (--project, --bundle) consume the
 * next token; boolean flags do not.
 */
function parseArgs(argv) {
  const valueFlags = new Set(["--project", "--bundle", "--mode"]);
  const boolFlags = new Set([
    "--force",
    "--dry-run",
    "--json",
    "--yes",
    "--version",
    "--help",
    "--allow-downgrade",
    "--purge-backups",
  ]);
  const flags = {
    project: undefined,
    bundle: undefined,
    force: false,
    dryRun: false,
    json: false,
    yes: false,
    version: false,
    help: false,
    allowDowngrade: false,
    purgeBackups: false,
    mode: undefined,
  };
  const positional = [];
  let subcommand = undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    if (tok === "--") {
      for (i += 1; i < argv.length; i += 1) positional.push(argv[i]);
      break;
    }
    if (valueFlags.has(tok)) {
      const val = argv[i + 1];
      if (val === undefined || val.startsWith("--")) {
        stderror(`tiny-yeah: ${tok} requires a value\n`);
        process.exit(2);
      }
      i += 1;
      if (tok === "--project") flags.project = val;
      else if (tok === "--bundle") flags.bundle = val;
      else if (tok === "--mode") flags.mode = val;
      continue;
    }
    if (boolFlags.has(tok)) {
      if (tok === "--force") flags.force = true;
      else if (tok === "--dry-run") flags.dryRun = true;
      else if (tok === "--json") flags.json = true;
      else if (tok === "--yes") flags.yes = true;
      else if (tok === "--version") flags.version = true;
      else if (tok === "--help") flags.help = true;
      else if (tok === "--allow-downgrade") flags.allowDowngrade = true;
      else if (tok === "--purge-backups") flags.purgeBackups = true;
      continue;
    }
    if (tok.startsWith("--")) {
      stderror(`tiny-yeah: unknown flag ${tok}\n`);
      process.exit(2);
    }
    if (subcommand === undefined && SUBCOMMANDS.includes(tok)) {
      subcommand = tok;
      continue;
    }
    if (subcommand === undefined) {
      stderror(`tiny-yeah: unknown command '${tok}' (expected one of: ${SUBCOMMANDS.join(", ")})\n`);
      process.exit(2);
    }
    positional.push(tok);
  }
  return { subcommand, flags, positional };
}

function stdout(text) {
  process.stdout.write(text);
}

function stderror(text) {
  process.stderr.write(text);
}

/**
 * Resolve the bundle directory for the install subcommand. Order:
 *   1. --bundle flag value (explicit user override).
 *   2. manifest.json adjacent to the bin (bundle layout: bin/tiny-yeah.js sits in the unpacked
 *      bundle directory; the bundle root is the parent of BIN_DIR).
 *   3. CWD (developer convenience when running from a checked-out bundle dir).
 *
 * REQ-TY2-010: when --bundle is absent and no bundle is discoverable, fail with exit 2.
 */
function resolveBundleDir(explicit) {
  if (explicit) return path.resolve(explicit);
  // Bundle layout: <bundleRoot>/bin/tiny-yeah.js + <bundleRoot>/manifest.json.
  const bundleRoot = path.dirname(BIN_DIR);
  try {
    readFileSync(path.join(bundleRoot, "manifest.json"), "utf8");
    return bundleRoot;
  } catch {
    // Fall back to CWD — useful for `node bin/tiny-yeah.js install` from a bundle-like dir.
    try {
      readFileSync(path.join(process.cwd(), "manifest.json"), "utf8");
      return process.cwd();
    } catch {
      return undefined;
    }
  }
}

/**
 * Dynamically import the installer lifecycle. Resolution order:
 *   1. <bundleDir>/node_modules/tiny-yeah/dist/head/installer/lifecycle.js — when the bundle
 *      ships its own node_modules (preferred; the bundle's dist is grounded to the bundle's
 *      manifest and immune to npm-install quirks).
 *   2. <projectRoot>/.opencode/node_modules/tiny-yeah/dist/head/installer/lifecycle.js — after
 *      a prior `npm install --offline` has materialized the vendored tarball.
 *   3. <repoRoot>/dist/head/installer/lifecycle.js — developer layout (running the bin from a
 *      checked-out repo).
 *
 * The dynamic import() escape hatch is the ONLY non-hermetic reach from this bin. The firewall
 * test guarantees it targets the lifecycle module, never jsonc-parser directly (REQ-TY2-018).
 */
async function importLifecycle(bundleDir, projectRoot) {
  const candidates = [
    path.join(bundleDir, "node_modules", "tiny-yeah", "dist", "head", "installer", "lifecycle.js"),
    path.join(projectRoot, ".opencode", "node_modules", "tiny-yeah", "dist", "head", "installer", "lifecycle.js"),
    path.join(BIN_DIR, "..", "dist", "head", "installer", "lifecycle.js"),
  ];
  for (const candidate of candidates) {
    try {
      const url = `file://${candidate.replace(/\\/g, "/")}`;
      // Use pathToFileURL for cross-platform correctness.
      const { pathToFileURL } = await import("node:url");
      return await import(pathToFileURL(candidate).href);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Cannot find module") || msg.includes("ENOENT")) {
        continue; // try next candidate
      }
      throw error;
    }
  }
  return undefined;
}

/** Map an InstallerError code to a stable exit code (strategy §5). */
function exitCodeForError(code) {
  switch (code) {
    case "BUNDLE_MANIFEST_INVALID":
    case "BUNDLE_MANIFEST_NOT_FOUND":
    case "BUNDLE_AIR_GAP_INCOMPLETE":
    case "BUNDLE_HASH_MISMATCH":
    case "BUNDLE_FILE_MISSING":
    case "BUNDLE_INSTALLER_BLOCK_MISSING":
    case "BUNDLE_SHA256SUMS_INVALID":
      return 3; // bundle verification failure
    case "EXISTING_DEP_CONFLICT":
    case "INSTALL_STAMP_SCHEMA_MISMATCH":
    case "INSTALL_STAMP_MISSING":
      return 4; // already installed / state conflict
    case "DOWNGRADE_REJECTED":
      return 2; // argument / version-guard error (guidance: pass --allow-downgrade)
    case "INSTALL_LOCKED":
    case "WRITE_FAILED":
    case "CREATE_ONLY_TARGET_EXISTS":
    case "NPM_OFFLINE_INSTALL_FAILED":
    case "CACHE_INVALIDATION_PARTIAL":
      return 5; // write contention / lock
    default:
      return 1; // other
  }
}

/** Run the install subcommand. Returns the exit code; never throws. */
async function runInstall(parsed) {
  const projectRoot = parsed.flags.project ? path.resolve(parsed.flags.project) : process.cwd();
  const bundleDir = resolveBundleDir(parsed.flags.bundle);
  if (bundleDir === undefined) {
    stderror(
      "tiny-yeah install: could not locate the offline bundle. Pass --bundle <path> or run from the unpacked bundle directory.\n",
    );
    return 2;
  }

  const lifecycle = await importLifecycle(bundleDir, projectRoot);
  if (lifecycle === undefined || typeof lifecycle.install !== "function") {
    stderror(
      `tiny-yeah install: installer lifecycle not found. Looked in the bundle (${bundleDir}), the project's .opencode/node_modules, and the repo dist/. Run 'npm install --offline' in .opencode/ first.\n`,
    );
    return 1;
  }

  try {
    const result = await lifecycle.install({
      bundleDir,
      projectRoot,
      force: parsed.flags.force,
      dryRun: parsed.flags.dryRun,
      json: parsed.flags.json,
      yes: parsed.flags.yes,
      // Test-only escape hatches: the bin E2E test sets these env vars to exercise the
      // lifecycle pipeline against a synthetic bundle that has no real node_modules. In
      // production these are always unset and the lifecycle runs the full install.
      skipNpmInstall: process.env.TINY_YEAH_SKIP_NPM_INSTALL === "1",
      skipSmokeImport: process.env.TINY_YEAH_SKIP_SMOKE_IMPORT === "1",
    });
    if (parsed.flags.json) {
      stdout(`${JSON.stringify({ command: "install", ...result }, null, 2)}\n`);
    } else {
      const summary = formatInstallHuman(result, parsed.flags.dryRun === true);
      stdout(`${summary}\n`);
    }
    return 0;
  } catch (error) {
    const isInstallerError =
      error instanceof Error && "code" in error && typeof error.code === "string";
    const code = isInstallerError ? error.code : undefined;
    const message = error instanceof Error ? error.message : String(error);
    const hint = error instanceof Error && "recoveryHint" in error ? error.recoveryHint : undefined;
    if (parsed.flags.json) {
      stdout(
        `${JSON.stringify({ command: "install", ok: false, code, error: message, recoveryHint: hint }, null, 2)}\n`,
      );
    } else {
      stderror(`tiny-yeah install failed: ${message}\n`);
      if (hint) stderror(`hint: ${hint}\n`);
    }
    return exitCodeForError(code);
  }
}

function formatInstallHuman(result, dryRun) {
  if (result.kind === "dry-run") {
    return `tiny-yeah install --dry-run (version ${result.version}): plan computed, no files written.`;
  }
  if (result.kind === "noop") {
    return `tiny-yeah install: already at version ${result.version} (no-op).`;
  }
  const paths = result.managedPaths.map((p) => `  - ${p}`).join("\n");
  return `tiny-yeah install: ${result.version} installed.\nManaged paths:\n${paths}`;
}

/** Run the update subcommand. Returns the exit code; never throws. */
async function runUpdate(parsed) {
  const projectRoot = parsed.flags.project ? path.resolve(parsed.flags.project) : process.cwd();
  const bundleDir = resolveBundleDir(parsed.flags.bundle);
  if (bundleDir === undefined) {
    stderror(
      "tiny-yeah update: could not locate the offline bundle. Pass --bundle <path> or run from the unpacked bundle directory.\n",
    );
    return 2;
  }

  const lifecycle = await importLifecycle(bundleDir, projectRoot);
  if (lifecycle === undefined || typeof lifecycle.update !== "function") {
    stderror(
      `tiny-yeah update: installer lifecycle not found. Looked in the bundle (${bundleDir}), the project's .opencode/node_modules, and the repo dist/. Run 'npm install --offline' in .opencode/ first.\n`,
    );
    return 1;
  }

  try {
    const result = await lifecycle.update({
      bundleDir,
      projectRoot,
      allowDowngrade: parsed.flags.allowDowngrade,
      dryRun: parsed.flags.dryRun,
      json: parsed.flags.json,
      yes: parsed.flags.yes,
      skipNpmInstall: process.env.TINY_YEAH_SKIP_NPM_INSTALL === "1",
      skipSmokeImport: process.env.TINY_YEAH_SKIP_SMOKE_IMPORT === "1",
    });
    if (parsed.flags.json) {
      stdout(`${JSON.stringify({ command: "update", ...result }, null, 2)}\n`);
    } else {
      const summary = formatUpdateHuman(result, parsed.flags.dryRun === true);
      stdout(`${summary}\n`);
    }
    return 0;
  } catch (error) {
    const isInstallerError =
      error instanceof Error && "code" in error && typeof error.code === "string";
    const code = isInstallerError ? error.code : undefined;
    const message = error instanceof Error ? error.message : String(error);
    const hint = error instanceof Error && "recoveryHint" in error ? error.recoveryHint : undefined;
    if (parsed.flags.json) {
      stdout(
        `${JSON.stringify({ command: "update", ok: false, code, error: message, recoveryHint: hint }, null, 2)}\n`,
      );
    } else {
      stderror(`tiny-yeah update failed: ${message}\n`);
      if (hint) stderror(`hint: ${hint}\n`);
    }
    return exitCodeForError(code);
  }
}

function formatUpdateHuman(result, dryRun) {
  if (result.kind === "dry-run") {
    return `tiny-yeah update --dry-run (version ${result.version}): plan computed, no files written.`;
  }
  if (result.kind === "noop") {
    return `tiny-yeah update: already at version ${result.version} (no-op).`;
  }
  const cache = result.cacheInvalidated ? "cache invalidated" : "cache invalidation skipped (best-effort)";
  return `tiny-yeah update: ${result.from} → ${result.to} (${cache}).`;
}

/** Run the uninstall subcommand. Returns the exit code; never throws. */
async function runUninstall(parsed) {
  const projectRoot = parsed.flags.project ? path.resolve(parsed.flags.project) : process.cwd();
  // Uninstall is Phase-1-only (no bundle required): the vendored package may already be gone.
  // Resolve the lifecycle from the project's .opencode/node_modules or the repo dist/.
  const lifecycle = await importLifecycle(projectRoot, projectRoot);
  if (lifecycle === undefined || typeof lifecycle.uninstall !== "function") {
    stderror(
      `tiny-yeah uninstall: installer lifecycle not found. Run from the project root or pass --project <path>.\n`,
    );
    return 1;
  }

  try {
    const result = await lifecycle.uninstall({
      projectRoot,
      purgeBackups: parsed.flags.purgeBackups,
      dryRun: parsed.flags.dryRun,
      json: parsed.flags.json,
      yes: parsed.flags.yes,
    });
    if (parsed.flags.json) {
      stdout(`${JSON.stringify({ command: "uninstall", ...result }, null, 2)}\n`);
    } else {
      const summary = formatUninstallHuman(result, parsed.flags.dryRun === true);
      stdout(`${summary}\n`);
    }
    return 0;
  } catch (error) {
    const isInstallerError =
      error instanceof Error && "code" in error && typeof error.code === "string";
    const code = isInstallerError ? error.code : undefined;
    const message = error instanceof Error ? error.message : String(error);
    const hint = error instanceof Error && "recoveryHint" in error ? error.recoveryHint : undefined;
    if (parsed.flags.json) {
      stdout(
        `${JSON.stringify({ command: "uninstall", ok: false, code, error: message, recoveryHint: hint }, null, 2)}\n`,
      );
    } else {
      stderror(`tiny-yeah uninstall failed: ${message}\n`);
      if (hint) stderror(`hint: ${hint}\n`);
    }
    return exitCodeForError(code);
  }
}

function formatUninstallHuman(result, dryRun) {
  if (result.kind === "dry-run") {
    return `tiny-yeah uninstall --dry-run: plan computed, no files changed.`;
  }
  if (result.kind === "noop") {
    return `tiny-yeah uninstall: not installed (no-op).`;
  }
  const lines = [`tiny-yeah uninstall: ${result.version} removed.`];
  lines.push(`  removed: ${result.removed.length}`);
  if (result.skippedUserModified.length > 0) {
    lines.push(`  skipped (user-modified, preserved): ${result.skippedUserModified.length}`);
    for (const p of result.skippedUserModified) lines.push(`    - ${p}`);
  }
  if (result.alreadyAbsent.length > 0) {
    lines.push(`  already absent: ${result.alreadyAbsent.length}`);
  }
  return lines.join("\n");
}

/**
 * Dynamically import a named installer module (lifecycle OR doctor). Same resolution order as
 * {@link importLifecycle}, generalized so the doctor subcommand can reach dist/head/installer/doctor.js.
 */
async function importInstallerModule(bundleDir, projectRoot, moduleName) {
  const candidates = [];
  if (bundleDir !== undefined) {
    candidates.push(
      path.join(bundleDir, "node_modules", "tiny-yeah", "dist", "head", "installer", `${moduleName}.js`),
    );
  }
  candidates.push(
    path.join(
      projectRoot,
      ".opencode",
      "node_modules",
      "tiny-yeah",
      "dist",
      "head",
      "installer",
      `${moduleName}.js`,
    ),
    path.join(BIN_DIR, "..", "dist", "head", "installer", `${moduleName}.js`),
  );
  for (const candidate of candidates) {
    try {
      const { pathToFileURL } = await import("node:url");
      return await import(pathToFileURL(candidate).href);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // Module-not-found + filesystem-missing errors all surface here; fall through to the next
      // candidate. Any other error (syntax error in the resolved module, etc.) propagates.
      if (
        msg.includes("Cannot find module") ||
        msg.includes("ENOENT") ||
        msg.includes("Cannot resolve") ||
        msg.includes("ERR_MODULE_NOT_FOUND")
      ) {
        continue;
      }
      throw error;
    }
  }
  return undefined;
}

/** Run the doctor subcommand. Returns the exit code; never throws. */
async function runDoctor(parsed) {
  const projectRoot = parsed.flags.project ? path.resolve(parsed.flags.project) : process.cwd();
  // mode: --mode standard | full (default standard). Unknown values fall back to standard.
  const rawMode = parsed.flags.mode;
  const mode = rawMode === "full" ? "full" : "standard";
  // bundle discovery (full mode benefits from --bundle; standard does not need it).
  const bundleDir = resolveBundleDir(parsed.flags.bundle);

  const mod = await importInstallerModule(projectRoot, projectRoot, "doctor");
  if (mod === undefined || typeof mod.doctor !== "function") {
    stderror(
      `tiny-yeah doctor: installer module not found. Run from the project root or pass --project <path>.\n`,
    );
    return 1;
  }

  try {
    const report = await mod.doctor({
      projectRoot,
      mode,
      bundleDir,
    });
    if (parsed.flags.json) {
      stdout(`${JSON.stringify({ command: "doctor", ...report }, null, 2)}\n`);
    } else {
      stdout(`${formatDoctorHuman(report)}\n`);
    }
    // Exit 0 when healthy or degraded (no fail → degraded is acceptable); exit 1 when broken.
    return report.summary.overall === "broken" ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const hint = error instanceof Error && "recoveryHint" in error ? error.recoveryHint : undefined;
    if (parsed.flags.json) {
      stdout(
        `${JSON.stringify({ command: "doctor", ok: false, error: message, recoveryHint: hint }, null, 2)}\n`,
      );
    } else {
      stderror(`tiny-yeah doctor failed: ${message}\n`);
      if (hint) stderror(`hint: ${hint}\n`);
    }
    return 1;
  }
}

function formatDoctorHuman(report) {
  const marker = { pass: "PASS", warn: "WARN", fail: "FAIL" };
  const lines = [`tiny-yeah doctor: ${report.summary.overall} (mode ${report.mode})`];
  // Group checks by category for readability.
  const byCategory = new Map();
  for (const c of report.checks) {
    if (!byCategory.has(c.category)) byCategory.set(c.category, []);
    byCategory.get(c.category).push(c);
  }
  const categoryOrder = ["system", "config", "integration", "bundle-integrity"];
  for (const cat of categoryOrder) {
    const checks = byCategory.get(cat);
    if (checks === undefined) continue;
    lines.push(`[${cat}]`);
    for (const c of checks) {
      lines.push(`  ${marker[c.status] ?? c.status} ${c.id}: ${c.detail}`);
    }
  }
  lines.push(
    `summary: pass=${report.summary.pass} warn=${report.summary.warn} fail=${report.summary.fail}`,
  );
  return lines.join("\n");
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));

  // Global --version takes precedence over everything (even with no subcommand).
  if (parsed.flags.version) {
    stdout(`${resolveVersion()}\n`);
    process.exit(0);
  }
  // Global --help.
  if (parsed.flags.help) {
    stdout(`${HELP_TEXT}\n`);
    process.exit(0);
  }

  if (parsed.subcommand === undefined) {
    stderror("tiny-yeah: no command given. Run 'tiny-yeah --help' for usage.\n");
    process.exit(2);
  }

  if (parsed.subcommand === "install") {
    const code = await runInstall(parsed);
    process.exit(code);
  }

  if (parsed.subcommand === "update") {
    const code = await runUpdate(parsed);
    process.exit(code);
  }

  if (parsed.subcommand === "uninstall") {
    const code = await runUninstall(parsed);
    process.exit(code);
  }

  if (parsed.subcommand === "doctor") {
    const code = await runDoctor(parsed);
    process.exit(code);
  }

  stderror(`tiny-yeah ${parsed.subcommand}: unknown command\n`);
  process.exit(2);
}

main();
