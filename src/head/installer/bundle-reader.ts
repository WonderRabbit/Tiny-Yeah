// Tiny-Yeah offline-bundle reader + integrity verifier (SPEC-TINY-YEAH-002 REQ-TY2-001/002,
// strategy §4 bundle-reader.ts).
//
// Opens an UNPACKED offline-bundle directory (tarball extraction is a Phase-2 concern; the MVP
// consumes a directory layout matching scripts/release/build-offline-bundle.mjs output). Performs
// multi-layer fail-closed integrity verification:
//   (a) manifest.json parses against the zod schema (BUNDLE_MANIFEST_INVALID / NOT_FOUND)
//   (b) manifest.airGapComplete === true (BUNDLE_AIR_GAP_INCOMPLETE)
//   (c) manifest.installer.{bin,entrypoint,templatesDir} present (BUNDLE_INSTALLER_BLOCK_MISSING)
//   (d) every distHashes entry's recomputed SHA-256 matches (BUNDLE_HASH_MISMATCH / FILE_MISSING)
//   (e) SHA256SUMS at bundle root, IF present, is parsed and verified (BUNDLE_SHA256SUMS_INVALID)
//
// REQ-TY2-002 fail-closed: on ANY mismatch the reader throws a typed InstallerError with a stable
// `code` + `recoveryHint` and performs ZERO writes. The reader is pure-read by construction — it
// only opens files for hashing; it never opens a write handle. This is the installer-domain
// analogue of SPEC-001 REQ-TY-006 (multi-layer hash verification).
//
// The reader does NOT import core/checkpoint/** — it is a pure verification step that precedes the
// writer domain. It uses node: built-ins + zod (the one runtime dep) + errors.ts only.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { InstallerError } from "./errors.js";

// Stable error-code constants re-exported so callers (and tests) branch on identity, not strings.
export const BUNDLE_MANIFEST_NOT_FOUND = "BUNDLE_MANIFEST_NOT_FOUND" as const;
export const BUNDLE_MANIFEST_INVALID = "BUNDLE_MANIFEST_INVALID" as const;
export const BUNDLE_AIR_GAP_INCOMPLETE = "BUNDLE_AIR_GAP_INCOMPLETE" as const;
export const BUNDLE_HASH_MISMATCH = "BUNDLE_HASH_MISMATCH" as const;
export const BUNDLE_FILE_MISSING = "BUNDLE_FILE_MISSING" as const;
export const BUNDLE_INSTALLER_BLOCK_MISSING = "BUNDLE_INSTALLER_BLOCK_MISSING" as const;
export const BUNDLE_SHA256SUMS_INVALID = "BUNDLE_SHA256SUMS_INVALID" as const;

export const installerBlockSchema = z.object({
  bin: z.string().min(1),
  entrypoint: z.string().min(1),
  templatesDir: z.string().min(1),
  standalonePackageDir: z.string().min(1).optional(),
});

/**
 * Manifest shape. Captures the load-bearing fields the reader validates; `dependencyStrategy`
 * and `dependencyClosure` are passthrough (z.record) since the reader does not act on them —
 * `airGapComplete` is the single boolean the reader gates on.
 *
 * `installer` is OPTIONAL in the schema so a missing installer block yields a distinct
 * BUNDLE_INSTALLER_BLOCK_MISSING code (more actionable than a generic schema-validation failure).
 * The reader performs the explicit presence check after parsing.
 */
export const bundleManifestSchema = z.object({
  name: z.string(),
  packageName: z.string(),
  version: z.string().min(1),
  airGapComplete: z.boolean(),
  packageTarball: z.string().min(1),
  distHashes: z.record(z.string(), z.string()),
  verifiedEntrypoints: z.array(z.string()),
  installer: installerBlockSchema.optional(),
});

export type BundleManifest = z.infer<typeof bundleManifestSchema>;

export interface VerifiedBundleEntry {
  readonly relPath: string;
  readonly absPath: string;
  readonly sha256: string;
}

export interface VerifiedBundle {
  readonly manifest: BundleManifest;
  readonly bundleDir: string;
  readonly entries: readonly VerifiedBundleEntry[];
}

function fail(
  code: InstallerError["code"],
  message: string,
  recoveryHint?: string,
  cause?: unknown,
): never {
  // Build options conditionally to respect exactOptionalPropertyTypes (don't forward `undefined`).
  // The intermediate is a mutable record so optional fields can be set only when defined.
  const options: {
    code: InstallerError["code"];
    message: string;
    recoveryHint?: string;
    cause?: unknown;
  } = { code, message };
  if (recoveryHint !== undefined) options.recoveryHint = recoveryHint;
  if (cause !== undefined) options.cause = cause;
  throw new InstallerError(options);
}

async function sha256File(absPath: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(absPath));
  return hash.digest("hex");
}

function hasFsErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as { code?: unknown }).code === code;
}

interface Sha256SumsLine {
  readonly hash: string;
  readonly relPath: string;
}

/**
 * Parse a SHA256SUMS file. Format mirrors GNU coreutils: `<hash>  <path>` per line (two spaces,
 * path may be relative). Asterisk-prefixed paths (`*path`, binary mode) are normalized. Blank
 * lines and `#` comments are skipped.
 */
