// Tiny-Yeah install plan computation (SPEC-TINY-YEAH-002 REQ-TY2-009/010, strategy §4/§6).
//
// Maps a verified bundle's source paths to target <project>/.opencode/ paths. The plan is the
// --dry-run surface (REQ-TY2-009 e) and the input to the Phase-2 lifecycle execution. Path
// confinement is validated for every dest (REQ-TY2-007).
//
// Source → target mapping (strategy §6):
//   vendor/<bundled-tgz>                       → <project>/.opencode/vendor/<bundled-tgz-name>  (copy)
//   templates/opencode/package.json            → <project>/.opencode/package.json               (copy)
//   templates/opencode/plugins/tiny-yeah.ts    → <project>/.opencode/plugins/tiny-yeah.ts       (copy)
//   templates/opencode/tui.json                → <project>/.opencode/tui.json                   (copy)
//   (install stamp)                            → <project>/.opencode/.tiny-yeah-install.json    (write, Phase 2)
//   (opencode.json[c] deep-merge)              → <project>/.opencode/opencode.jsonc             (merge, Phase 2)
//
// The opencode.json[c] deep-merge entry is kind:"merge" — Phase 2 executes it via jsonc-parser.
// The install stamp is kind:"write" — Phase 2 computes its content and writes it atomically.
// Phase 1 represents both in the plan so --dry-run shows the full intended change set.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolvePathInsideRoot } from "../../core/state/path-safety.js";
import type { VerifiedBundle } from "./bundle-reader.js";
import { InstallerError } from "./errors.js";

export type InstallPlanKind = "copy" | "write" | "merge";

export interface InstallPlanEntry {
  /** Absolute source path (bundle-side). Undefined for synthesized entries (stamp write). */
  readonly src: string;
  /** Absolute destination path under <project>/.opencode/. */
  readonly dest: string;
  /** Operation kind: copy (bundle→dest), write (synthesized content), merge (JSONC deep-merge). */
  readonly kind: InstallPlanKind;
  /** True for entries the installer manages (tracked in managedPaths[] / eligible for uninstall). */
  readonly managed: boolean;
  /** Expected SHA-256 for copy entries (verified at apply time). Undefined for write/merge. */
  readonly expectedSha256?: string;
  /** Human-readable description of what this entry does (for --dry-run). */
  readonly description: string;
}

export interface InstallPlan {
  readonly projectRoot: string;
  readonly version: string;
  readonly entries: readonly InstallPlanEntry[];
}

export interface ComputeInstallPlanInput {
  readonly verifiedBundle: VerifiedBundle;
  readonly projectRoot: string;
}

async function sha256File(absPath: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(absPath));
  return hash.digest("hex");
}

function confined(projectRoot: string, relDest: string): string {
  const absolute = resolvePathInsideRoot(projectRoot, relDest);
  if (absolute === undefined) {
    throw new InstallerError({
      code: "PATH_ESCAPES_PROJECT",
      message: `Computed install dest escapes project root: ${relDest}`,
      recoveryHint:
        "This indicates a bug in plan computation; the dest must resolve under the project root.",
    });
  }
  return absolute;
}

/**
 * Compute the install plan for a verified bundle against a target project root. Every dest is
 * path-confined to <project>/.opencode/ (REQ-TY2-007). Copy entries carry an expectedSha256
 * computed from the bundle source so apply-time verification is possible.
 */
