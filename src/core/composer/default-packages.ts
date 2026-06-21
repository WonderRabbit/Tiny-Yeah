// Tiny-Yeah minimal seed packages (SPEC-TINY-YEAH-001 plan.md §3.1 Phase 2).
// Two trivial packages so the composer is exercisable end-to-end and the architecture
// parity test (REQ-TY-012) has a non-empty registry to assert against. Domain tools
// (legacy/ux) are intentionally excluded (donor D4). Handlers demonstrate the
// manifest-return pattern without importing `../checkpoint` — they construct the
// MutationManifest object literally and wrap it in a tool output union defined in schema.

import type { TinyYeahToolOutput } from "../schema/index.js";
import type { TinyYeahFeaturePackage, TinyYeahToolContext, TinyYeahToolHandler } from "./types.js";

/** Trivial read-only health check. */
function healthCheckHandler(_input: unknown, _context: TinyYeahToolContext): TinyYeahToolOutput {
  return {
    kind: "data",
    data: { ok: true, kernel: "tiny-yeah", version: "0.2.0" },
  };
}

/** Demonstrates the manifest-return pattern: builds a create-only manifest, no FS write. */
function echoManifestHandler(input: unknown, _context: TinyYeahToolContext): TinyYeahToolOutput {
  const parsed = (input ?? {}) as { path?: string; content?: string };
  const targetPath = parsed.path ?? "echo.txt";
  const body = parsed.content ?? "tiny-yeah echo";
  // Built literally — handler does NOT import core/checkpoint. The sha256 here is a
  // placeholder deterministic value; real callers compute it via core/checkpoint/hashing
  // (the head layer), but the handler only emits the shape.
  const sha256 = "0".repeat(64);
  return {
    kind: "manifest",
    manifest: {
      schemaVersion: "tiny-yeah.mutation-manifest.v1",
      actions: [{ kind: "create", path: targetPath, content: body, sha256 }],
    },
  };
}

/**
 * Minimal seed — 2 trivial packages. `tiny-yeah.core-runtime` (no deps, health_check)
 * and `tiny-yeah.demo` (depends on core-runtime, echo_manifest). Phase 4/5 replace this
 * with the real tool surface; the composer mechanism itself is unchanged.
 */
export function createDefaultTinyYeahFeaturePackages(): readonly TinyYeahFeaturePackage[] {
  return [
    {
      id: "tiny-yeah.core-runtime",
      version: 1,
      title: "Core Runtime",
      category: "core-runtime",
      tools: [
        {
          name: "health_check",
          description: "Returns kernel health and version (read-only).",
          handler: healthCheckHandler as TinyYeahToolHandler,
          permission: { readOnly: true },
          smallModel: { outputMode: "json", deterministic: true },
        },
      ],
    },
    {
      id: "tiny-yeah.demo",
      version: 1,
      title: "Demo (manifest-return pattern)",
      category: "support",
      dependsOn: ["tiny-yeah.core-runtime"],
      tools: [
        {
          name: "echo_manifest",
          description: "Emits a create-only manifest (no filesystem write).",
          handler: echoManifestHandler as TinyYeahToolHandler,
          permission: { readOnly: true, writesArtifacts: true },
          smallModel: { outputMode: "json", deterministic: true },
        },
      ],
    },
  ];
}
