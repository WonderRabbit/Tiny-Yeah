import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const verifierPath = path.join(repoRoot, "scripts", "release", "verify-offline-bundle.mjs");
const testRoots: string[] = [];

type VerifierErrorReport = {
  readonly code?: string;
  readonly phase?: string;
  readonly tarExtractStarted?: boolean;
};

type VerifierSuccessReport = {
  readonly cleanup?: {
    readonly removed?: readonly string[];
  };
  readonly ok?: boolean;
  readonly preflight?: {
    readonly tmpSpaceProbe?: string;
  };
  readonly smoke?: {
    readonly hasPlugin?: boolean;
    readonly hasTui?: boolean;
    readonly version?: string;
  };
};

function isVerifierErrorReport(value: unknown): value is VerifierErrorReport {
  return value !== null && typeof value === "object";
}

function isVerifierSuccessReport(value: unknown): value is VerifierSuccessReport {
  return value !== null && typeof value === "object";
}

async function createTestRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "tiny-yeah-verify-test-"));
  testRoots.push(root);
  return root;
}

async function createReadableBundle(root: string): Promise<string> {
  const bundleRoot = path.join(root, "bundle-src", "tiny-yeah-offline-v0.0.0");
  await mkdir(bundleRoot, { recursive: true });
  await writeFile(
    path.join(bundleRoot, "manifest.json"),
    `${JSON.stringify({ airGapComplete: false, packageTarball: "tiny-yeah-0.0.0.tgz", version: "0.0.0" }, null, 2)}\n`,
  );
  const archive = path.join(root, "tiny-yeah-offline-v0.0.0.tar.gz");
  execFileSync(
    "tar",
    ["-czf", archive, "-C", path.join(root, "bundle-src"), "tiny-yeah-offline-v0.0.0"],
    {
      stdio: "pipe",
    },
  );
  return archive;
}

