import { mkdir, readFile, rm, stat, statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { capacityFixtureName, minTempFreeBytes } from "./constants.mjs";
import { errorMessage, isNodeError, VerifyOfflineBundleError } from "./errors.mjs";

export async function resolveTmpRoot(tmpRoot) {
  const root = tmpRoot ?? os.tmpdir();
  try {
    await mkdir(root, { recursive: true });
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) {
      throw new VerifyOfflineBundleError("TMP_ROOT_INVALID", `--tmp-root is not a directory: ${root}`, {
        phase: "tmp-root",
        tmpRoot: root,
      });
    }
  } catch (error) {
    if (error instanceof VerifyOfflineBundleError) throw error;
    throw new VerifyOfflineBundleError("TMP_ROOT_INVALID", `could not prepare temp root: ${root}`, {
      cause: errorMessage(error),
      phase: "tmp-root",
      tmpRoot: root,
    });
  }
  return root;
}

function parseCapacityFixture(raw, fixturePath) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new VerifyOfflineBundleError("TMP_ROOT_CAPACITY_FIXTURE_INVALID", `invalid capacity fixture JSON: ${fixturePath}`, {
      cause: errorMessage(error),
      fixture: fixturePath,
      phase: "temp-preflight",
    });
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    typeof parsed.availableBytes !== "number" ||
    !Number.isSafeInteger(parsed.availableBytes) ||
    parsed.availableBytes < 0
  ) {
    throw new VerifyOfflineBundleError(
      "TMP_ROOT_CAPACITY_FIXTURE_INVALID",
      `capacity fixture must contain a non-negative integer availableBytes: ${fixturePath}`,
      { fixture: fixturePath, phase: "temp-preflight" },
    );
  }
  return { availableBytes: parsed.availableBytes, source: "fixture" };
}

async function readCapacityProbe(tmpRoot) {
  const fixturePath = path.join(tmpRoot, capacityFixtureName);
  try {
    return parseCapacityFixture(await readFile(fixturePath, "utf8"), fixturePath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      const stats = await statfs(tmpRoot);
      return { availableBytes: stats.bavail * stats.bsize, source: "statfs" };
    }
    throw error;
  }
}

export async function assertTempCapacity(tmpRoot, bundleBytes) {
  const requiredBytes = Math.max(minTempFreeBytes, bundleBytes * 8);
  const probe = await readCapacityProbe(tmpRoot);
  if (probe.availableBytes < requiredBytes) {
    throw new VerifyOfflineBundleError(
      "TEMP_SPACE_INSUFFICIENT",
      `temp root has insufficient free space before extraction: ${tmpRoot}`,
      {
        availableBytes: probe.availableBytes,
        phase: "temp-preflight",
        requiredBytes,
        tmpRoot,
        tmpSpaceProbe: probe.source,
      },
    );
  }
  return { availableBytes: probe.availableBytes, requiredBytes, source: probe.source };
}

export async function cleanupTempRoot(tempRoot, keepTemp) {
  if (tempRoot === undefined) return { kept: [], removed: [] };
  if (keepTemp) return { kept: [tempRoot], removed: [] };
  await rm(tempRoot, { recursive: true, force: true });
  return { kept: [], removed: [tempRoot] };
}
