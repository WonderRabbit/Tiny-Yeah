import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { maxBuffer } from "./constants.mjs";
import { errorMessage, isNodeError, VerifyOfflineBundleError } from "./errors.mjs";

const execFileAsync = promisify(execFile);

export function parseArgs(argv) {
  const parsed = { bundle: undefined, keepTemp: false, tmpRoot: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--bundle") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new VerifyOfflineBundleError("ARGUMENT_INVALID", "--bundle requires an archive path", {
          argument: "--bundle",
          phase: "parse",
        });
      }
      parsed.bundle = path.resolve(value);
      index += 1;
    } else if (arg === "--tmp-root") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new VerifyOfflineBundleError("ARGUMENT_INVALID", "--tmp-root requires a directory path", {
          argument: "--tmp-root",
          phase: "parse",
        });
      }
      parsed.tmpRoot = path.resolve(value);
      index += 1;
    } else if (arg === "--keep-temp") {
      parsed.keepTemp = true;
    } else {
      throw new VerifyOfflineBundleError("ARGUMENT_INVALID", `unknown argument: ${arg}`, {
        argument: arg,
        phase: "parse",
      });
    }
  }
  if (parsed.bundle === undefined) {
    throw new VerifyOfflineBundleError(
      "ARGUMENT_INVALID",
      "usage: npm run verify:offline -- --bundle /path/to/tiny-yeah-offline-vX.Y.Z.tar.gz",
      { argument: "--bundle", phase: "parse" },
    );
  }
  return parsed;
}

export async function assertReadableBundle(bundlePath) {
  let bundleStat;
  try {
    bundleStat = await stat(bundlePath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new VerifyOfflineBundleError("BUNDLE_NOT_FOUND", `bundle archive does not exist: ${bundlePath}`, {
        bundle: bundlePath,
        phase: "bundle-open",
      });
    }
    throw new VerifyOfflineBundleError("BUNDLE_UNREADABLE", `bundle archive is not readable: ${bundlePath}`, {
      bundle: bundlePath,
      cause: errorMessage(error),
      phase: "bundle-open",
    });
  }
  if (!bundleStat.isFile()) {
    throw new VerifyOfflineBundleError("BUNDLE_UNREADABLE", `bundle archive is not a file: ${bundlePath}`, {
      bundle: bundlePath,
      phase: "bundle-open",
    });
  }
  try {
    await execFileAsync("tar", ["-tzf", bundlePath], { maxBuffer });
  } catch (error) {
    throw new VerifyOfflineBundleError("BUNDLE_ARCHIVE_INVALID", `bundle archive is not a readable gzip tarball: ${bundlePath}`, {
      bundle: bundlePath,
      cause: errorMessage(error),
      phase: "bundle-open",
    });
  }
  return { bundleBytes: bundleStat.size };
}
