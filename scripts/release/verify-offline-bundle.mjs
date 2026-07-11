#!/usr/bin/env node
// Tiny-Yeah offline-bundle verify (SPEC-TINY-YEAH-001 REQ-TY-022 + SPEC-TINY-YEAH-002 REQ-TY2-001/018).
//
// Extracts the tarball produced by build-offline-bundle.mjs to a temp dir, reads the manifest,
// and verifies the bundled project is importable. When manifest.airGapComplete is true, it also
// attempts `npm install --offline` in a consumer dir against a dummy registry (no network) and a
// smoke import. When airGapComplete is false (deps could not be vendored), it verifies only the
// bundled dist/ imports and reports the gap honestly — it does NOT claim the offline install is
// air-gapped-complete.
//
// SPEC-TINY-YEAH-002 Phase 0 extension: also asserts the bundle is SELF-INSTALLING — the new
// entries (bin/tiny-yeah.js, templates/opencode/{package.json,plugins/tiny-yeah.ts,tui.json},
// install-offline.ps1) are present, manifest.installer describes them, and the bin runs
// hermetically (node bin/tiny-yeah.js --version works WITHOUT node_modules — REQ-TY2-018).

import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  findBundleDir,
  installConsumerForSmoke,
  prepareConsumer,
  readJson,
  runSmoke,
  runStandaloneInstallSmoke,
  verifyInstallerEntries,
  verifyNoForbiddenStandaloneEntries,
} from "./verify-offline-bundle/bundle-checks.mjs";
import { maxBuffer } from "./verify-offline-bundle/constants.mjs";
import {
  errorMessage,
  isNoSpaceError,
  stableStringify,
  VerifyOfflineBundleError,
} from "./verify-offline-bundle/errors.mjs";
import { assertReadableBundle, parseArgs } from "./verify-offline-bundle/input.mjs";
import { assertTempCapacity, cleanupTempRoot, resolveTmpRoot } from "./verify-offline-bundle/temp-root.mjs";

const execFileAsync = promisify(execFile);

async function main() {
  let args;
  let phase = "parse";
  let tarExtractStarted = false;
  let tempRoot;
  try {
    args = parseArgs(process.argv.slice(2));
    phase = "bundle-open";
    const bundleInfo = await assertReadableBundle(args.bundle);
    phase = "tmp-root";
    const tmpRoot = await resolveTmpRoot(args.tmpRoot);
    phase = "temp-preflight";
    const tempPreflight = await assertTempCapacity(tmpRoot, bundleInfo.bundleBytes);
    tempRoot = await mkdtemp(path.join(tmpRoot, "tiny-yeah-offline-verify-"));
    const report = {
      bundle: args.bundle,
      ok: true,
      preflight: {
        bundleBytes: bundleInfo.bundleBytes,
        tempAvailableBytes: tempPreflight.availableBytes,
        tempRequiredBytes: tempPreflight.requiredBytes,
        tempRoot: tmpRoot,
        tmpSpaceProbe: tempPreflight.source,
      },
      tempRoot: args.keepTemp ? tempRoot : undefined,
    };

    phase = "extract";
    tarExtractStarted = true;
    try {
      await execFileAsync("tar", ["-xzf", args.bundle, "-C", tempRoot], { maxBuffer });
    } catch (error) {
      if (isNoSpaceError(error)) {
        throw new VerifyOfflineBundleError(
          "TEMP_SPACE_EXHAUSTED",
          `temp root ran out of space during extraction: ${tmpRoot}`,
          { cause: errorMessage(error), phase, tmpRoot },
        );
      }
      throw new VerifyOfflineBundleError("BUNDLE_EXTRACT_FAILED", `bundle extraction failed: ${args.bundle}`, {
        bundle: args.bundle,
        cause: errorMessage(error),
        phase,
      });
    }

    const bundleDir = await findBundleDir(tempRoot);
    const manifest = await readJson(path.join(bundleDir, "manifest.json"));
    report.version = manifest.version;
    report.airGapComplete = manifest.airGapComplete;
    report.dependencyStrategy = manifest.dependencyStrategy;

    phase = "forbidden-entries";
    await verifyNoForbiddenStandaloneEntries(bundleDir);

    phase = "installer-entries";
    report.installer = await verifyInstallerEntries(bundleDir, manifest, tempRoot);
    phase = "standalone-smoke";
    const standaloneSmoke = await runStandaloneInstallSmoke(bundleDir, manifest, tempRoot);
    report.standaloneInstall = standaloneSmoke.standaloneInstall;
    report.standaloneDoctor = standaloneSmoke.standaloneDoctor;

    phase = "consumer-prepare";
    const consumer = await prepareConsumer(bundleDir, tempRoot, manifest);

    phase = "consumer-install";
    const installResult = await installConsumerForSmoke(consumer.consumerRoot, manifest, tempRoot);
    report.installMode = installResult.mode;
    report.offlineInstallOk = installResult.offlineInstallOk;

    if (!installResult.ok) {
      report.cleanup = await cleanupTempRoot(tempRoot, args.keepTemp);
      console.error(stableStringify({ ...report, exitReason: installResult.error, ok: false }));
      process.exitCode = 1;
      return;
    }

    phase = "exports-smoke";
    report.smoke = await runSmoke(consumer.consumerRoot);
    report.cleanup = await cleanupTempRoot(tempRoot, args.keepTemp);
    console.log(stableStringify(report));
  } catch (error) {
    const cleanup = await cleanupTempRoot(tempRoot, args?.keepTemp ?? false);
    const code = error instanceof VerifyOfflineBundleError ? error.code : "VERIFY_OFFLINE_FAILED";
    const details = error instanceof VerifyOfflineBundleError ? error.details : {};
    const errorPhase =
      details !== null && typeof details === "object" && "phase" in details && typeof details.phase === "string"
        ? details.phase
        : phase;
    const report = {
      cleanup,
      code,
      error: errorMessage(error),
      ok: false,
      phase: errorPhase,
      tarExtractStarted,
      ...details,
    };
    console.error(stableStringify(report));
    process.exitCode = 1;
  }
}

await main();
