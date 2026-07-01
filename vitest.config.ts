import { defineConfig } from "vitest/config";
import path from "node:path";

// Characterization tests import donor `.ts` sources from sibling workspaces
// (../Tiny-Chu, ../Tinker.Gen, ../ui_pop). The donor sources use NodeNext relative imports
// with explicit `.js` extensions internally (e.g. `from "./file-store.js"`); vitest's Vite
// resolver rewrites those `.js` specifiers to their sibling `.ts` files at transform time, but
// only for modules Vite is allowed to transform. Two things must be configured:
//
//   1. server.fs.allow — Vite blocks serving files outside the project root by default. The
//      donor workspaces live one level up, so the parent Personal/ dir must be allowlisted.
//   2. deps.inline — by default Vite externalizes (pre-bundles) node_modules and treats the
//      rest as source-to-transform; inlining the donor workspace roots forces Vite to apply
//      its TS transform to the donor `.ts` files so their `.js`-extension relative imports
//      resolve recursively to sibling `.ts` files.
//
// Donor source is read-only here; nothing is written outside Tiny-Yeah/.
const workspaceRoot = path.resolve(__dirname, "..");

export default defineConfig({
  resolve: {
    extensions: [".ts", ".js", ".mjs", ".cjs", ".json"],
  },
  server: {
    fs: {
      // Allow vitest to read donor `.ts` sources from sibling workspaces.
      allow: [workspaceRoot],
    },
    deps: {
      // Force Vite to transform (not externalize) the donor workspace TS so their internal
      // `.js`-extension imports resolve to `.ts`.
      inline: [/Tiny-Chu/, /Tinker\.Gen/, /ui_pop/],
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