async function createVerifierFixtureBundle(root: string): Promise<string> {
  const bundleName = "tiny-yeah-offline-v0.0.0";
  const bundleRoot = path.join(root, "bundle-src", bundleName);
  const packageRoot = path.join(root, "package-src", "package");
  await mkdir(path.join(packageRoot, "dist", "head", "opencode"), { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "tiny-yeah",
        version: "0.0.0",
        type: "module",
        exports: {
          ".": { import: "./dist/index.js" },
          "./opencode": { import: "./dist/head/opencode/plugin.js" },
          "./tui": { import: "./dist/head/opencode/tui-plugin.js" },
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(packageRoot, "dist", "index.js"),
    [
      'export const VERSION = "0.0.0";',
      "export function createTinyYeahLibrarySurface() {",
      "  return { tiny_yeah_install_check: { run() { return { ok: true }; } } };",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(packageRoot, "dist", "head", "opencode", "plugin.js"),
    "export function createTinyYeahPlugin() { return { name: 'tiny-yeah' }; }\n",
  );
  await writeFile(
    path.join(packageRoot, "dist", "head", "opencode", "tui-plugin.js"),
    "export const TinyYeahOpenCodeTuiPlugin = { id: 'tiny-yeah', tui() { return null; } };\n",
  );
  const packageTarball = path.join(root, "tiny-yeah-0.0.0.tgz");
  execFileSync("tar", ["-czf", packageTarball, "-C", path.join(root, "package-src"), "package"], {
    stdio: "pipe",
  });

  await mkdir(path.join(bundleRoot, "vendor"), { recursive: true });
  await mkdir(path.join(bundleRoot, "bin"), { recursive: true });
  await mkdir(path.join(bundleRoot, "templates", "opencode", "plugins"), { recursive: true });
  await writeFile(
    path.join(bundleRoot, "manifest.json"),
    `${JSON.stringify(
      {
        airGapComplete: false,
        dependencyStrategy: "fixture",
        installer: {
          bin: "bin/tiny-yeah.js",
          entrypoint: "install-offline.ps1",
          templatesDir: "templates/opencode",
        },
        packageTarball: "vendor/tiny-yeah-0.0.0.tgz",
        version: "0.0.0",
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(bundleRoot, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  );
  await writeFile(
    path.join(bundleRoot, "bin", "tiny-yeah.js"),
    [
      "#!/usr/bin/env node",
      'import { readFileSync } from "node:fs";',
      'const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));',
      "if (process.argv.includes('--version')) console.log(manifest.version);",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(bundleRoot, "templates", "opencode", "package.json"),
    `${JSON.stringify({ dependencies: { "tiny-yeah": "file:./vendor/tiny-yeah-0.0.0.tgz" } }, null, 2)}\n`,
  );
  await writeFile(
    path.join(bundleRoot, "templates", "opencode", "plugins", "tiny-yeah.ts"),
    "export {};\n",
  );
  await writeFile(path.join(bundleRoot, "templates", "opencode", "tui.json"), "{}\n");
  await writeFile(path.join(bundleRoot, "install-offline.ps1"), "Write-Output tiny-yeah\n");
  await copyFile(packageTarball, path.join(bundleRoot, "vendor", "tiny-yeah-0.0.0.tgz"));

  const archive = path.join(root, `${bundleName}.tar.gz`);
  execFileSync("tar", ["-czf", archive, "-C", path.join(root, "bundle-src"), bundleName], {
    stdio: "pipe",
  });
  return archive;
}

afterEach(async () => {
  for (const root of testRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("verify-offline-bundle temp preflight", () => {
  it("verifies a tiny fixture bundle and removes extraction temp dirs when capacity fixture is sufficient", async () => {
    // Given: a tiny bundle that exercises extraction, installer checks, npm install, smoke import,
    // and cleanup without depending on the host having 1 GiB free in tmp.
    const root = await createTestRoot();
    const archive = await createVerifierFixtureBundle(root);
    const tmpRoot = path.join(root, "tiny-capacity-fixture");
    await mkdir(tmpRoot, { recursive: true });
    await writeFile(
      path.join(tmpRoot, ".tiny-yeah-capacity.json"),
      `${JSON.stringify({ availableBytes: 2 * 1024 * 1024 * 1024 }, null, 2)}\n`,
    );

    // When: offline verification is run through the real CLI surface.
    const result = spawnSync(
      process.execPath,
      [verifierPath, "--bundle", archive, "--tmp-root", tmpRoot],
      {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      },
    );

    // Then: the verifier succeeds and removes its extraction temp directory.
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    const parsed: unknown = JSON.parse(result.stdout);
    expect(isVerifierSuccessReport(parsed)).toBe(true);
    if (!isVerifierSuccessReport(parsed)) return;
    expect(parsed.ok).toBe(true);
    expect(parsed.preflight?.tmpSpaceProbe).toBe("fixture");
    expect(parsed.smoke?.version).toBe("0.0.0");
    expect(parsed.smoke?.hasPlugin).toBe(true);
    expect(parsed.smoke?.hasTui).toBe(true);
    expect(parsed.cleanup?.removed?.length).toBe(1);
    const removedRoot = parsed.cleanup?.removed?.[0];
    expect(typeof removedRoot).toBe("string");
    if (typeof removedRoot === "string") {
      expect(existsSync(removedRoot)).toBe(false);
    }
    const leftovers = readdirSync(tmpRoot).filter((entry) =>
      entry.startsWith("tiny-yeah-offline-verify-"),
    );
    expect(leftovers).toEqual([]);
  });

  it("returns typed temp-space failure before tar extraction when tmp root reports too little capacity", async () => {
    // Given: a readable archive and a temp-root fixture that reports deterministic low capacity.
    const root = await createTestRoot();
    const archive = await createReadableBundle(root);
    const tmpRoot = path.join(root, "tiny-capacity-fixture");
    await mkdir(tmpRoot, { recursive: true });
    await writeFile(
      path.join(tmpRoot, ".tiny-yeah-capacity.json"),
      `${JSON.stringify({ availableBytes: 1 }, null, 2)}\n`,
    );

    // When: offline verification is run through the real CLI surface.
    const result = spawnSync(
      process.execPath,
      [verifierPath, "--bundle", archive, "--tmp-root", tmpRoot],
      { cwd: repoRoot, encoding: "utf8", maxBuffer: 1024 * 1024 },
    );

    // Then: it fails as a typed preflight error, without leaving an extracted bundle tree.
    expect(result.status).toBe(1);
    const parsed: unknown = JSON.parse(result.stderr);
    expect(isVerifierErrorReport(parsed)).toBe(true);
    if (!isVerifierErrorReport(parsed)) return;
    expect(parsed.code).toBe("TEMP_SPACE_INSUFFICIENT");
    expect(parsed.phase).toBe("temp-preflight");
    expect(parsed.tarExtractStarted).toBe(false);
    const leftovers = readdirSync(tmpRoot).filter((entry) =>
      entry.startsWith("tiny-yeah-offline-verify-"),
    );
    expect(leftovers).toEqual([]);
    expect(existsSync(path.join(tmpRoot, "tiny-yeah-offline-v0.0.0"))).toBe(false);
  });

  it("reports invalid bundle before temp capacity when the archive is corrupt", async () => {
    // Given: a corrupt archive and a temp-root fixture that also reports low capacity.
    const root = await createTestRoot();
    const archive = path.join(root, "tiny-yeah-offline-v0.0.0.tar.gz");
    await writeFile(archive, "not a gzip tarball\n");
    const tmpRoot = path.join(root, "tiny-capacity-fixture");
    await mkdir(tmpRoot, { recursive: true });
    await writeFile(
      path.join(tmpRoot, ".tiny-yeah-capacity.json"),
      `${JSON.stringify({ availableBytes: 1 }, null, 2)}\n`,
    );

    // When: offline verification is run through the real CLI surface.
    const result = spawnSync(
      process.execPath,
      [verifierPath, "--bundle", archive, "--tmp-root", tmpRoot],
      { cwd: repoRoot, encoding: "utf8", maxBuffer: 1024 * 1024 },
    );

    // Then: the bundle integrity failure is preserved and no extraction temp dir is created.
    expect(result.status).toBe(1);
    const parsed: unknown = JSON.parse(result.stderr);
    expect(isVerifierErrorReport(parsed)).toBe(true);
    if (!isVerifierErrorReport(parsed)) return;
    expect(parsed.code).toBe("BUNDLE_ARCHIVE_INVALID");
    expect(parsed.phase).toBe("bundle-open");
    expect(parsed.tarExtractStarted).toBe(false);
    const leftovers = readdirSync(tmpRoot).filter((entry) =>
      entry.startsWith("tiny-yeah-offline-verify-"),
    );
    expect(leftovers).toEqual([]);
  });
});
