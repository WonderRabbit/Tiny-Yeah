# Wave 1: Local Runtime Verification

Worker: `019ef3f6-f34b-7ff3-a8c4-2323172b3f5a`

## Key Findings

- `typecheck`, `build`, `lint`, `naming:check`, and `bin:smoke` passed locally.
- Full `npm test` failed: installer e2e returned exit 5 and Playwright graceful-degradation tests hit a macOS sandbox browser-launch failure rather than the expected missing-driver error.
- `pwsh` was not found on this host, so PowerShell/Windows execution was not proven.
- A default npm cache ownership issue broke `npm pack --dry-run`; with an isolated temp npm cache, `npm pack --dry-run` passed but showed a large 107.2 MB package including `.omo/`, release tarballs, source, and tests.
- `verify:offline` with isolated npm cache passed for the existing release bundle in the worker run, including `offlineInstallOk: true`, `hasInstallCheck: true`, `hasPlugin: true`, `hasTui: true`.
- First install with default npm cache failed exit 5; first install with isolated temp npm cache passed. Doctor on the installed temp project passed all install checks except `pwsh` missing.
- Force reinstall/update smoke failed offline with `ENOTCACHED` for `web-tree-sitter` / `solid-js`.

## Sources

- Local commands run in `/Users/oneyoon/Workspace/Personal/Tiny-Yeah`
- `npm test`
- `node bin/tiny-yeah.js doctor --json`
- `npm pack --dry-run`
- `npm run verify:offline -- --bundle release/tiny-yeah-offline-v1.0.0.tar.gz`
- `node bin/tiny-yeah.js install --project <tmp> --bundle <bundle> --yes --json`

## EXPAND

- LEAD: `npm pack --dry-run` includes `.omo/ultraresearch`, release tarballs, source, and tests, producing a 107.2 MB package - WHY: publish/install readiness likely needs `files` or `.npmignore` hardening - ANGLE: inspect intended npm package allowlist and compare against OpenCode installer runtime needs
- LEAD: forced reinstall/update fails offline with `ENOTCACHED` for `web-tree-sitter` / `solid-js` - WHY: update path is part of OpenCode install lifecycle and is not repeatably air-gapped - ANGLE: inspect bundled tarball package-lock/node_modules peer handling and lifecycle `npm install --offline` behavior after an existing install
- LEAD: full `npm test` depends on environment-specific Playwright behavior - WHY: installed Playwright changes the expected “missing optional dependency” path into a browser-launch sandbox failure - ANGLE: make Playwright degradation tests simulate import absence deterministically or tolerate launch-unavailable as typed unavailable
- LEAD: `pwsh` is missing on this host - WHY: Windows/PowerShell install script readiness cannot be runtime-proven here - ANGLE: run the same smoke on Windows with PowerShell 7+ and `npm_config_cache` isolated
- LEAD: default npm cache ownership breaks `npm pack` and first install tests - WHY: host cache state masks package behavior unless isolated - ANGLE: use temp npm cache in CI/verification harness or fix local cache ownership separately
