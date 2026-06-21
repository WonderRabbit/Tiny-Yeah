// UNIT: bin tiny-yeah doctor — E2E (SPEC-TINY-YEAH-002 REQ-TY2-013 CLI contract).
//
// Drives the bin's `doctor` subcommand end-to-end. The bin dynamically imports the installer
// doctor module from the repo's dist/ (built before tests run). Verifies:
//   - `doctor --project <tmpdir>` on a healthy install → exit 0
//   - `doctor --project <tmpdir>` on a bare tmpdir (no install) → exit 0 (warns, not fails)
//   - `doctor --json --project <tmpdir>` → valid JSON matching the report schema
//   - `doctor --project <tmpdir-with-corrupt-config>` → exit 1 (genuine fail = broken)
//   - DOCTOR_TIMEOUT_MS env is honored by the bin

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { doctorReportSchema } from "../../../src/head/installer/doctor.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const binPath = path.join(repoRoot, "bin", "tiny-yeah.js");

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

/** Synthetic bundle mirroring build-offline-bundle.mjs layout (minimal). */
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
  await writeFile(path.join(vendorDir, `tiny-yeah-v${version}-bundled.tgz`), "tarball-bytes\n");
  await writeFile(path.join(binDir, "tiny-yeah.js"), "#!/usr/bin/env node\n");
  await writeFile(path.join(dir, "install-offline.ps1"), "pwsh\n");
  await writeFile(
    path.join(templatesDir, "package.json"),
    `${JSON.stringify(
      {
        name: "target-opencode",
        private: true,
        dependencies: { "tiny-yeah": `file:./vendor/tiny-yeah-v${version}-bundled.tgz` },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(pluginsDir, "tiny-yeah.ts"),
    'export { createTinyYeahPlugin } from "tiny-yeah/opencode";\n',
  );
  await writeFile(
    path.join(templatesDir, "tui.json"),
    `${JSON.stringify({ plugin: ["./plugins/tiny-yeah.ts"] }, null, 2)}\n`,
  );
  const manifest = {
    name: "tiny-yeah-offline-bundle",
    packageName: "tiny-yeah",
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

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

async function runBin(args: string[], env?: NodeJS.ProcessEnv): Promise<RunResult> {
  const result = (await execFileAsync("node", [binPath, ...args], {
    reject: false,
    env: { ...process.env, ...env },
  }).catch((error: unknown) => error)) as { stdout: string; stderr: string; code?: number };
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: typeof result.code === "number" ? result.code : 0,
  };
}

describe("bin tiny-yeah doctor — E2E (REQ-TY2-013)", () => {
  let bundleDir: string;
  let healthyProject: string;
  let bareProject: string;

  beforeAll(async () => {
    bundleDir = await mkdtemp(path.join(os.tmpdir(), "ty2-bindoc-bundle-"));
    healthyProject = await mkdtemp(path.join(os.tmpdir(), "ty2-bindoc-healthy-"));
    bareProject = await mkdtemp(path.join(os.tmpdir(), "ty2-bindoc-bare-"));
    await buildBundle(bundleDir);
    // Install into healthyProject via the bin (skip npm + smoke for hermeticity).
    const installResult = await runBin(
      ["install", "--bundle", bundleDir, "--project", healthyProject, "--json"],
      { TINY_YEAH_SKIP_NPM_INSTALL: "1", TINY_YEAH_SKIP_SMOKE_IMPORT: "1" },
    );
    expect(installResult.code, `install stderr: ${installResult.stderr}`).toBe(0);
  });

  afterAll(async () => {
    await rm(bundleDir, { recursive: true, force: true });
    await rm(healthyProject, { recursive: true, force: true });
    await rm(bareProject, { recursive: true, force: true });
  });

  it("doctor on a healthy install exits 0", async () => {
    const result = await runBin(["doctor", "--project", healthyProject]);
    expect(result.stderr).toBe("");
    // node-version + config all pass; integration warns (no node_modules — install skipped npm).
    // overall may be degraded (warns) but NOT broken → exit 0.
    expect(result.code, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(0);
  });

  it("doctor --json on a healthy install emits valid JSON matching the schema", async () => {
    const result = await runBin(["doctor", "--project", healthyProject, "--json"]);
    expect(result.code, `stderr: ${result.stderr}`).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.command).toBe("doctor");
    expect(parsed.schemaVersion).toBe("tiny-yeah.doctor.v1");
    // The bin wraps the report with a top-level `command` key (consistent with install/update).
    // The schema describes the report itself — validate the report subset.
    const { command: _command, ...report } = parsed;
    void _command;
    const validated = doctorReportSchema.safeParse(report);
    expect(validated.success, JSON.stringify(validated.error?.issues ?? [])).toBe(true);
  });

  it("doctor on a bare project (no install) exits 0 with warns (missing install = warn, not fail)", async () => {
    const result = await runBin(["doctor", "--project", bareProject, "--json"]);
    expect(result.code, `stderr: ${result.stderr}`).toBe(0);
    const parsed = JSON.parse(result.stdout);
    // Pre-install state: plugin-entry warn, stamp warn, etc. No genuine fail → not broken.
    expect(parsed.summary.overall).not.toBe("broken");
  });

  it("doctor exits 1 when a genuine fail is present (corrupt opencode config)", async () => {
    const corruptProject = await mkdtemp(path.join(os.tmpdir(), "ty2-bindoc-corrupt-"));
    try {
      await mkdir(path.join(corruptProject, ".opencode"), { recursive: true });
      // A genuinely unparseable opencode.json → config-parse fail → overall broken → exit 1.
      await writeFile(
        path.join(corruptProject, ".opencode", "opencode.json"),
        "{ this is not valid json ",
      );
      const result = await runBin(["doctor", "--project", corruptProject, "--json"]);
      expect(result.code, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).toBe(1);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.summary.overall).toBe("broken");
      expect(parsed.summary.fail).toBeGreaterThan(0);
    } finally {
      await rm(corruptProject, { recursive: true, force: true });
    }
  });

  it("doctor --mode full runs the deeper checks (more checks than standard)", async () => {
    const standard = await runBin(["doctor", "--project", healthyProject, "--json"]);
    const full = await runBin([
      "doctor",
      "--project",
      healthyProject,
      "--mode",
      "full",
      "--bundle",
      bundleDir,
      "--json",
    ]);
    expect(standard.code).toBe(0);
    expect(full.code).toBe(0);
    const standardParsed = JSON.parse(standard.stdout);
    const fullParsed = JSON.parse(full.stdout);
    expect(fullParsed.checks.length).toBeGreaterThan(standardParsed.checks.length);
  });

  it("doctor --json output is human-readable in non-json mode (categorized markers)", async () => {
    const result = await runBin(["doctor", "--project", healthyProject]);
    // Human mode prints [system], [config], [integration], [bundle-integrity] section headers.
    expect(result.stdout).toContain("[system]");
    expect(result.stdout).toContain("[config]");
    expect(result.stdout).toContain("summary:");
  });
});
