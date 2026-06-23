// UNIT: doctor (SPEC-TINY-YEAH-002 REQ-TY2-013 — categorized checks, smoke import only, timeout).
//
// Drives `doctor()` against real installs built via the install lifecycle + synthetic bundles. Also
// covers the binary timeout AC (F5): DOCTOR_TIMEOUT_MS produces a DOCTOR_TIMEOUT typed result
// without hanging, and the `--json` schema validates against the zod schema.
//
// Covered REQs:
//   - REQ-TY2-013 system: node-version pass; powershell warn tolerated on non-Windows; opencode
//     warn tolerated when absent.
//   - REQ-TY2-013 config: healthy install → config-parse/plugin-entry-present/jsonc-valid pass;
//     pre-install (no .opencode/) → plugin-entry warn.
//   - REQ-TY2-013 integration: smoke import pass on a healthy install; fail when node_modules is
//     broken. Smoke import targets `.opencode/node_modules/tiny-yeah` (NOT vendor).
//   - REQ-TY2-013 bundle-integrity: stamp-bundle-hash pass after install; hand-edit a managed
//     file → warn (mismatch) but not fail.
//   - REQ-TY2-013 timeout (F5): DOCTOR_TIMEOUT_MS=1 + a slow check → DOCTOR_TIMEOUT result,
//     overall degraded, no hang.
//   - `--json` schema validates against doctorReportSchema.
//   - mode:"full" runs deeper checks than standard.

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCTOR_TIMEOUT_MS,
  type DoctorReport,
  doctor,
  doctorReportSchema,
} from "../../../src/head/installer/doctor.js";
import { InstallerError } from "../../../src/head/installer/errors.js";
import { type InstallOptions, install } from "../../../src/head/installer/lifecycle.js";
import { readStamp } from "../../../src/head/installer/stamp.js";

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

/** Install-options helper: skip npm + smoke (those are exercised by the bin E2E test). */
function testInstallOptions(projectRoot: string, bundleDir: string): InstallOptions {
  return { bundleDir, projectRoot, skipNpmInstall: true, skipSmokeImport: true };
}

/**
 * Materialize a minimal `.opencode/node_modules/tiny-yeah` with the three exports pointing to real
 * importable .js files. The doctor's integration smoke-import check resolves these the same way the
 * install lifecycle does (reads package.json exports, dynamic-imports each `import` target).
 */
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

/** Recursively snapshot {path: mtimeMs} under a directory, for read-only verification. */
async function snapshotMtimes(root: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry);
      const info = await stat(abs);
      if (info.isDirectory()) {
        out.set(abs, info.mtimeMs);
        await walk(abs);
      } else {
        out.set(abs, info.mtimeMs);
      }
    }
  }
  await walk(root);
  return out;
}

function checkById(report: DoctorReport, id: string) {
  const found = report.checks.find((c) => c.id === id);
  if (found === undefined) throw new Error(`check '${id}' missing from report`);
  return found;
}

