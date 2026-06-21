// UNIT: head/opencode/tui-plugin (SPEC-TINY-YEAH-001 REQ-TY-021, plan.md Phase 5).
//
// Resolution of open question S3: the `./tui` export is a REAL minimal module (not an export-map
// placeholder). @opentui/solid is a RUNTIME dependency loaded via dynamic import inside tui(), so
// the module compiles and the shape test passes even without a live terminal. The unit test
// asserts the plugin object SHAPE (id is a string, tui is a function) — NOT real terminal
// rendering, which requires a TUI host API mock that is out of MVP scope (YAGNI).

import { describe, expect, it } from "vitest";
import { TinyYeahOpenCodeTuiPlugin } from "../../../../src/head/opencode/tui-plugin.js";

describe("TinyYeahOpenCodeTuiPlugin — REQ-TY-021 minimal TUI surface shape", () => {
  it("exposes a stable string id (the @opencode-ai/plugin/tui TuiPluginModule contract)", () => {
    expect(typeof TinyYeahOpenCodeTuiPlugin.id).toBe("string");
    expect(TinyYeahOpenCodeTuiPlugin.id).toBe("tiny-yeah.dashboard");
  });

  it("exposes tui() as a function (the render entrypoint)", () => {
    expect(typeof TinyYeahOpenCodeTuiPlugin.tui).toBe("function");
  });

  it("has the default export alias equal to the named export", async () => {
    const mod = await import("../../../../src/head/opencode/tui-plugin.js");
    expect(mod.default).toBeDefined();
    expect(mod.default).toBe(TinyYeahOpenCodeTuiPlugin);
  });

  it("references @opentui/solid only via dynamic import (no static host-dep coupling)", async () => {
    // The module must NOT statically import @opentui/solid at module scope — that would force a
    // build-time dependency resolution and break the minimal-dep stance. The import is deferred
    // to inside tui() so the module loads without @opentui/solid installed.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const file = path.resolve("src/head/opencode/tui-plugin.ts");
    const content = await fs.readFile(file, "utf8");
    // No top-level (non-dynamic) import of @opentui/solid.
    const staticImportRe = /^import[^;]*from\s+["']@opentui\/solid["']/m;
    expect(staticImportRe.test(content)).toBe(false);
    // The dynamic import is present (deferred into tui()).
    expect(content.includes('import("@opentui/solid")')).toBe(true);
  });
});
