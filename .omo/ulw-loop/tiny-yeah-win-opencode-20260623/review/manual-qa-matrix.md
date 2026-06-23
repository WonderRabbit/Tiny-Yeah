# Manual QA Matrix

Scope: Windows 10 PowerShell 7.6 OpenCode readiness work for Tiny-Yeah.

Host boundary:
- Executed host: macOS, Node v26.3.0, npm 11.16.0.
- Not executed: real Windows 10 host and PowerShell 7.6.
- Final answer must not claim Windows execution. It may claim portable installer/package/plugin proof and provide exact Windows commands.

Scenarios:

| ID | Scenario | Evidence | Result |
| --- | --- | --- | --- |
| QA-001 | Install from `release/tiny-yeah-offline-v1.0.0.tar.gz` into a clean target project using `node bin/tiny-yeah.js install --yes --json`. | `../evidence/raw/C001-install-doctor-plugin.raw.txt` | Pass |
| QA-002 | Run full doctor against the installed target and release archive. | `../evidence/raw/C001-install-doctor-plugin.raw.txt` | Pass, degraded only for host warnings |
| QA-003 | Import installed OpenCode plugin package and assert `tiny_yeah_install_check`. | `../evidence/raw/C001-install-doctor-plugin.raw.txt` | Pass |
| QA-004 | Reject missing or malformed archive input before managed writes. | `../evidence/raw/C002-bundle-input-edge.raw.txt` | Pass, expected exit 2 |
| QA-005 | Verify offline bundle performs offline install and export smoke. | `../evidence/raw/C003-verify-offline.raw.txt` | Pass |
| QA-006 | Verify npm package excludes local state, release artifacts, source, and tests. | `../evidence/raw/C003-pack-dry-run.raw.txt`; `tests/unit/installer/package-manifest.test.ts` | Pass |
| QA-007 | Run full repo gate. | `../evidence/raw/C003-npm-run-check.raw.txt` | Pass |

Windows command for user-side execution:

```powershell
cd <Tiny-Yeah repo>
node .\bin\tiny-yeah.js install --project <target-project> --bundle .\release\tiny-yeah-offline-v1.0.0.tar.gz --yes --json
node .\bin\tiny-yeah.js doctor --project <target-project> --bundle .\release\tiny-yeah-offline-v1.0.0.tar.gz --mode full --json
opencode
```

Expected prerequisites:
- Node >= 22.5.0
- npm available on PATH
- PowerShell 7+
- OpenCode >= 1.4.0 on PATH for doctor pass status
- Windows-provided `tar.exe` available on PATH, or manually extract the archive and pass the extracted bundle directory
