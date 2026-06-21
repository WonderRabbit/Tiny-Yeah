// Tiny-Yeah install stamp (SPEC-TINY-YEAH-002 REQ-TY2-015, schemaVersion v2: tiny-yeah.install.v2).
//
// Install state file at <project>/.opencode/.tiny-yeah-install.json. This is INSTALL state, NOT
// model runtime state — so it lives OUTSIDE `.tiny-yeah/` (REQ-TY2-015) and uses
// INSTALL_STAMP_SCHEMA_MISMATCH (a distinct typed error, separate from MalformedJsonError and
// STATE_SCHEMA_VERSION_MISMATCH from core/state/file-store.ts). The .opencode/ location keeps
// the installer domain separate from the model-state domain (INV-1 firewall, REQ-TY2-003).
//
// v2 schema fields (MAJOR #2 schema bump from v1):
//   - schemaVersion: "tiny-yeah.install.v2"
//   - version: the tiny-yeah package version installed
//   - installedAt: ISO-8601 timestamp of the install
//   - bundleSha256: SHA-256 of the vendored tarball (integrity check input for doctor)
//   - managedPaths[]: project-root-relative paths uninstall may remove
//   - managedFileHashes: Record<relativePath, sha256> for hash-compare on uninstall (REQ-TY2-012)
//   - resolvedPluginCachePath: runtime-resolved OpenCode plugin cache path (REQ-TY2-014)
//   - opencodeVersionAtInstall: `opencode --version` at install time (best-effort)
//
// Phase 2 scope: read/write + schema-mismatch detection. v1→v2 migration is Phase 3 — for now
// v1 stamps are REJECTED with INSTALL_STAMP_SCHEMA_MISMATCH so callers can prompt the user.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { MalformedJsonError } from "../../core/state/file-store.js";
import { InstallerError } from "./errors.js";
import { atomicWriteJson } from "./writer.js";

/**
 * The install stamp schemaVersion. Bumped to v2 in SPEC-TINY-YEAH-002 v1.1.0 to add
 * `managedFileHashes` (REQ-TY2-012 uninstall hash-compare) and `resolvedPluginCachePath`
 * (REQ-TY2-014 cache invalidation).
 */
export const INSTALL_STAMP_SCHEMA_VERSION = "tiny-yeah.install.v2" as const;

/**
 * Stamp file path relative to project root. Lives under .opencode/ (NOT .tiny-yeah/) because
 * it is install state, not model runtime state (REQ-TY2-015).
 */
export const INSTALL_STAMP_REL_PATH = path.join(".opencode", ".tiny-yeah-install.json");

/** Zod schema for the v2 install stamp. Strict — extra fields are rejected. */
export const installStampSchema = z
  .object({
    schemaVersion: z.literal(INSTALL_STAMP_SCHEMA_VERSION),
    version: z.string().min(1),
    installedAt: z.string().min(1),
    bundleSha256: z.string().length(64),
    managedPaths: z.array(z.string().min(1)),
    managedFileHashes: z.record(z.string(), z.string().length(64)),
    resolvedPluginCachePath: z.string().min(1),
    opencodeVersionAtInstall: z.string().min(1),
  })
  .strict();

export type InstallStamp = z.infer<typeof installStampSchema>;

/** Stamp file absolute path for a project root. */
export function stampPathFor(projectRoot: string): string {
  return path.join(projectRoot, INSTALL_STAMP_REL_PATH);
}

/**
 * Read the install stamp for a project root.
 *
 * @returns the parsed stamp, or null when no stamp exists (fresh project).
 * @throws InstallerError(INSTALL_STAMP_SCHEMA_MISMATCH) when schemaVersion is missing or unknown.
 * @throws InstallerError when the stamp file is malformed JSON (fail-closed).
 */
