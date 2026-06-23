# Wave 1: Installer and Windows Portability

Worker: `019ef3f6-963b-7221-9748-5eee30ed10d6`

## Key Findings

- `bin/tiny-yeah.js` is a dependency-free bootstrap with install/update/doctor/uninstall commands and dynamic lifecycle import via `pathToFileURL`.
- `src/head/installer/lifecycle.ts` runs the real install/update/uninstall path, including `.opencode` managed file writes, config merge, `npm install --offline --ignore-scripts --no-audit --fund=false`, smoke import, stamp writing, plugin cache invalidation, and best-effort `opencode --version` detection.
- `doctor.ts` has the explicit Windows/PowerShell policy: `pwsh --version` is a hard failure on `win32` when absent or below major 7, but only a warning on non-Windows.
- The installer path shells out to `npm` and `opencode` via `execFile`, but no explicit `npm.cmd` or `cmd.exe` fallback was found.
- Path handling is mostly platform-neutral: `pathToFileURL`, path confinement, Windows-safe backup timestamp replacing `:` and `.`, and local `.opencode` lock/stamp paths.
- The integration harness uses `tar -xzf`, which is Unix-biased and not itself proof of Windows-host execution.

## Sources

- `/Users/oneyoon/Workspace/Personal/Tiny-Yeah/bin/tiny-yeah.js`
- `/Users/oneyoon/Workspace/Personal/Tiny-Yeah/src/head/installer/lifecycle.ts`
- `/Users/oneyoon/Workspace/Personal/Tiny-Yeah/src/head/installer/doctor.ts`
- `/Users/oneyoon/Workspace/Personal/Tiny-Yeah/src/head/installer/writer.ts`
- `/Users/oneyoon/Workspace/Personal/Tiny-Yeah/tests/unit/installer/doctor.test.ts`
- `/Users/oneyoon/Workspace/Personal/Tiny-Yeah/tests/integration/installer-e2e.test.ts`

## EXPAND

- LEAD: `src/head/installer/doctor.ts:203-256` Windows/PowerShell hard-fail vs warn split - WHY: this is the only explicit `win32` branch in the installer domain - ANGLE: trace whether install/update should mirror this policy or whether doctor is intentionally stricter than runtime install
- LEAD: `tests/unit/installer/doctor.test.ts:173-188` non-Windows pwsh tolerance - WHY: proves the current intended portability contract - ANGLE: add a Windows CI assertion if you need proof that `win32` actually fails without `pwsh`
- LEAD: `tests/integration/installer-e2e.test.ts:104-110` `tar -xzf` in integration harness - WHY: this is the main non-portable test dependency I found - ANGLE: look for a Windows-safe extractor or conditional test skip/fallback
- LEAD: `src/head/installer/lifecycle.ts:468-496` `npm` shell-out - WHY: confirms there is no `npm.cmd` branch - ANGLE: search whether Windows needs a wrapper in environments where `npm` is not directly resolvable
- LEAD: `src/head/installer/writer.ts:39-45` timestamp sanitization for backups - WHY: this is the main cross-platform path normalization detail - ANGLE: verify backup naming is preserved in uninstall/update edge cases
- LEAD: `tests/integration/installer-e2e.test.ts` vs missing `tests/integration/installer-e2e/` directory - WHY: scope mismatch matters for follow-up searches - ANGLE: standardize future searches on the actual file path only
