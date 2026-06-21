// Tiny-Yeah OpenCode plugin shim (SPEC-TINY-YEAH-002, strategy §6).
//
// Installed into <target>/.opencode/plugins/tiny-yeah.ts. Re-exports the plugin factory from
// the vendored tiny-yeah package so OpenCode can load it via the local plugins/ directory.
// Pattern borrowed from Tiny-Chu INSTALL.md step 7 (package subpath re-export shim).
//
// The bundled tarball's `exports["./opencode"]` maps to dist/head/opencode/plugin.js, which
// exposes `createTinyYeahPlugin` (the host-agnostic tool map). Phase 2 (head/installer/
// opencode-config.ts) may additionally wire TinyYeahOpenCodePlugin (the @opencode-ai/plugin
// Plugin) depending on the OpenCode host expectations — tail-assumption B (string vs tuple
// plugin-entry form) is resolved there.
export { createTinyYeahPlugin } from "tiny-yeah/opencode";