function parseSha256Sums(raw: string): Sha256SumsLine[] {
  const lines: Sha256SumsLine[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(trimmed);
    if (!match || match[1] === undefined || match[2] === undefined) {
      fail(
        BUNDLE_SHA256SUMS_INVALID,
        `Malformed SHA256SUMS line: ${line}`,
        "Rebuild the offline bundle with `npm run release:offline`.",
      );
    }
    lines.push({ hash: (match[1] as string).toLowerCase(), relPath: (match[2] as string).trim() });
  }
  return lines;
}

/**
 * Read + integrity-verify an unpacked offline bundle directory. Performs ZERO writes.
 *
 * @param bundleDir absolute path to the unpacked bundle (the directory containing manifest.json).
 * @returns VerifiedBundle with the parsed manifest and resolved hash entries.
 * @throws InstallerError with a stable `code` on any integrity failure (fail-closed, REQ-TY2-002).
 */
export async function readBundle(bundleDir: string): Promise<VerifiedBundle> {
  const manifestPath = path.join(bundleDir, "manifest.json");
  let manifestRaw: string;
  try {
    manifestRaw = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (hasFsErrorCode(error, "ENOENT")) {
      fail(
        BUNDLE_MANIFEST_NOT_FOUND,
        `Bundle manifest not found: ${manifestPath}`,
        "Ensure the offline bundle was fully unpacked before running the installer.",
        error,
      );
    }
    throw error;
  }

  let manifestUnknown: unknown;
  try {
    manifestUnknown = JSON.parse(manifestRaw);
  } catch (error) {
    fail(
      BUNDLE_MANIFEST_INVALID,
      `Bundle manifest is not valid JSON: ${manifestPath}`,
      "Rebuild the offline bundle with `npm run release:offline`; do not hand-edit manifest.json.",
      error,
    );
  }

  const parsed = bundleManifestSchema.safeParse(manifestUnknown);
  if (!parsed.success) {
    fail(
      BUNDLE_MANIFEST_INVALID,
      `Bundle manifest failed schema validation: ${manifestPath}`,
      "The bundle manifest is missing required fields (version, airGapComplete, distHashes, installer). Rebuild the bundle.",
      parsed.error,
    );
  }
  const manifest = parsed.data;

  if (!manifest.airGapComplete) {
    fail(
      BUNDLE_AIR_GAP_INCOMPLETE,
      `Bundle is not air-gap complete (manifest.airGapComplete === false): ${manifestPath}`,
      "Production dependencies were not vendored at build time. Rebuild on a machine with npm cache/network access (`npm run release:offline`).",
    );
  }

  if (manifest.installer === undefined) {
    fail(
      BUNDLE_INSTALLER_BLOCK_MISSING,
      `Bundle manifest is missing the installer block: ${manifestPath}`,
      "Rebuild the offline bundle with `npm run release:offline`; the installer block (bin/entrypoint/templatesDir) is required.",
    );
  }

  // distHashes: recompute every entry, fail-closed on mismatch or missing file.
  const entries: VerifiedBundleEntry[] = [];
  for (const [relPath, expectedHash] of Object.entries(manifest.distHashes)) {
    const absPath = path.join(bundleDir, relPath);
    let actualHash: string;
    try {
      actualHash = await sha256File(absPath);
    } catch (error) {
      if (hasFsErrorCode(error, "ENOENT")) {
        fail(
          "BUNDLE_FILE_MISSING",
          `Bundle file referenced by distHashes is missing: ${relPath}`,
          "The bundle is incomplete. Re-unpack the tarball and retry.",
          error,
        );
      }
      throw error;
    }
    if (actualHash !== expectedHash.toLowerCase()) {
      fail(
        BUNDLE_HASH_MISMATCH,
        `Hash mismatch for ${relPath}: expected ${expectedHash}, got ${actualHash}. The bundle may be corrupted or tampered with.`,
        "Re-download or rebuild the offline bundle; do not proceed with a tampered bundle.",
      );
    }
    entries.push({ relPath, absPath, sha256: actualHash });
  }

  // SHA256SUMS at bundle root — optional additional layer. If present, verify each line.
  const sumsPath = path.join(bundleDir, "SHA256SUMS");
  let sumsRaw: string | undefined;
  try {
    sumsRaw = await readFile(sumsPath, "utf8");
  } catch (error) {
    if (!hasFsErrorCode(error, "ENOENT")) throw error;
    sumsRaw = undefined;
  }
  if (sumsRaw !== undefined) {
    const lines = parseSha256Sums(sumsRaw);
    for (const line of lines) {
      const absPath = path.join(bundleDir, line.relPath);
      let actualHash: string;
      try {
        actualHash = await sha256File(absPath);
      } catch (error) {
        if (hasFsErrorCode(error, "ENOENT")) {
          fail(
            "BUNDLE_FILE_MISSING",
            `SHA256SUMS references a missing file: ${line.relPath}`,
            "The bundle is incomplete. Re-unpack the tarball and retry.",
            error,
          );
        }
        throw error;
      }
      if (actualHash !== line.hash) {
        fail(
          BUNDLE_HASH_MISMATCH,
          `SHA256SUMS hash mismatch for ${line.relPath}: expected ${line.hash}, got ${actualHash}.`,
          "Re-download or rebuild the offline bundle; do not proceed with a tampered bundle.",
        );
      }
    }
  }

  return { manifest, bundleDir, entries };
}