describe("doctor — system category (REQ-TY2-013)", () => {
  it("node-version passes on the running Node (>=22.5.0)", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-doc-sys-"));
    try {
      const report = await doctor({ projectRoot: tmp });
      const nodeVersion = checkById(report, "node-version");
      expect(nodeVersion.status).toBe("pass");
      expect(nodeVersion.detail).toContain(process.versions.node.split(".")[0]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("powershell-version is at most warn on non-Windows (tolerated, not fail)", async () => {
    if (process.platform === "win32") return; // Windows gates hard; this test is for non-Windows.
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-doc-pwsh-"));
    try {
      const report = await doctor({ projectRoot: tmp });
      const pwsh = checkById(report, "powershell-version");
      // Either pwsh is on PATH (pass) or it is not (warn). NEVER fail on non-Windows dev machines.
      expect(["pass", "warn"]).toContain(pwsh.status);
      if (pwsh.status === "warn") {
        expect(pwsh.detail).toContain("pwsh");
      }
      expect(report.summary.overall).not.toBe("broken");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("opencode-version is at most warn when `opencode` is absent (tolerated)", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-doc-oc-"));
    // Force PATH empty so opencode is definitely not found — isolates the "absent" path.
    const origPath = process.env.PATH;
    process.env.PATH = "/nonexistent";
    try {
      const report = await doctor({ projectRoot: tmp });
      const oc = checkById(report, "opencode-version");
      expect(["pass", "warn"]).toContain(oc.status);
      // Absent opencode MUST NOT be a fail (install can still proceed; runtime plugin load would
      // surface it later — REQ-TY2-013).
      expect(report.summary.overall).not.toBe("broken");
    } finally {
      process.env.PATH = origPath;
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("doctor — config category (REQ-TY2-013)", () => {
  it("healthy install: config-parse/plugin-entry-present/jsonc-valid all pass", async () => {
    const bundleTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-doc-cfg-ok-bundle-"));
    const projectTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-doc-cfg-ok-proj-"));
    try {
      const bundleDir = await buildSyntheticBundle(bundleTmp);
      await install(testInstallOptions(projectTmp, bundleDir));
      const report = await doctor({ projectRoot: projectTmp });
      expect(checkById(report, "opencode-config-parse").status).toBe("pass");
      expect(checkById(report, "plugin-entry-present").status).toBe("pass");
      expect(checkById(report, "jsonc-valid").status).toBe("pass");
    } finally {
      await rm(bundleTmp, { recursive: true, force: true });
      await rm(projectTmp, { recursive: true, force: true });
    }
  });

  it("pre-install (no .opencode/): plugin-entry-present is warn", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-doc-cfg-pre-"));
    try {
      const report = await doctor({ projectRoot: tmp });
      expect(checkById(report, "plugin-entry-present").status).toBe("warn");
      expect(checkById(report, "opencode-config-parse").status).toBe("warn");
      // Pre-install state is NOT broken.
      expect(report.summary.overall).not.toBe("broken");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("doctor — integration category (smoke import from .opencode/node_modules, REQ-TY2-013)", () => {
  it("smoke import passes on a healthy install with materialized node_modules", async () => {
    const bundleTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-doc-int-ok-bundle-"));
    const projectTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-doc-int-ok-proj-"));
    try {
      const bundleDir = await buildSyntheticBundle(bundleTmp);
      await install(testInstallOptions(projectTmp, bundleDir));
      await materializeNodeModulesPackage(projectTmp);
      const report = await doctor({ projectRoot: projectTmp });
      const smoke = checkById(report, "exports-smoke-import");
      expect(smoke.status).toBe("pass");
      // The detail references node_modules/tiny-yeah, NOT vendor.
      expect(smoke.detail).toContain("node_modules/tiny-yeah");
    } finally {
      await rm(bundleTmp, { recursive: true, force: true });
      await rm(projectTmp, { recursive: true, force: true });
    }
  });

  it("smoke import fails when node_modules exports target a missing file", async () => {
    const bundleTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-doc-int-bad-bundle-"));
    const projectTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-doc-int-bad-proj-"));
    try {
      const bundleDir = await buildSyntheticBundle(bundleTmp);
      await install(testInstallOptions(projectTmp, bundleDir));
      // Materialize a package whose exports point at a NON-EXISTENT file.
      const pkgRoot = path.join(projectTmp, ".opencode", "node_modules", "tiny-yeah");
      await mkdir(pkgRoot, { recursive: true });
      await writeFile(
        path.join(pkgRoot, "package.json"),
        `${JSON.stringify(
          {
            name: "tiny-yeah",
            type: "module",
            exports: {
              ".": { import: "./missing.js" },
              "./opencode": { import: "./missing.js" },
              "./tui": { import: "./missing.js" },
            },
          },
          null,
          2,
        )}\n`,
      );
      const report = await doctor({ projectRoot: projectTmp });
      const smoke = checkById(report, "exports-smoke-import");
      expect(smoke.status).toBe("fail");
      // A genuine fail → overall broken.
      expect(report.summary.overall).toBe("broken");
    } finally {
      await rm(bundleTmp, { recursive: true, force: true });
      await rm(projectTmp, { recursive: true, force: true });
    }
  });
});

describe("doctor — bundle-integrity category (REQ-TY2-013)", () => {
  it("stamp-bundle-hash passes on a fresh install", async () => {
    const bundleTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-doc-bun-ok-bundle-"));
    const projectTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-doc-bun-ok-proj-"));
    try {
      const bundleDir = await buildSyntheticBundle(bundleTmp);
      await install(testInstallOptions(projectTmp, bundleDir));
      const report = await doctor({ projectRoot: projectTmp });
      expect(checkById(report, "stamp-bundle-hash").status).toBe("pass");
      expect(checkById(report, "stamp-consistency").status).toBe("pass");
    } finally {
      await rm(bundleTmp, { recursive: true, force: true });
      await rm(projectTmp, { recursive: true, force: true });
    }
  });

  it("hand-editing a managed file → stamp-bundle-hash warns (mismatch) but does NOT fail", async () => {
    const bundleTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-doc-bun-edit-bundle-"));
    const projectTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-doc-bun-edit-proj-"));
    try {
      const bundleDir = await buildSyntheticBundle(bundleTmp);
      await install(testInstallOptions(projectTmp, bundleDir));
      const stamp = await readStamp(projectTmp);
      expect(stamp).not.toBeNull();
      const aManaged = stamp?.managedPaths[0];
      expect(aManaged).toBeDefined();
      if (aManaged === undefined) throw new Error("no managed path");
      // Hand-edit the managed file (user edits are allowed; doctor flags them as warns).
      await writeFile(path.join(projectTmp, aManaged), "// hand-edited\n");
      const report = await doctor({ projectRoot: projectTmp });
      const hashCheck = checkById(report, "stamp-bundle-hash");
      expect(hashCheck.status).toBe("warn");
      // Warn is NOT a fail → overall degraded at most.
      expect(report.summary.overall).not.toBe("broken");
    } finally {
      await rm(bundleTmp, { recursive: true, force: true });
      await rm(projectTmp, { recursive: true, force: true });
    }
  });
});

describe("doctor — timeout (REQ-TY2-013 F5 binary AC, no hang)", () => {
  it("DOCTOR_TIMEOUT_MS=1 + a slow check → DOCTOR_TIMEOUT result, overall degraded, no hang", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-doc-timeout-"));
    try {
      // Inject a slow check via extraChecks; with timeoutMs=1 the timer wins the race.
      const slowCheck = async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return {
          id: "slow-test-check",
          category: "integration" as const,
          status: "pass" as const,
          detail: "should not run to completion",
        };
      };
      const report = await doctor({
        projectRoot: tmp,
        timeoutMs: 1,
        extraChecks: [slowCheck],
      });
      // DOCTOR_TIMEOUT typed result present.
      const timeoutCheck = report.checks.find((c) => c.id === "DOCTOR_TIMEOUT");
      expect(timeoutCheck).toBeDefined();
      expect(timeoutCheck?.status).toBe("fail");
      expect(timeoutCheck?.detail).toContain("timeout");
      // Overall is degraded (NOT hang, NOT broken-by-default per the AC).
      expect(report.summary.overall).toBe("degraded");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("default timeout is 10000ms (configurable via option)", () => {
    expect(DEFAULT_DOCTOR_TIMEOUT_MS).toBe(10000);
  });
});

describe("doctor — --json schema (REQ-TY2-013)", () => {
  it("the report validates against doctorReportSchema", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-doc-schema-"));
    try {
      const report = await doctor({ projectRoot: tmp });
      const parsed = doctorReportSchema.safeParse(report);
      expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
      expect(report.schemaVersion).toBe("tiny-yeah.doctor.v1");
      expect(report.mode).toBe("standard");
      expect(typeof report.durationMs).toBe("number");
      expect(report.ranAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("doctor — mode full runs deeper checks (REQ-TY2-013)", () => {
  it("mode:full runs at least one extra check beyond standard", async () => {
    const bundleTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-doc-full-bundle-"));
    const projectTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-doc-full-proj-"));
    try {
      const bundleDir = await buildSyntheticBundle(bundleTmp);
      await install(testInstallOptions(projectTmp, bundleDir));
      await materializeNodeModulesPackage(projectTmp);
      const standard = await doctor({ projectRoot: projectTmp, mode: "standard" });
      const full = await doctor({
        projectRoot: projectTmp,
        mode: "full",
        bundleDir,
      });
      expect(full.checks.length).toBeGreaterThan(standard.checks.length);
      // The full-mode check resolves the bundle and recomputes SHA256SUMS.
      const fullOnly = full.checks.filter((c) => !standard.checks.some((s) => s.id === c.id));
      expect(fullOnly.length).toBeGreaterThanOrEqual(1);
      // Schema still validates for full mode.
      const parsed = doctorReportSchema.safeParse(full);
      expect(parsed.success).toBe(true);
    } finally {
      await rm(bundleTmp, { recursive: true, force: true });
      await rm(projectTmp, { recursive: true, force: true });
    }
  });
});

describe("doctor — READ-ONLY (no files created/modified, REQ-TY2-013)", () => {
  it("a doctor run does not create or modify any file under the project root", async () => {
    const bundleTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-doc-ro-bundle-"));
    const projectTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-doc-ro-proj-"));
    try {
      const bundleDir = await buildSyntheticBundle(bundleTmp);
      await install(testInstallOptions(projectTmp, bundleDir));
      await materializeNodeModulesPackage(projectTmp);
      const before = await snapshotMtimes(projectTmp);
      await doctor({ projectRoot: projectTmp, mode: "full", bundleDir });
      const after = await snapshotMtimes(projectTmp);
      // No new files created.
      for (const p of after.keys()) {
        expect(before.has(p), `unexpected new file: ${p}`).toBe(true);
      }
      // No existing files modified (mtime unchanged).
      for (const [p, mtime] of before.entries()) {
        expect(after.get(p), `file vanished: ${p}`).toBe(mtime);
      }
    } finally {
      await rm(bundleTmp, { recursive: true, force: true });
      await rm(projectTmp, { recursive: true, force: true });
    }
  });
});

describe("doctor — install-stamp schema mismatch surfaces as a warn (REQ-TY2-015 cooperation)", () => {
  it("a corrupt install stamp is reported via stamp-consistency (not an unhandled throw)", async () => {
    const projectTmp = await mkdtemp(path.join(os.tmpdir(), "ty2-doc-corrupt-"));
    try {
      const stampPath = path.join(projectTmp, ".opencode", ".tiny-yeah-install.json");
      await mkdir(path.dirname(stampPath), { recursive: true });
      await writeFile(stampPath, "{ not valid json");
      const report = await doctor({ projectRoot: projectTmp });
      const consistency = checkById(report, "stamp-consistency");
      // A corrupt stamp is a warn (the project is in a degraded state, not a hard failure).
      expect(consistency.status).toBe("warn");
      expect(report.summary.overall).not.toBe("broken");
    } finally {
      await rm(projectTmp, { recursive: true, force: true });
    }
  });
});

// InstallerError is imported to assert it is NOT thrown out of doctor on a corrupt stamp — doctor
// catches schema-mismatch and converts it to a warn result instead of propagating.
void InstallerError;
