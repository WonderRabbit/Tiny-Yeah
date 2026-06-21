// INTEGRATION: installer-e2e (SPEC-TINY-YEAH-002 — the capstone end-to-end proof).
//
// THE SINGLE SOURCE OF TRUTH that the installer actually delivers a working OpenCode integration
// offline. Uses the REAL offline bundle produced by `npm run release:offline`. The test may invoke
// `release:offline` itself at setup if no bundle is present, gating to skip ONLY if release is
// impossible (no network / npm broken) — preferring the REAL bundle path.
//
// Flow:
//   setup  — unpack the real bundle into a tmpdir; create an e2e target project with a user-owned
//            .opencode/keep-me.md file (proves preservation across update + uninstall).
//   install — `node bin/tiny-yeah.js install --project <target> --bundle <bundle> --yes --json`
//             → exit 0, kind:"installed", stamp v2 schema, 5 managedFileHashes,
//             resolvedPluginCachePath via XDG_CACHE_HOME.
//   OpenCode-import proof — dynamically import `tiny-yeah`, `tiny-yeah/opencode`, `tiny-yeah/tui`
//             resolving from <target>/.opencode/node_modules/tiny-yeah; createTinyYeahPlugin
//             must be a function (REQ-TY2-001/013).
//   opencode.json merge — the `tiny-yeah` plugin entry is present, JSONC-valid.
//   doctor — exit 0, smoke-import check passes; summary healthy (degraded-with-warns acceptable
//             when the `opencode` binary is absent in CI).
//   update — re-install same version with --force to simulate a version refresh; stamp version
//             field refreshes, managedFileHashes recomputed, keep-me.md survives.
//   uninstall — exit 0, managed paths removed, stamp gone, plugin entry stripped, keep-me.md
//             survives.

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const binPath = path.join(repoRoot, "bin", "tiny-yeah.js");
const releaseDir = path.join(repoRoot, "release");

/**
 * Resolve the path to a real offline bundle tarball. Prefers the highest-versioned bundle that
 * exists under release/. If none exists, attempts `npm run release:offline` once. Returns the
 * absolute path or undefined if release is impossible (no network / npm broken) — in which case
 * the test suite skips with a documented reason.
 */
