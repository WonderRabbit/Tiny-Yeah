// UNIT: stamp (SPEC-TINY-YEAH-002 REQ-TY2-015, schemaVersion v2: tiny-yeah.install.v2).
//
// Install stamp lives at <project>/.opencode/.tiny-yeah-install.json. It is INSTALL state, NOT
// model runtime state — so it lives OUTSIDE .tiny-yeah/ (REQ-TY2-015) and uses
// INSTALL_STAMP_SCHEMA_MISMATCH (a distinct typed error, separate from MalformedJsonError and
// STATE_SCHEMA_VERSION_MISMATCH). Read flow:
//   - missing stamp file  → null (no install yet)
//   - malformed JSON      → fail-closed (InstallerError)
//   - schemaVersion missing or unknown → INSTALL_STAMP_SCHEMA_MISMATCH
//   - v1 stamp (legacy)   → reject with INSTALL_STAMP_SCHEMA_MISMATCH for now (migration is
//                            a Phase 3 concern; v2 is the only supported schema today)
// Write flow:
//   - atomic (temp + rename via atomicWriteJson)
//   - managedFileHashes covers every managedPath
//   - resolvedPluginCachePath from runtime resolve (XDG_CACHE_HOME ?? ~/.cache + opencode/packages)

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { InstallerError } from "../../../src/head/installer/errors.js";
import {
  computeManagedFileHashes,
  INSTALL_STAMP_SCHEMA_VERSION,
  type InstallStamp,
  readStamp,
  writeStamp,
} from "../../../src/head/installer/stamp.js";

async function sha256Of(content: string): Promise<string> {
  return createHash("sha256").update(content).digest("hex");
}

function validStamp(overrides: Partial<InstallStamp> = {}): InstallStamp {
  return {
    schemaVersion: INSTALL_STAMP_SCHEMA_VERSION,
    version: "0.8.0",
    installedAt: "2026-06-21T00:00:00.000Z",
    bundleSha256: "a".repeat(64),
    managedPaths: [".opencode/package.json", ".opencode/plugins/tiny-yeah.ts"],
    managedFileHashes: {
      ".opencode/package.json": "b".repeat(64),
      ".opencode/plugins/tiny-yeah.ts": "c".repeat(64),
    },
    resolvedPluginCachePath: path.join(os.homedir(), ".cache", "opencode", "packages"),
    opencodeVersionAtInstall: "1.4.0",
    ...overrides,
  };
}

describe("stamp — v2 round-trip", () => {
  it("writeStamp then readStamp returns the same stamp", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-stamp-rt-"));
    try {
      const stamp = validStamp();
      await writeStamp(tmp, stamp);
      const reread = await readStamp(tmp);
      expect(reread).not.toBeNull();
      expect(reread?.schemaVersion).toBe(INSTALL_STAMP_SCHEMA_VERSION);
      expect(reread?.version).toBe(stamp.version);
      expect(reread?.managedPaths).toEqual(stamp.managedPaths);
      expect(reread?.managedFileHashes).toEqual(stamp.managedFileHashes);
      expect(reread?.resolvedPluginCachePath).toBe(stamp.resolvedPluginCachePath);
      expect(reread?.opencodeVersionAtInstall).toBe(stamp.opencodeVersionAtInstall);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("writeStamp is atomic — creates .opencode/.tiny-yeah-install.json", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-stamp-path-"));
    try {
      await writeStamp(tmp, validStamp());
      const stampPath = path.join(tmp, ".opencode", ".tiny-yeah-install.json");
      const raw = await readFile(stampPath, "utf8");
      expect(JSON.parse(raw).schemaVersion).toBe(INSTALL_STAMP_SCHEMA_VERSION);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("stamp — read fail-closed semantics", () => {
  it("returns null when no stamp exists (fresh project)", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-stamp-missing-"));
    try {
      const reread = await readStamp(tmp);
      expect(reread).toBeNull();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("throws InstallerError when stamp is malformed JSON (fail-closed)", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-stamp-badjson-"));
    try {
      const ocDir = path.join(tmp, ".opencode");
      await mkdir(ocDir, { recursive: true });
      await writeFile(path.join(ocDir, ".tiny-yeah-install.json"), "{ not valid json");
      await expect(readStamp(tmp)).rejects.toBeInstanceOf(InstallerError);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("throws INSTALL_STAMP_SCHEMA_MISMATCH when schemaVersion is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-stamp-noschema-"));
    try {
      const ocDir = path.join(tmp, ".opencode");
      await mkdir(ocDir, { recursive: true });
      const noSchema = { version: "0.8.0", managedPaths: [] };
      await writeFile(
        path.join(ocDir, ".tiny-yeah-install.json"),
        `${JSON.stringify(noSchema, null, 2)}\n`,
      );
      await expect(readStamp(tmp)).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof InstallerError && err.code === "INSTALL_STAMP_SCHEMA_MISMATCH",
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("throws INSTALL_STAMP_SCHEMA_MISMATCH on unknown (future) schemaVersion", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-stamp-future-"));
    try {
      const ocDir = path.join(tmp, ".opencode");
      await mkdir(ocDir, { recursive: true });
      const future = { ...validStamp(), schemaVersion: "tiny-yeah.install.v99" };
      await writeFile(
        path.join(ocDir, ".tiny-yeah-install.json"),
        `${JSON.stringify(future, null, 2)}\n`,
      );
      await expect(readStamp(tmp)).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof InstallerError && err.code === "INSTALL_STAMP_SCHEMA_MISMATCH",
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects a v1 legacy stamp with INSTALL_STAMP_SCHEMA_MISMATCH (migration is Phase 3)", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-stamp-v1-"));
    try {
      const ocDir = path.join(tmp, ".opencode");
      await mkdir(ocDir, { recursive: true });
      const v1 = { schemaVersion: "tiny-yeah.install.v1", version: "0.6.0" };
      await writeFile(
        path.join(ocDir, ".tiny-yeah-install.json"),
        `${JSON.stringify(v1, null, 2)}\n`,
      );
      await expect(readStamp(tmp)).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof InstallerError && err.code === "INSTALL_STAMP_SCHEMA_MISMATCH",
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("stamp — computeManagedFileHashes (REQ-TY2-015, MAJOR #2)", () => {
  it("computes sha256 for each managed file keyed by relative path", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-stamp-hashes-"));
    try {
      const pkgPath = path.join(tmp, ".opencode", "package.json");
      const pluginPath = path.join(tmp, ".opencode", "plugins", "tiny-yeah.ts");
      await mkdir(path.dirname(pluginPath), { recursive: true });
      await writeFile(pkgPath, "PKG\n");
      await writeFile(pluginPath, "PLUGIN\n");

      const managedPaths = [".opencode/package.json", ".opencode/plugins/tiny-yeah.ts"];
      const hashes = await computeManagedFileHashes(tmp, managedPaths);
      expect(hashes[".opencode/package.json"]).toBe(await sha256Of("PKG\n"));
      expect(hashes[".opencode/plugins/tiny-yeah.ts"]).toBe(await sha256Of("PLUGIN\n"));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
