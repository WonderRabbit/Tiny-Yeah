# Programming And Slop Review

Review target: changed files for Windows/OpenCode readiness.

Checks:

| Area | Result | Notes |
| --- | --- | --- |
| Behavior locked by failing/targeted tests | Pass | Added archive bundle input coverage, doctor archive SHA coverage, and actual npm pack dry-run coverage. |
| Package test overfit | Fixed | `tests/unit/installer/package-manifest.test.ts` now inspects `npm pack --dry-run --json` output instead of mirroring `package.json.files`. |
| New TypeScript type assertions in changed tests | Fixed | Removed new `as DoctorMode` and archive-result assertions from changed test paths. Existing older assertions remain outside this change scope. |
| Offline npm install robustness | Pass | Installer uses target-scoped npm cache and `--legacy-peer-deps`; verify uses install-before-smoke. |
| Archive UX | Pass | `install` and `update` accept `.tar.gz`/`.tgz` by extracting to a temp bundle before lifecycle writes; malformed archives fail before managed writes. |
| Evidence quality | Pass | Raw transcripts are present under `../evidence/raw/` with Node version and exit codes. |
| Windows overclaim risk | Controlled | Evidence and final answer must state that real Windows 10 PowerShell 7.6 execution was not performed on this macOS host. |
| Deletion-only tests | Pass | New tests assert positive behavior (`install` accepts real tarball, doctor verifies archive SHA, package contains runtime entries) and negative behavior (invalid archive exits 2 before writes). |
| Tautological tests | Pass | Package test executes `npm pack --dry-run --json`; archive tests invoke the CLI and `tar`; doctor test checks computed SHA behavior. They do not assert helper constants alone. |
| Implementation-mirroring tests | Pass | Package test no longer reads `package.json.files`; it checks produced pack output. CLI tests verify observable exit codes and JSON, not internal helper names. |
| Excessive or useless tests | Pass | Added tests cover three prior failure modes: archive path treated as directory, `SHA256SUMS` lookup for archive paths, and publish surface leakage. No broad snapshot or duplicate matrix was added. |
| Production extraction/parsing/normalization necessity | Pass | Archive extraction in `bin/tiny-yeah.js` is necessary because the user can pass `release/*.tar.gz` directly from PowerShell; path normalization is constrained to `.tar.gz`/`.tgz` inputs and cleans temp dirs after lifecycle completion. |
| Raw evidence consistency | Pass | C002 raw evidence now creates invalid archive bytes before invoking install; C003 package size summary matches raw pack output. |
| Oversized touched files | Accepted exception plus split | See `accepted-size-exceptions.md`. The load-bearing installer/release entrypoint edits are accepted exceptions; the new doctor archive SHA test was split into `doctor-archive-sha.test.ts` instead of growing `doctor.test.ts`. |

Known residuals:
- `bin/tiny-yeah.js` depends on `tar` for direct archive input. Windows 10 typically includes `tar.exe`; if unavailable, the documented fallback is to extract the archive manually and pass the extracted directory.
