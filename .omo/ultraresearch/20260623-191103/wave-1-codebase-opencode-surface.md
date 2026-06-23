# Wave 1: Codebase OpenCode Surface

Worker: `019ef3f6-7b25-7073-a1a6-72000db06a52`

## Key Findings

- `package.json` exposes `./opencode` as `./dist/head/opencode/plugin.js` and `./tui` as `./dist/head/opencode/tui-plugin.js`.
- `src/head/opencode/plugin.ts` defines both the host-agnostic `createTinyYeahPlugin()` map and the host-specific `TinyYeahOpenCodePlugin` adapter using `@opencode-ai/plugin`.
- Tool registration is composer-driven via `src/head/opencode/library-surface.ts`, not manually duplicated in the plugin.
- Installer planning maps bundle/template assets into `.opencode/vendor/`, `.opencode/package.json`, `.opencode/plugins/tiny-yeah.ts`, `.opencode/tui.json`, `.opencode/opencode.json[c]`, and `.opencode/.tiny-yeah-install.json`.
- Tests cited by the worker include installer e2e export smoke, TUI plugin shape, composer parity, install plan, config merge, and architecture boundary tests.

## Sources

- `/Users/oneyoon/Workspace/Personal/Tiny-Yeah/package.json`
- `/Users/oneyoon/Workspace/Personal/Tiny-Yeah/src/head/opencode/plugin.ts`
- `/Users/oneyoon/Workspace/Personal/Tiny-Yeah/src/head/opencode/library-surface.ts`
- `/Users/oneyoon/Workspace/Personal/Tiny-Yeah/src/head/installer/plan.ts`
- `/Users/oneyoon/Workspace/Personal/Tiny-Yeah/templates/opencode/plugins/tiny-yeah.ts`
- `/Users/oneyoon/Workspace/Personal/Tiny-Yeah/tests/integration/installer-e2e.test.ts`

## EXPAND

- LEAD: public export entrypoint - WHY: proves `./opencode` and `./tui` are real package exports - ANGLE: inspect `package.json` and `src/index.ts`
- LEAD: runtime plugin surface - WHY: shows the concrete host adapter and tool registration - ANGLE: inspect `src/head/opencode/plugin.ts` and `src/head/opencode/library-surface.ts`
- LEAD: installer copy set - WHY: shows what a user actually gets under `.opencode/` - ANGLE: inspect `src/head/installer/plan.ts` and `templates/opencode/*`
- LEAD: config merge semantics - WHY: confirms how `tiny-yeah` is inserted into OpenCode config - ANGLE: inspect `src/head/installer/opencode-config.ts` and its tests
- LEAD: proof tests - WHY: validates the surface end to end, including exports and smoke-imports - ANGLE: inspect `tests/integration/installer-e2e.test.ts` and `tests/unit/head/opencode/tui-plugin.test.ts`
