# Wave 1: External OpenCode Contract

Worker: `019ef3f6-b9c5-7490-974f-2b7cf217f1e0`

## Key Findings

- Local OpenCode plugins can be JavaScript or TypeScript files loaded from `.opencode/plugins/` or `~/.config/opencode/plugins/`, including path/file plugin specs.
- npm plugin packages are installed automatically at startup using Bun and cached by OpenCode.
- `@opencode-ai/plugin` is TypeScript-authored but built before publication; npm consumers load the packaged built entrypoint.
- OpenCode official docs recommend WSL for best Windows experience, while native Windows install methods also exist.
- OpenCode source has explicit PowerShell shell notes distinguishing `pwsh` from Windows PowerShell 5.1.

## Sources

- https://opencode.ai/docs/plugins/
- https://opencode.ai/docs/config/
- https://opencode.ai/docs/
- https://github.com/anomalyco/opencode/blob/a21e74773f281b1f414a543a5584b36585d28f30/packages/opencode/src/plugin/shared.ts
- https://github.com/anomalyco/opencode/blob/a21e74773f281b1f414a543a5584b36585d28f30/packages/opencode/src/plugin/index.ts
- https://github.com/anomalyco/opencode/blob/a21e74773f281b1f414a543a5584b36585d28f30/packages/plugin/package.json
- https://github.com/anomalyco/opencode/blob/a21e74773f281b1f414a543a5584b36585d28f30/packages/plugin/script/publish.ts
- https://github.com/anomalyco/opencode/blob/a21e74773f281b1f414a543a5584b36585d28f30/packages/opencode/src/tool/shell/prompt.ts

## EXPAND

- LEAD: official plugins doc - WHY: confirms local files, npm config, install behavior, type support, load order - ANGLE: site:opencode.ai plugin opencode.json
- LEAD: official config doc - WHY: confirms opencode.json locations and schema presence - ANGLE: site:opencode.ai opencode.json plugin
- LEAD: Windows install notes - WHY: confirms WSL recommendation and native Windows installers - ANGLE: site:opencode.ai Windows OpenCode
- LEAD: repo package manifest - WHY: confirms @opencode-ai/plugin exports and build packaging - ANGLE: site:github.com/anomalyco/opencode @opencode-ai/plugin
- LEAD: plugin loader implementation - WHY: shows file-vs-npm resolution and entrypoint detection - ANGLE: opencode plugin loader file:// npm add
- LEAD: plugin tests for local .ts files - WHY: proves direct loading of TypeScript plugin files works - ANGLE: local plugin examples file:// plugin.ts
- LEAD: plugin tests for npm packages - WHY: proves npm package installation and entrypoint loading behavior - ANGLE: npm plugin package server tui export
- LEAD: publish script - WHY: proves npm publish builds to dist first - ANGLE: @opencode-ai/plugin publish dist
- LEAD: PowerShell shell notes - WHY: provides Windows/PowerShell command semantics caveat - ANGLE: Windows PowerShell opencode shell notes
- LEAD: release metadata - WHY: establishes current repo/release recency around June 2026 - ANGLE: OpenCode release latest Jun 2026
