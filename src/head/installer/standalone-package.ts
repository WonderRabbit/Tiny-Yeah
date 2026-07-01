import type { Stats } from "node:fs";
import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { VerifiedBundle } from "./bundle-reader.js";
import { InstallerError } from "./errors.js";

const PLUGIN_NAME = "tiny-yeah";

export const STANDALONE_PACKAGE_DEST_REL = path.join(".opencode", "node_modules", PLUGIN_NAME);

function resolveBundlePath(bundleRoot: string, relPath: string): string {
  if (path.isAbsolute(relPath)) {
    throw new InstallerError({
      code: "BUNDLE_MANIFEST_INVALID",
      message: `Bundle path must be relative: ${relPath}`,
      recoveryHint: "Rebuild the offline bundle; manifest installer paths must be relative.",
    });
  }
  const root = path.resolve(bundleRoot);
  const resolved = path.resolve(root, relPath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new InstallerError({
      code: "BUNDLE_MANIFEST_INVALID",
      message: `Bundle path escapes bundle root: ${relPath}`,
      recoveryHint:
        "Rebuild the offline bundle; manifest installer paths must stay inside the bundle.",
    });
  }
  return resolved;
}

export async function copyStandalonePackage(input: {
  readonly bundle: VerifiedBundle;
  readonly projectRoot: string;
  readonly replaceExisting: boolean;
}): Promise<string | undefined> {
  const standalonePackageDir = input.bundle.manifest.installer?.standalonePackageDir;
  if (standalonePackageDir === undefined) return undefined;

  const src = resolveBundlePath(input.bundle.bundleDir, standalonePackageDir);
  let srcInfo: Stats;
  try {
    srcInfo = await stat(src);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      throw new InstallerError({
        code: "BUNDLE_FILE_MISSING",
        message: `Standalone package tree is missing: ${standalonePackageDir}`,
        recoveryHint: "Rebuild the offline bundle; node_modules/tiny-yeah must be present.",
        cause: error,
      });
    }
    throw error;
  }
  if (!srcInfo.isDirectory()) {
    throw new InstallerError({
      code: "BUNDLE_FILE_MISSING",
      message: `Standalone package path is not a directory: ${standalonePackageDir}`,
      recoveryHint: "Rebuild the offline bundle; node_modules/tiny-yeah must be a directory.",
    });
  }

  const dest = path.join(input.projectRoot, STANDALONE_PACKAGE_DEST_REL);
  let destExists = false;
  try {
    await stat(dest);
    destExists = true;
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT"
      )
    ) {
      throw error;
    }
  }
  if (destExists) {
    if (!input.replaceExisting) {
      throw new InstallerError({
        code: "CREATE_ONLY_TARGET_EXISTS",
        message: `Create-only target already exists: ${dest}`,
        recoveryHint: "Use the update/overwrite path, or pass --force to back up and replace.",
      });
    }
    await rm(dest, { recursive: true, force: true });
  }

  await mkdir(path.dirname(dest), { recursive: true });
  try {
    await cp(src, dest, { recursive: true, force: false, errorOnExist: true });
  } catch (error) {
    throw new InstallerError({
      code: "WRITE_FAILED",
      message: `Failed to copy standalone package tree to ${dest}`,
      recoveryHint: "Ensure the target .opencode/node_modules directory is writable.",
      cause: error,
    });
  }
  return STANDALONE_PACKAGE_DEST_REL;
}
