// UNIT: bin tiny-yeah update/uninstall — E2E (SPEC-TINY-YEAH-002 REQ-TY2-011/012 exit codes).
//
// Drives the bin's `update` and `uninstall` subcommands end-to-end against a synthetic bundle
// fixture. The bin dynamically imports the installer lifecycle from the repo's dist/ (built before
// tests). Verifies:
//   - `update --dry-run --project <tmpdir>` → exit 0
//   - `uninstall --project <tmpdir>` (post-install) → exit 0, stamp gone
//   - `uninstall --project <tmpdir>` (not installed) → exit 0 (noop)
//   - downgrade without --allow-downgrade → exit 2 (DOWNGRADE_REJECTED)

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

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

async function buildBundle(dir: string, version: string): Promise<string> {
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

const ENV = {
  ...process.env,
  TINY_YEAH_SKIP_NPM_INSTALL: "1",
  TINY_YEAH_SKIP_SMOKE_IMPORT: "1",
};

async function runBin(
  args: string[],
  envCacheHome?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const env = envCacheHome ? { ...ENV, XDG_CACHE_HOME: envCacheHome } : ENV;
  const result = (await execFileAsync("node", [binPath, ...args], {
    reject: false,
    env,
  }).catch((error: unknown) => error)) as { stdout: string; stderr: string; code?: number };
  return {
    code: typeof result.code === "number" ? result.code : 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("bin tiny-yeah update — E2E (REQ-TY2-011)", () => {
  let bundleV080: string;
  let bundleV090: string;
  let projectDir: string;
  let cacheDir: string;

  beforeAll(async () => {
    bundleV080 = await mkdtemp(path.join(os.tmpdir(), "ty2-binupd-b080-"));
    bundleV090 = await mkdtemp(path.join(os.tmpdir(), "ty2-binupd-b090-"));
    projectDir = await mkdtemp(path.join(os.tmpdir(), "ty2-binupd-proj-"));
    cacheDir = await mkdtemp(path.join(os.tmpdir(), "ty2-binupd-cache-"));
    await buildBundle(bundleV080, "0.8.0");
    await buildBundle(bundleV090, "0.9.0");
    // Install v0.8.0 first (point cache into tmpdir for determinism).
    await runBin(["install", "--bundle", bundleV080, "--project", projectDir, "--json"], cacheDir);
  });

  afterAll(async () => {
    await rm(bundleV080, { recursive: true, force: true });
    await rm(bundleV090, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("update --dry-run exits 0", async () => {
    const { code, stderr } = await runBin(
      ["update", "--bundle", bundleV090, "--project", projectDir, "--dry-run", "--json"],
      cacheDir,
    );
    expect(code, `stderr: ${stderr}`).toBe(0);
  });

  it("update to newer exits 0 and refreshes the stamp", async () => {
    const { code, stdout, stderr } = await runBin(
      ["update", "--bundle", bundleV090, "--project", projectDir, "--json"],
      cacheDir,
    );
    expect(code, `stderr: ${stderr}`).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.kind).toBe("updated");
    expect(parsed.to).toBe("0.9.0");
    const stampRaw = await readFile(
      path.join(projectDir, ".opencode", ".tiny-yeah-install.json"),
      "utf8",
    );
    expect(JSON.parse(stampRaw).version).toBe("0.9.0");
  });

  it("downgrade without --allow-downgrade exits 2 (DOWNGRADE_REJECTED)", async () => {
    // Project is now at 0.9.0; updating to the 0.8.0 bundle = downgrade.
    const { code, stderr } = await runBin(
      ["update", "--bundle", bundleV080, "--project", projectDir, "--json"],
      cacheDir,
    );
    expect(code, `stderr: ${stderr}`).toBe(2);
  });

  it("downgrade with --allow-downgrade exits 0", async () => {
    const { code, stdout, stderr } = await runBin(
      ["update", "--bundle", bundleV080, "--project", projectDir, "--allow-downgrade", "--json"],
      cacheDir,
    );
    expect(code, `stderr: ${stderr}`).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.kind).toBe("updated");
  });
});

describe("bin tiny-yeah uninstall — E2E (REQ-TY2-012)", () => {
  let bundleDir: string;
  let projectDir: string;
  let cacheDir: string;

  beforeAll(async () => {
    bundleDir = await mkdtemp(path.join(os.tmpdir(), "ty2-binuninst-bundle-"));
    projectDir = await mkdtemp(path.join(os.tmpdir(), "ty2-binuninst-proj-"));
    cacheDir = await mkdtemp(path.join(os.tmpdir(), "ty2-binuninst-cache-"));
    await buildBundle(bundleDir, "0.8.0");
    // Install so the project has a stamp to uninstall against.
    await runBin(["install", "--bundle", bundleDir, "--project", projectDir, "--json"], cacheDir);
  });

  afterAll(async () => {
    await rm(bundleDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("uninstall on an installed project exits 0 and removes the stamp", async () => {
    const { code, stdout, stderr } = await runBin(
      ["uninstall", "--project", projectDir, "--json"],
      cacheDir,
    );
    expect(code, `stderr: ${stderr}`).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.kind).toBe("uninstalled");
    await expect(
      readFile(path.join(projectDir, ".opencode", ".tiny-yeah-install.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("uninstall when not installed exits 0 (noop)", async () => {
    const fresh = await mkdtemp(path.join(os.tmpdir(), "ty2-binuninst-fresh-"));
    try {
      const { code, stdout, stderr } = await runBin(["uninstall", "--project", fresh, "--json"]);
      expect(code, `stderr: ${stderr}`).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.kind).toBe("noop");
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });
});
