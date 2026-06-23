# Ultraresearch Synthesis: Tiny-Yeah Windows 10 + PowerShell 7.6 + OpenCode Readiness

Workers: 6 · Waves: 1 primary + direct expansions · Sources: 20+ · Verifications: 10 commands

## Executive Summary

Strict verdict: **not ready to call "attach to an OpenCode running on Windows 10 PowerShell 7.6 and run immediately."** The current codebase has a real OpenCode plugin export and installer design, but readiness is gated by an offline bundle path, npm cache/materialization behavior, `pwsh` availability, and Windows-host execution that was not proven in this session.

The positive signal is real: `package.json` exposes `tiny-yeah/opencode` and `tiny-yeah/tui`; `src/head/opencode/plugin.ts` builds actual OpenCode tool hooks; `src/head/installer/plan.ts` writes `.opencode/package.json`, `.opencode/plugins/tiny-yeah.ts`, `.opencode/tui.json`, and config/stamp files. However, current verification is not green: `npm run check` failed; current `verify:offline` failed after regenerating the bundle; and this host has no `pwsh`.

## Findings by Theme

### 1. OpenCode surface exists

- `package.json` exports `./opencode` and `./tui`, and requires Node `>=22.5.0`. [Source: `/Users/oneyoon/Workspace/Personal/Tiny-Yeah/package.json:6-24`]
- `TinyYeahOpenCodePlugin` wraps composed tools with `@opencode-ai/plugin` `tool()` and injects `TINY_YEAH_ROOT` / `TINY_YEAH_OPENCODE_PLUGIN` into `shell.env`. [Source: `/Users/oneyoon/Workspace/Personal/Tiny-Yeah/src/head/opencode/plugin.ts:81-134`]
- OpenCode docs support local JavaScript/TypeScript plugins in `.opencode/plugins/` and npm plugins through `opencode.json`. [Source: `https://opencode.ai/docs/plugins`, accessed 2026-06-23]

### 2. Installer requires bundle materialization

- The install plan writes a vendored tarball, `.opencode/package.json`, `.opencode/plugins/tiny-yeah.ts`, `.opencode/tui.json`, plugin config, and install stamp. [Source: `/Users/oneyoon/Workspace/Personal/Tiny-Yeah/src/head/installer/plan.ts:94-160`]
- `node bin/tiny-yeah.js install --dry-run --json` in the raw repo failed with exit 2 because no offline bundle was located. [Verification: local command, 2026-06-23]
- `npm run release:offline` created `release/tiny-yeah-offline-v1.0.0.tar.gz`, but reported `airGapComplete: false`. [Verification: local command, 2026-06-23]

### 3. Current verification is not green

- `npm run typecheck` passed. [Verification: local command, 2026-06-23]
- `npm run build` passed. [Verification: local command, 2026-06-23]
- Focused OpenCode/installer tests passed: `tests/unit/installer/doctor.test.ts`, `opencode-config.test.ts`, `tui-plugin.test.ts`, `parity.test.ts` (51 tests). [Verification: local command, 2026-06-23]
- `npm run check` failed: installer e2e failed with install exit 5; Playwright degradation tests failed due macOS browser launch sandbox behavior. [Verification: local command, 2026-06-23]
- Current `npm_config_cache=/private/tmp/tiny-yeah-npm-cache-codex npm run verify:offline -- --bundle release/tiny-yeah-offline-v1.0.0.tar.gz` failed with `ERR_MODULE_NOT_FOUND: Cannot find package 'tiny-yeah'`. [Verification: local command, 2026-06-23]

### 4. Windows/PowerShell gate is explicit

- Doctor requires `pwsh` major version 7+ and treats missing/below-7 `pwsh` as a hard failure on `win32`. [Source: `/Users/oneyoon/Workspace/Personal/Tiny-Yeah/src/head/installer/doctor.ts:203-255`]
- This host does not have `pwsh`: `pwsh --version` exited 127. [Verification: local command, 2026-06-23]
- Microsoft docs list PowerShell 7.6.3 as current LTS and state PowerShell support on Windows ends when either PowerShell or the Windows version reaches end of support. [Source: `https://learn.microsoft.com/en-us/powershell/scripting/install/powershell-support-lifecycle?view=powershell-7.6`, accessed 2026-06-23]
- Windows 10 Home/Pro reached end of support on 2025-10-14; LTSC editions have separate lifecycles. [Source: `https://learn.microsoft.com/en-us/lifecycle/products/windows-10-home-and-pro`, accessed 2026-06-23]

### 5. OpenCode on Windows is possible but WSL is recommended

- OpenCode Windows docs say native Windows can run, but WSL is recommended for best experience. [Source: `https://opencode.ai/docs/windows-wsl`, accessed 2026-06-23]
- The docs list plugin load paths and npm plugin behavior; local `.ts` plugin files are accepted. [Source: `https://opencode.ai/docs/plugins`, accessed 2026-06-23]

## Readiness Verdict

No, not as "drop this beside an already-running Windows 10 PowerShell 7.6 OpenCode and immediately run." The minimum viable path still needs:

1. Windows host with supported `pwsh` 7+ on `PATH`.
2. Node `>=22.5.0`, npm, and OpenCode `>=1.4.0` on `PATH`.
3. A valid Tiny-Yeah offline bundle or unpacked bundle directory passed through `--bundle`.
4. Isolated/healthy npm cache, because default cache state caused install/pack failures in local verification.
5. Successful `tiny-yeah doctor --json`, `tiny-yeah install --project <repo> --bundle <bundle> --yes --json`, and OpenCode startup with `.opencode/plugins/tiny-yeah.ts` loaded.
6. A Windows-host run of the above; current session only proved macOS-side build/typecheck/focused tests and found failures in full check/offline verification.

## Contradictions

- README says Phase 0 scaffold/runtime not implemented, but source and CLI expose implemented OpenCode/installer surfaces. [Source: `/Users/oneyoon/Workspace/Personal/Tiny-Yeah/README.md:9-14`; `/Users/oneyoon/Workspace/Personal/Tiny-Yeah/bin/tiny-yeah.js --help`]
- A prior worker saw `verify:offline` pass with an isolated cache against an existing bundle; after this session regenerated the bundle, current verification failed. Current command output should be treated as fresher evidence.

## Gaps

- No actual Windows 10 + PowerShell 7.6 execution was possible from this host.
- No OpenCode startup against the installed Tiny-Yeah plugin was driven on Windows.
- Repeated force/update offline install currently has an `ENOTCACHED` risk reported by the verification worker.

## Expansion Trace

- Wave 1 covered codebase OpenCode surface, installer/Windows portability, spec/readiness docs, external OpenCode contract, external PowerShell/Windows runtime, and local runtime verification.
- EXPAND leads were cross-checked directly where possible. Remaining unchecked leads require a Windows host.