export async function readStamp(projectRoot: string): Promise<InstallStamp | null> {
  const stampPath = stampPathFor(projectRoot);
  let raw: string;
  try {
    raw = await readFile(stampPath, "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // Malformed JSON — fail-closed with InstallerError (distinct from schema mismatch).
    throw new InstallerError({
      code: "INSTALL_STAMP_SCHEMA_MISMATCH",
      message: `Install stamp is malformed JSON: ${stampPath}`,
      recoveryHint:
        "Remove the corrupt stamp and re-run `tiny-yeah install --force` to rebuild it.",
      cause: error instanceof SyntaxError ? new MalformedJsonError(stampPath, error) : error,
    });
  }

  // schemaVersion presence + value check FIRST (distinct from zod field validation).
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("schemaVersion" in parsed) ||
    typeof (parsed as { schemaVersion?: unknown }).schemaVersion !== "string"
  ) {
    throw new InstallerError({
      code: "INSTALL_STAMP_SCHEMA_MISMATCH",
      message: `Install stamp is missing schemaVersion: ${stampPath}`,
      recoveryHint:
        "Re-run `tiny-yeah install --force` to rewrite the stamp in the current schema.",
    });
  }

  const actualVersion = (parsed as { schemaVersion: string }).schemaVersion;
  if (actualVersion !== INSTALL_STAMP_SCHEMA_VERSION) {
    // Includes v1 legacy stamps — migration is Phase 3.
    throw new InstallerError({
      code: "INSTALL_STAMP_SCHEMA_MISMATCH",
      message: `Install stamp schemaVersion mismatch at ${stampPath}: expected '${INSTALL_STAMP_SCHEMA_VERSION}', got '${actualVersion}'.`,
      recoveryHint:
        actualVersion === "tiny-yeah.install.v1"
          ? "Legacy v1 stamp detected. Remove it and re-run `tiny-yeah install --force` (v1→v2 migration is Phase 3)."
          : "Re-run `tiny-yeah install --force` to rewrite the stamp in the current schema.",
    });
  }

  const result = installStampSchema.safeParse(parsed);
  if (!result.success) {
    throw new InstallerError({
      code: "INSTALL_STAMP_SCHEMA_MISMATCH",
      message: `Install stamp failed schema validation at ${stampPath}: ${result.error.message}`,
      recoveryHint:
        "Re-run `tiny-yeah install --force` to rewrite the stamp in the current schema.",
      cause: result.error,
    });
  }
  return result.data;
}

/**
 * Write the install stamp atomically (temp + rename via writeJsonAtomic). Path-confined to
 * <project>/.opencode/.tiny-yeah-install.json.
 */
export async function writeStamp(projectRoot: string, stamp: InstallStamp): Promise<void> {
  // Defensive: ensure schemaVersion matches what we are about to write.
  if (stamp.schemaVersion !== INSTALL_STAMP_SCHEMA_VERSION) {
    throw new InstallerError({
      code: "INSTALL_STAMP_SCHEMA_MISMATCH",
      message: `Refusing to write stamp with unknown schemaVersion: '${stamp.schemaVersion}'.`,
      recoveryHint: "This is an internal error — report it to the tiny-yeah maintainers.",
    });
  }
  await atomicWriteJson(projectRoot, INSTALL_STAMP_REL_PATH, stamp);
}

/**
 * Compute the managedFileHashes map for an install: SHA-256 of every managed file's current
 * content on disk, keyed by project-root-relative path. Used at install time to populate the
 * stamp (REQ-TY2-015) and at uninstall time for hash-compare (REQ-TY2-012 MAJOR #2).
 *
 * Files that do not exist are SKIPPED (not in the map) — the caller's plan is responsible for
 * ensuring every managedPath exists when this is called at install-success time.
 */
export async function computeManagedFileHashes(
  projectRoot: string,
  managedPaths: readonly string[],
): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const relPath of managedPaths) {
    const abs = path.join(projectRoot, relPath);
    try {
      const content = await readFile(abs);
      const hash = createHash("sha256").update(content).digest("hex");
      hashes[relPath] = hash;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT"
      ) {
        // Skip missing files — caller's plan should guarantee existence at install time.
        continue;
      }
      throw error;
    }
  }
  return hashes;
}
