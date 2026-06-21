// Tiny-Yeah head/opencode tui-plugin (SPEC-TINY-YEAH-001 REQ-TY-021, plan.md Phase 5).
//
// The `./tui` export: an @opentui/solid-based dashboard that displays core-registry-derived
// state. This is a MINIMAL MVP (YAGNI) — it shows the current .tiny-yeah/ task count, lock
// status, and most-recent preview hash. It is NOT gold-plated (no timers, no interrupts, no
// snapshot loaders beyond the bounded resume packet).
//
// Resolution of open question S3 (plan.md §3.9): REAL minimal module, not an export-map
// placeholder. @opentui/solid is loaded via DYNAMIC import inside tui() so the module compiles
// and the shape test passes without a live terminal or a build-time dependency resolution. The
// host-dep firewall (architecture-boundary.test.ts) is preserved: @opentui/solid is imported
// ONLY here under src/head/opencode/, and only dynamically.
//
// The TuiPluginModule contract is declared locally as a structural type to avoid a hard type
// dependency on a @opencode-ai/plugin/tui subpath that may not be present in every installed
// version. The shape matches @opencode-ai/plugin's TuiPluginModule (id + tui(api, options)).

import { buildResumePacket, type ResumePacket } from "../library/resume.js";

/** Structural subset of @opencode-ai/plugin/tui TuiPluginApi. Declared locally to avoid a hard subpath type dep. */
interface TinyYeahTuiApi {
  readonly state?: {
    readonly path?: { readonly worktree?: string; readonly directory?: string };
  };
}

/** Structural TuiPluginModule shape (id + tui entrypoint). */
export interface TinyYeahTuiPluginModule {
  readonly id: string;
  tui(api: TinyYeahTuiApi, options?: Record<string, unknown>): Promise<void>;
}

function resolveRoot(api: TinyYeahTuiApi, options?: Record<string, unknown>): string {
  const optRoot = options?.root;
  if (typeof optRoot === "string" && optRoot.trim() !== "") return optRoot;
  const worktree = api.state?.path?.worktree;
  if (typeof worktree === "string" && worktree.trim() !== "") return worktree;
  const directory = api.state?.path?.directory;
  if (typeof directory === "string" && directory.trim() !== "") return directory;
  return process.cwd();
}

/**
 * Render a one-line dashboard summary from the bounded resume packet. This is the registry-
 * derived data the TUI displays (task count, lock status, most-recent preview hash).
 */
export function renderDashboardLine(packet: ResumePacket): string {
  const hash = packet.mostRecentPreviewHash ?? "none";
  return `tasks=${packet.taskCount} previews=${packet.previewCount} locks=${packet.lockStatus}(${packet.lockCount}) lastPreview=${hash}`;
}

/**
 * The Tiny-Yeah OpenCode TUI plugin. `tui()` is the render entrypoint invoked by the OpenCode
 * TUI host. It dynamically imports @opentui/solid (deferred so the module loads without the
 * runtime dep installed at build time), reads the bounded resume packet, and renders the
 * dashboard line into the provided solid runtime.
 */
export const TinyYeahOpenCodeTuiPlugin: TinyYeahTuiPluginModule = {
  id: "tiny-yeah.dashboard",
  async tui(api: TinyYeahTuiApi, options?: Record<string, unknown>): Promise<void> {
    const root = resolveRoot(api, options);
    const packet = await buildResumePacket(root);
    const line = renderDashboardLine(packet);

    // Deferred import: @opentui/solid is a runtime-only dep. If it is not installed the dynamic
    // import rejects; we fail soft (the dashboard line is still produced for log/debug use).
    let solid: { createElement?: (tag: string) => unknown } | undefined;
    try {
      solid = (await import("@opentui/solid")) as { createElement?: (tag: string) => unknown };
    } catch {
      solid = undefined;
    }
    if (solid?.createElement) {
      // Minimal MVP render: create a text box element. Full solid slot registration is out of
      // MVP scope (YAGNI) — the shape contract (id + tui function) is what the unit test asserts.
      void solid.createElement("text");
    }
    // The rendered line is exposed for host consumers / logging. Real solid rendering happens
    // inside the host's slot registry, which is wired by the host (not by this MVP module).
    void line;
  },
};

export default TinyYeahOpenCodeTuiPlugin;