export async function computeInstallPlan(input: ComputeInstallPlanInput): Promise<InstallPlan> {
  const { verifiedBundle, projectRoot } = input;
  const { bundleDir, manifest } = verifiedBundle;
  const entries: InstallPlanEntry[] = [];

  // The reader guarantees manifest.installer is present for a VerifiedBundle (BUNDLE_INSTALLER_BLOCK_MISSING
  // is thrown in readBundle). Guard here so the type narrows for the template-path joins below.
  if (manifest.installer === undefined) {
    throw new InstallerError({
      code: "BUNDLE_INSTALLER_BLOCK_MISSING",
      message:
        "Verified bundle manifest is missing the installer block (reader invariant violated).",
      recoveryHint: "This indicates a bug — readBundle should have rejected this bundle already.",
    });
  }

  const opencodeRoot = (rel: string): string => confined(projectRoot, path.join(".opencode", rel));

  // 1. Vendor tarball: manifest.packageTarball → .opencode/vendor/<name>
  const vendorTarballName = path.basename(manifest.packageTarball);
  const vendorSrc = path.join(bundleDir, manifest.packageTarball);
  const vendorDest = opencodeRoot(path.join("vendor", vendorTarballName));
  entries.push({
    src: vendorSrc,
    dest: vendorDest,
    kind: "copy",
    managed: true,
    expectedSha256: await sha256File(vendorSrc),
    description: `Copy vendored tarball to .opencode/vendor/${vendorTarballName}`,
  });

  // 2. templates/opencode/package.json → .opencode/package.json
  const templatePkgSrc = path.join(bundleDir, manifest.installer.templatesDir, "package.json");
  entries.push({
    src: templatePkgSrc,
    dest: opencodeRoot("package.json"),
    kind: "copy",
    managed: true,
    expectedSha256: await sha256File(templatePkgSrc),
    description: "Copy template package.json to .opencode/package.json",
  });

  // 3. templates/opencode/plugins/tiny-yeah.ts → .opencode/plugins/tiny-yeah.ts
  const shimSrc = path.join(bundleDir, manifest.installer.templatesDir, "plugins", "tiny-yeah.ts");
  entries.push({
    src: shimSrc,
    dest: opencodeRoot(path.join("plugins", "tiny-yeah.ts")),
    kind: "copy",
    managed: true,
    expectedSha256: await sha256File(shimSrc),
    description: "Copy OpenCode plugin shim to .opencode/plugins/tiny-yeah.ts",
  });

  // 4. templates/opencode/tui.json → .opencode/tui.json
  const tuiSrc = path.join(bundleDir, manifest.installer.templatesDir, "tui.json");
  entries.push({
    src: tuiSrc,
    dest: opencodeRoot("tui.json"),
    kind: "copy",
    managed: true,
    expectedSha256: await sha256File(tuiSrc),
    description: "Copy TUI config to .opencode/tui.json",
  });

  // 5. opencode.json[c] deep-merge entry (kind:"merge", executed in Phase 2 via jsonc-parser).
  //    The dest is .opencode/opencode.jsonc (OpenCode's JSONC config; the lifecycle resolves
  //    whether the existing file is opencode.json or opencode.jsonc in Phase 2).
  entries.push({
    src: "",
    dest: opencodeRoot("opencode.jsonc"),
    kind: "merge",
    managed: true,
    description:
      "Deep-merge tiny-yeah plugin entry into .opencode/opencode.json[c] (JSONC-preserving)",
  });

  // 6. Install stamp write (kind:"write", content computed + written in Phase 2).
  entries.push({
    src: "",
    dest: opencodeRoot(".tiny-yeah-install.json"),
    kind: "write",
    managed: true,
    description: "Write install stamp to .opencode/.tiny-yeah-install.json",
  });

  return { projectRoot, version: manifest.version, entries };
}

/**
 * Human-readable --dry-run text (REQ-TY2-009 e). Lists every planned entry with its kind and dest.
 */
export function formatDryRun(plan: InstallPlan): string {
  const lines: string[] = [];
  lines.push(`tiny-yeah install --dry-run (version ${plan.version})`);
  lines.push(`project: ${plan.projectRoot}`);
  lines.push("");
  lines.push("Planned changes:");
  for (const entry of plan.entries) {
    const tag = entry.kind.toUpperCase().padEnd(6);
    lines.push(`  [${tag}] ${entry.dest}`);
    if (entry.src) {
      lines.push(`          <- ${entry.src}`);
    }
    lines.push(`          ${entry.description}`);
  }
  lines.push("");
  lines.push(`${plan.entries.length} entry/entries planned. No files written (--dry-run).`);
  return lines.join("\n");
}

/**
 * Machine-readable --json shape for --dry-run (REQ-TY2-009 e, REQ-TY2-010 --json schema).
 */
export function formatDryRunJson(plan: InstallPlan): {
  readonly command: "install";
  readonly dryRun: true;
  readonly version: string;
  readonly projectRoot: string;
  readonly entries: readonly InstallPlanEntry[];
} {
  return {
    command: "install",
    dryRun: true,
    version: plan.version,
    projectRoot: plan.projectRoot,
    entries: plan.entries,
  };
}
