// UNIT: bin-install E2E (SPEC-TINY-YEAH-002 REQ-TY2-010 exit codes + REQ-TY2-013 smoke import).
//
// Drives the bin's `install` subcommand end-to-end against a synthetic bundle fixture. The bin
// dynamically imports the installer lifecycle from the repo's dist/ (built before tests run via
// `npm run build`). Verifies:
//   - `install --dry-run --project <tmpdir>` → exit 0, JSON or text output
//   - `install --project <tmpdir>` → exit 0, .opencode/ populated, stamp present
//   - re-run `install` → exit 0, noop (REQ-TY2-009 idempotent)

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const binPath = path.join(repoRoot, "bin", "tiny-yeah.js");

function getProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Reflect.get(value, key);
}

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

/**
 * Build a synthetic bundle. Mirrors the layout produced by scripts/release/build-offline-bundle.mjs
 * with minimal content. The bin's resolveBundleDir discovers it via the manifest.json check.
 */
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

describe("bin tiny-yeah install — E2E (REQ-TY2-010)", () => {
  let bundleDir: string;
  let projectDir: string;

  beforeAll(async () => {
    bundleDir = await mkdtemp(path.join(os.tmpdir(), "ty2-bininstall-bundle-"));
    projectDir = await mkdtemp(path.join(os.tmpdir(), "ty2-bininstall-proj-"));
    await buildBundle(bundleDir);
  });

  afterAll(async () => {
    await rm(bundleDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  });

  it("install --dry-run exits 0 with JSON output", async () => {
    const result = (await execFileAsync(
      "node",
      [binPath, "install", "--bundle", bundleDir, "--project", projectDir, "--dry-run", "--json"],
      {
        reject: false,
        env: {
          ...process.env,
          TINY_YEAH_SKIP_NPM_INSTALL: "1",
          TINY_YEAH_SKIP_SMOKE_IMPORT: "1",
        },
      },
    ).catch((error: unknown) => error)) as { stdout: string; stderr: string; code?: number };

    const code = typeof result.code === "number" ? result.code : 0;
    const stderr = result.stderr ?? "";
    const stdout = result.stdout ?? "";
    expect(code, `stderr: ${stderr}`).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.command).toBe("install");
    expect(parsed.kind).toBe("dry-run");
    expect(parsed.version).toBe("0.8.0");

    // ZERO writes (dry-run).
    await expect(
      readFile(path.join(projectDir, ".opencode", "package.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("install rejects malformed archive bundle paths before any project writes", async () => {
    const archivePath = path.join(bundleDir, "tiny-yeah-offline-v0.8.0.tar.gz");
    await writeFile(archivePath, "not-a-real-tarball\n");
    const archiveProject = await mkdtemp(path.join(os.tmpdir(), "ty2-bininstall-archive-proj-"));
    try {
      const result = await execFileAsync(
        "node",
        [
          binPath,
          "install",
          "--bundle",
          archivePath,
          "--project",
          archiveProject,
          "--dry-run",
          "--json",
        ],
        { reject: false },
      ).catch((error: unknown) => error);

      const code = getProperty(result, "code");
      const stdout = getProperty(result, "stdout");
      expect(code).toBe(2);
      expect(typeof stdout).toBe("string");
      const parsed = JSON.parse(typeof stdout === "string" ? stdout : "");
      expect(getProperty(parsed, "command")).toBe("install");
      expect(getProperty(parsed, "ok")).toBe(false);
      expect(getProperty(parsed, "code")).toBe("BUNDLE_ARCHIVE_UNPACK_FAILED");
      expect(getProperty(parsed, "recoveryHint")).toContain("tar");
      await expect(
        readFile(path.join(archiveProject, ".opencode", "package.json"), "utf8"),
      ).rejects.toThrow();
    } finally {
      await rm(archiveProject, { recursive: true, force: true });
    }
  });

  it("install --dry-run accepts a release tarball path as --bundle", async () => {
    // Given: a valid bundle directory archived the same way release:offline emits it.
    const archiveRoot = await mkdtemp(path.join(os.tmpdir(), "ty2-bininstall-archive-root-"));
    const archivePath = path.join(archiveRoot, "tiny-yeah-offline-v0.8.0.tar.gz");
    const archivedBundleDir = path.join(archiveRoot, "tiny-yeah-offline-v0.8.0");
    const archiveProjectDir = await mkdtemp(path.join(os.tmpdir(), "ty2-bininstall-archive-proj-"));
    try {
      await buildBundle(archivedBundleDir);
      await execFileAsync("tar", [
        "-czf",
        archivePath,
        "-C",
        archiveRoot,
        "tiny-yeah-offline-v0.8.0",
      ]);

      // When: the CLI receives the tarball directly.
      const result = await execFileAsync(
        "node",
        [
          binPath,
          "install",
          "--bundle",
          archivePath,
          "--project",
          archiveProjectDir,
          "--dry-run",
          "--json",
        ],
        {
          reject: false,
          env: {
            ...process.env,
            TINY_YEAH_SKIP_NPM_INSTALL: "1",
            TINY_YEAH_SKIP_SMOKE_IMPORT: "1",
          },
        },
      ).catch((error: unknown) => error);

      // Then: it extracts before lifecycle verification instead of treating <tar.gz> as a dir.
      if (!(result instanceof Object) || !("stdout" in result) || !("stderr" in result)) {
        expect.fail("execFileAsync returned an unexpected result shape");
      }
      const code = "code" in result && typeof result.code === "number" ? result.code : 0;
      const stderr = typeof result.stderr === "string" ? result.stderr : "";
      const stdout = typeof result.stdout === "string" ? result.stdout : "";
      expect(code, `stderr: ${stderr}`).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.command).toBe("install");
      expect(parsed.kind).toBe("dry-run");
      expect(parsed.version).toBe("0.8.0");
      expect(stderr).not.toContain("ENOTDIR");
    } finally {
      await rm(archiveRoot, { recursive: true, force: true });
      await rm(archiveProjectDir, { recursive: true, force: true });
    }
  });

  it("install (real) writes the .opencode/ + stamp and exits 0", async () => {
    // The bin E2E exercises the lifecycle pipeline against a synthetic bundle. The lifecycle's
    // npm-install + smoke-import paths are gated by env-var escape hatches so this test can run
    // hermetically (no real bundle with materialized node_modules). Those paths are exercised
    // separately by `release:offline` integration tests.
    const result = (await execFileAsync(
      "node",
      [binPath, "install", "--bundle", bundleDir, "--project", projectDir, "--json"],
      {
        reject: false,
        env: {
          ...process.env,
          TINY_YEAH_SKIP_NPM_INSTALL: "1",
          TINY_YEAH_SKIP_SMOKE_IMPORT: "1",
        },
      },
    ).catch((error: unknown) => error)) as { stdout: string; stderr: string; code?: number };

    const code = typeof result.code === "number" ? result.code : 0;
    const stderr = result.stderr ?? "";
    const stdout = result.stdout ?? "";
    expect(code, `stderr: ${stderr}`).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.kind).toBe("installed");

    // .opencode/ + stamp should be present.
    const stampRaw = await readFile(
      path.join(projectDir, ".opencode", ".tiny-yeah-install.json"),
      "utf8",
    );
    expect(JSON.parse(stampRaw).schemaVersion).toBe("tiny-yeah.install.v2");
  });

  it("re-run install is a noop (idempotent, exit 0)", async () => {
    const result = (await execFileAsync(
      "node",
      [binPath, "install", "--bundle", bundleDir, "--project", projectDir, "--json"],
      {
        reject: false,
        env: {
          ...process.env,
          TINY_YEAH_SKIP_NPM_INSTALL: "1",
          TINY_YEAH_SKIP_SMOKE_IMPORT: "1",
        },
      },
    ).catch((error: unknown) => error)) as { stdout: string; stderr: string; code?: number };

    const code = typeof result.code === "number" ? result.code : 0;
    const stderr = result.stderr ?? "";
    const stdout = result.stdout ?? "";
    expect(code, `stderr: ${stderr}`).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.kind).toBe("noop");
  });
});
