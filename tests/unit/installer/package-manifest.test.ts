import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function getProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Reflect.get(value, key);
}

describe("package manifest publish surface", () => {
  it("packs only runtime surfaces for npm/OpenCode installs", async () => {
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), "ty2-pack-cache-"));
    try {
      await execFileAsync("npm", ["run", "build"], {
        cwd: repoRoot,
        env: {
          ...process.env,
          npm_config_cache: cacheDir,
        },
        maxBuffer: 1024 * 1024 * 16,
      });
      const result = await execFileAsync("npm", ["pack", "--dry-run", "--json"], {
        cwd: repoRoot,
        env: {
          ...process.env,
          npm_config_cache: cacheDir,
        },
        maxBuffer: 1024 * 1024 * 16,
      });

      const parsed = JSON.parse(result.stdout);
      expect(Array.isArray(parsed)).toBe(true);
      const pack = parsed[0];
      expect(getProperty(pack, "filename")).toBe("tiny-yeah-1.0.0.tgz");

      const fileEntries = getProperty(pack, "files");
      if (!Array.isArray(fileEntries)) {
        expect.fail("npm pack --dry-run did not return a files array");
      }
      const paths = fileEntries.map((entry) => getProperty(entry, "path"));

      expect(paths).toContain("bin/tiny-yeah.js");
      expect(paths).toContain("dist/index.js");
      expect(paths).toContain("dist/head/opencode/plugin.js");
      expect(paths).toContain("install-offline.ps1");
      expect(paths).toContain("templates/opencode/package.json");
      expect(paths).not.toContain(".omo/ulw-loop/tiny-yeah-win-opencode-20260623/goals.json");
      expect(paths).not.toContain("install-from-repo.ps1");
      expect(paths).not.toContain("release/tiny-yeah-offline-v1.0.0.tar.gz");
      expect(paths).not.toContain("src/index.ts");
      expect(paths).not.toContain("tests/unit/installer/bin-install.test.ts");
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("keeps the repo checkout installer as a thin wrapper around the hermetic bin", async () => {
    const script = await readFile(path.join(repoRoot, "install-from-repo.ps1"), "utf8");

    expect(script).toContain("tiny-yeah-offline-v$version.tar.gz");
    expect(script).toContain("release");
    expect(script).toContain("& node $BinPath install --bundle $BundlePath @ForwardedArgs");
    expect(script).not.toContain("Get-ChildItem");
    expect(script).not.toContain("npm install");
  });
});