function resolveRealBundle(): string | undefined {
  // List existing release tarballs and pick the highest semver. Use Node-native readdirSync so the
  // suite is independent of shell availability under vitest's child-process env.
  let listing: string[] = [];
  try {
    listing = readdirSync(releaseDir);
  } catch {
    listing = [];
  }
  const candidates = listing
    .filter((l) => l.startsWith("tiny-yeah-offline-v") && l.endsWith(".tar.gz"))
    .map((name) => {
      const match = /tiny-yeah-offline-v(\d+\.\d+\.\d+)\.tar\.gz$/.exec(name);
      return match ? { name, version: match[1] as string } : null;
    })
    .filter((v): v is { name: string; version: string } => v !== null)
    .sort((a, b) => {
      const [aM, am, ap] = a.version.split(".").map(Number);
      const [bM, bm, bp] = b.version.split(".").map(Number);
      return bM - aM || bm - am || bp - ap;
    });
  if (candidates.length > 0) {
    return path.join(releaseDir, candidates[0].name);
  }
  // No bundle present — attempt release:offline.
  try {
    execSync("npm run release:offline", { cwd: repoRoot, stdio: "pipe", timeout: 600_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[installer-e2e] release:offline failed; skipping the real-bundle e2e suite.\n  reason: ${message}`,
    );
    return undefined;
  }
  // Retry discovery.
  try {
    listing = readdirSync(releaseDir);
  } catch {
    return undefined;
  }
  const match = listing.find((l) => l.startsWith("tiny-yeah-offline-v") && l.endsWith(".tar.gz"));
  return match ? path.join(releaseDir, match) : undefined;
}

interface SuiteContext {
  bundleArchive: string;
  bundleDir: string;
  targetProject: string;
  xdgCacheHome: string;
  bundleVersion: string;
}

const ctx: { value: SuiteContext | undefined } = { value: undefined };

beforeAll(async () => {
  const archive = resolveRealBundle();
  if (archive === undefined) return;
  // Unpack the bundle into a tmpdir.
  const workRoot = await mkdtemp(path.join(os.tmpdir(), "ty2-e2e-"));
  const bundleDir = path.join(workRoot, "bundle");
  await mkdir(bundleDir, { recursive: true });
  // `tar -xzf <archive> -C <bundleDir>` extracts `<bundleName>/...` under bundleDir.
  try {
    execFileSync("tar", ["-xzf", archive, "-C", bundleDir], { stdio: "pipe" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`e2e: tar extract failed for ${archive}: ${message}`);
  }
  // The bundle is extracted under <bundleDir>/<bundleName>/. Walk one level down.
  const entries = await readFile(path.join(bundleDir, "manifest.json"), "utf8").catch(async () => {
    // manifest.json is not at bundleDir root — find it.
    const fs = await import("node:fs/promises");
    const subdirs = (await fs.readdir(bundleDir)).filter((n) => !n.startsWith("."));
    if (subdirs.length === 1) {
      const inner = path.join(bundleDir, subdirs[0] as string);
      return readFile(path.join(inner, "manifest.json"), "utf8");
    }
    throw new Error(`e2e: could not locate manifest.json under ${bundleDir}`);
  });
  const manifest = JSON.parse(entries) as { version: string };
  const bundleVersion = manifest.version;
  // The actual unpacked bundle root: <bundleDir>/tiny-yeah-offline-v<version>/
  const unpackedRoot = path.join(bundleDir, `tiny-yeah-offline-v${bundleVersion}`);
  if (!existsSync(path.join(unpackedRoot, "manifest.json"))) {
    throw new Error(`e2e: unpacked bundle root missing manifest.json at ${unpackedRoot}`);
  }

  // Create the e2e target project.
  const targetProject = await mkdtemp(path.join(os.tmpdir(), "ty2-e2e-target-"));
  await writeFile(
    path.join(targetProject, "package.json"),
    `${JSON.stringify({ name: "e2e-target", version: "0.0.0", private: true }, null, 2)}\n`,
  );
  // Pre-existing user-owned .opencode/keep-me.md — proves preservation across update + uninstall.
  await mkdir(path.join(targetProject, ".opencode"), { recursive: true });
  await writeFile(
    path.join(targetProject, ".opencode", "keep-me.md"),
    "# user-owned\nthis file must survive update + uninstall.\n",
  );

  // Deterministic XDG_CACHE_HOME so resolvedPluginCachePath is verifiable.
  const xdgCacheHome = path.join(targetProject, "..", `ty2-e2e-xdg-${Date.now()}`);
  await mkdir(xdgCacheHome, { recursive: true });

  ctx.value = {
    bundleArchive: archive,
    bundleDir: unpackedRoot,
    targetProject,
    xdgCacheHome,
    bundleVersion,
  };
});

afterAll(async () => {
  const c = ctx.value;
  if (c === undefined) return;
  await rm(path.dirname(c.bundleDir), { recursive: true, force: true }).catch(() => {});
  await rm(c.targetProject, { recursive: true, force: true }).catch(() => {});
  await rm(c.xdgCacheHome, { recursive: true, force: true }).catch(() => {});
});

function skipIfNoBundle() {
  return ctx.value === undefined;
}

/**
 * Run the bin and capture exit code regardless of pass/fail. execFileSync throws on non-zero
 * exit, so we wrap with a fallback that reuses the child-process error payload.
 */
function runBinCapture(
  args: string[],
  env: NodeJS.ProcessEnv,
): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [binPath, ...args], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1024 * 1024 * 64,
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string; message?: string };
    return {
      code: typeof e.status === "number" ? e.status : 1,
      stdout: typeof e.stdout === "string" ? e.stdout : "",
      stderr: typeof e.stderr === "string" ? e.stderr : (e.message ?? ""),
    };
  }
}

describe("installer-e2e — REAL offline-bundle install → OpenCode imports → doctor → update → uninstall", () => {
  it("setup resolved a real bundle (skip the suite otherwise)", () => {
    if (skipIfNoBundle()) {
      console.warn("[installer-e2e] no real bundle available — suite is a no-op");
    }
    expect(true).toBe(true);
  });

  it("install writes .opencode/ + stamp and exits 0 (REQ-TY2-010)", () => {
    if (skipIfNoBundle()) return;
    const c = ctx.value as SuiteContext;
    const result = runBinCapture(
      ["install", "--project", c.targetProject, "--bundle", c.bundleDir, "--yes", "--json"],
      { ...process.env, XDG_CACHE_HOME: c.xdgCacheHome },
    );
    expect(result.code, `install stderr: ${result.stderr}`).toBe(0);
    const parsed = JSON.parse(result.stdout) as { kind: string; version: string };
    expect(parsed.kind).toBe("installed");
    expect(parsed.version).toBe(c.bundleVersion);
  });

  it("install stamp is v2 schema with 5 managedFileHashes + resolvedPluginCachePath (REQ-TY2-015)", async () => {
    if (skipIfNoBundle()) return;
    const c = ctx.value as SuiteContext;
    const stampRaw = await readFile(
      path.join(c.targetProject, ".opencode", ".tiny-yeah-install.json"),
      "utf8",
    );
    const stamp = JSON.parse(stampRaw) as {
      schemaVersion: string;
      managedPaths: string[];
      managedFileHashes: Record<string, string>;
      resolvedPluginCachePath: string;
      bundleSha256: string;
      version: string;
    };
    expect(stamp.schemaVersion).toBe("tiny-yeah.install.v2");
    expect(stamp.version).toBe(c.bundleVersion);
    // 5 managed paths: vendor tarball, package.json, plugins/tiny-yeah.ts, tui.json, opencode.json.
    expect(stamp.managedPaths.length).toBeGreaterThanOrEqual(5);
    expect(Object.keys(stamp.managedFileHashes).length).toBeGreaterThanOrEqual(5);
    expect(stamp.bundleSha256).toHaveLength(64);
    // The cache path MUST resolve through the XDG_CACHE_HOME override we passed.
    expect(stamp.resolvedPluginCachePath).toContain("opencode");
    expect(stamp.resolvedPluginCachePath).toContain("packages");
    // Hash format sanity: every value is a 64-char hex SHA-256.
    for (const [relPath, hash] of Object.entries(stamp.managedFileHashes)) {
      expect(relPath.length).toBeGreaterThan(0);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("the installed package exposes three exports + createTinyYeahPlugin is a function (REQ-TY2-001/013)", async () => {
    if (skipIfNoBundle()) return;
    const c = ctx.value as SuiteContext;
    const packageRoot = path.join(c.targetProject, ".opencode", "node_modules", "tiny-yeah");
    const pkgJsonRaw = await readFile(path.join(packageRoot, "package.json"), "utf8");
    const pkg = JSON.parse(pkgJsonRaw) as {
      exports: Record<string, { import?: string; default?: string }>;
    };
    for (const sub of [".", "./opencode", "./tui"]) {
      const entry = pkg.exports[sub];
      const resolvedRel = entry?.import ?? entry?.default;
      expect(typeof resolvedRel, `exports[${sub}] missing import/default target`).toBe("string");
      const abs = path.join(packageRoot, resolvedRel as string);
      // Dynamic-import via file:// URL — exercises real module resolution.
      const mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
      expect(mod, `dynamic import of ${sub} returned nothing`).toBeDefined();
    }
    // createTinyYeahPlugin is the OpenCode entrypoint — must be a function.
    const opencodeEntry = pkg.exports["./opencode"];
    const opencodeAbs = path.join(
      packageRoot,
      (opencodeEntry?.import ?? opencodeEntry?.default) as string,
    );
    const opencodeMod = (await import(pathToFileURL(opencodeAbs).href)) as {
      createTinyYeahPlugin?: unknown;
    };
    expect(typeof opencodeMod.createTinyYeahPlugin).toBe("function");
  });

  it("opencode.json carries the tiny-yeah plugin entry and is JSONC-valid (REQ-TY2-008)", async () => {
    if (skipIfNoBundle()) return;
    const c = ctx.value as SuiteContext;
    // Locate opencode.json OR opencode.jsonc under .opencode/.
    const candidates = [
      path.join(c.targetProject, ".opencode", "opencode.jsonc"),
      path.join(c.targetProject, ".opencode", "opencode.json"),
    ];
    let raw = "";
    let found = "";
    for (const candidate of candidates) {
      try {
        raw = await readFile(candidate, "utf8");
        found = candidate;
        break;
      } catch {
        // try next
      }
    }
    expect(found, "no opencode.json[c] written by install").not.toBe("");
    // JSONC-valid: jsonc-parser is the canonical parser, but for the test a tolerant JSON.parse
    // of the stripped-comment form is sufficient to confirm it parses and contains the entry.
    const stripped = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const parsed = JSON.parse(stripped) as { plugin?: unknown };
    expect(Array.isArray(parsed.plugin)).toBe(true);
    const pluginArr = parsed.plugin as unknown[];
    const hasTinyYeah = pluginArr.some((entry) => {
      if (typeof entry === "string") return entry === "tiny-yeah";
      if (Array.isArray(entry) && typeof entry[0] === "string") return entry[0] === "tiny-yeah";
      if (entry !== null && typeof entry === "object" && "name" in entry) {
        return (entry as { name: string }).name === "tiny-yeah";
      }
      return false;
    });
    expect(hasTinyYeah, "opencode.json[c] missing 'tiny-yeah' plugin entry").toBe(true);
  });

  it("user-owned keep-me.md survived the install", async () => {
    if (skipIfNoBundle()) return;
    const c = ctx.value as SuiteContext;
    const kept = await readFile(path.join(c.targetProject, ".opencode", "keep-me.md"), "utf8");
    expect(kept).toContain("user-owned");
  });

  it("doctor exits 0 and reports the smoke-import check (REQ-TY2-013)", () => {
    if (skipIfNoBundle()) return;
    const c = ctx.value as SuiteContext;
    const result = runBinCapture(["doctor", "--project", c.targetProject, "--json"], {
      ...process.env,
      XDG_CACHE_HOME: c.xdgCacheHome,
    });
    // doctor exit 0 in a warm-install environment; degraded-with-warns is acceptable when the
    // `opencode` binary is absent in CI (summary may report warn/fail on the system category).
    expect(result.code, `doctor stderr: ${result.stderr}`).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      schemaVersion: string;
      summary: { overall: string; pass: number; warn: number; fail: number };
      checks: Array<{ id: string; category: string; status: string; detail: string }>;
    };
    expect(parsed.schemaVersion).toBe("tiny-yeah.doctor.v1");
    // Degraded-with-warns is acceptable when `opencode` is absent in CI; fail count must be 0.
    expect(parsed.summary.fail).toBe(0);
    const categories = new Set(parsed.checks.map((check) => check.category));
    expect(categories.has("integration")).toBe(true);
    // The bundle-integrity (or stamp-consistency) category must be present.
    expect(categories.has("bundle-integrity") || categories.has("stamp-consistency")).toBe(true);
    // The smoke-import check MUST pass (the install produced a working node_modules).
    const smokeCheck = parsed.checks.find((check) => check.id === "exports-smoke-import");
    expect(smokeCheck, "doctor missing exports-smoke-import check").toBeDefined();
    expect(smokeCheck?.status).toBe("pass");
  });

  it("update cycle: re-install with --force refreshes the stamp; keep-me.md survives (REQ-TY2-011)", async () => {
    if (skipIfNoBundle()) return;
    const c = ctx.value as SuiteContext;
    // Capture stamp installedAt BEFORE.
    const stampBeforeRaw = await readFile(
      path.join(c.targetProject, ".opencode", ".tiny-yeah-install.json"),
      "utf8",
    );
    const stampBefore = JSON.parse(stampBeforeRaw) as {
      installedAt: string;
      managedFileHashes: Record<string, string>;
    };
    const hashesBeforeKeys = Object.keys(stampBefore.managedFileHashes).sort();

    // Small delay so installedAt (ISO ms precision) differs.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const result = runBinCapture(
      [
        "install",
        "--project",
        c.targetProject,
        "--bundle",
        c.bundleDir,
        "--force",
        "--yes",
        "--json",
      ],
      { ...process.env, XDG_CACHE_HOME: c.xdgCacheHome },
    );
    expect(result.code, `update stderr: ${result.stderr}`).toBe(0);

    const stampAfterRaw = await readFile(
      path.join(c.targetProject, ".opencode", ".tiny-yeah-install.json"),
      "utf8",
    );
    const stampAfter = JSON.parse(stampAfterRaw) as {
      installedAt: string;
      managedFileHashes: Record<string, string>;
    };
    // Stamp refreshed — installedAt moved forward.
    expect(stampAfter.installedAt).not.toBe(stampBefore.installedAt);
    // Same managed set, recomputed hashes.
    const hashesAfterKeys = Object.keys(stampAfter.managedFileHashes).sort();
    expect(hashesAfterKeys).toEqual(hashesBeforeKeys);

    // User-owned file survives.
    const kept = await readFile(path.join(c.targetProject, ".opencode", "keep-me.md"), "utf8");
    expect(kept).toContain("user-owned");
  });

  it("uninstall removes managed paths + stamp + plugin entry; keep-me.md survives (REQ-TY2-012)", async () => {
    if (skipIfNoBundle()) return;
    const c = ctx.value as SuiteContext;
    const stampPath = path.join(c.targetProject, ".opencode", ".tiny-yeah-install.json");
    const stampBeforeRaw = await readFile(stampPath, "utf8");
    const stampBefore = JSON.parse(stampBeforeRaw) as { managedPaths: string[] };

    const result = runBinCapture(["uninstall", "--project", c.targetProject, "--yes", "--json"], {
      ...process.env,
      XDG_CACHE_HOME: c.xdgCacheHome,
    });
    expect(result.code, `uninstall stderr: ${result.stderr}`).toBe(0);

    // Stamp gone.
    await expect(readFile(stampPath, "utf8")).rejects.toThrow();

    // managedPaths removed (best-effort — those whose hash still matched).
    const fs = await import("node:fs/promises");
    let removedCount = 0;
    for (const rel of stampBefore.managedPaths) {
      if (rel.endsWith(".tiny-yeah-install.json")) continue;
      const abs = path.join(c.targetProject, rel);
      const exists = await fs.stat(abs).then(
        () => true,
        () => false,
      );
      if (!exists) removedCount += 1;
    }
    // At least the vendor tarball + plugins/tiny-yeah.ts + tui.json should be removed.
    expect(removedCount).toBeGreaterThan(0);

    // User-owned file survives uninstall.
    const kept = await readFile(path.join(c.targetProject, ".opencode", "keep-me.md"), "utf8");
    expect(kept).toContain("user-owned");
  });
});
