recommendation: APPROVE

blockers:
- None.

originalIntent:
Make Tiny-Yeah attach to and run from OpenCode launched on Windows 10 with PowerShell 7.6. Because this host is macOS and has no real Windows/PowerShell surface, the acceptable user outcome is a portable installer/package/plugin path with explicit Windows commands and no claim that Windows itself was executed.

desiredOutcome:
A Windows user with the stated prerequisites can run the generated Tiny-Yeah installer/package/OpenCode plugin path immediately, while the delivered evidence proves the portable macOS-hosted installer, doctor, offline bundle, package, and plugin import surfaces and clearly records the Windows execution gap.

userOutcomeReview:
The current inspected worktree satisfies the requested final-gate focus. The fourth blocker was that new doctor archive SHA coverage had grown the already oversized `tests/unit/installer/doctor.test.ts`; the current diff for that file only removes the `DoctorMode` type import and the `as DoctorMode` assertion. The archive SHA coverage now lives in `tests/unit/installer/doctor-archive-sha.test.ts`, which directly exercises `doctor({ mode: "full", bundleDir: archivePath })` against a real `SHA256SUMS` entry beside an archive path. The manual QA matrix and evidence summaries explicitly state that Windows 10 PowerShell 7.6 was not executed.

checked artifact paths:
- `git diff -- tests/unit/installer/doctor.test.ts tests/unit/installer/doctor-archive-sha.test.ts`
- `tests/unit/installer/doctor.test.ts`
- `tests/unit/installer/doctor-archive-sha.test.ts`
- `.omo/ulw-loop/tiny-yeah-win-opencode-20260623/review/accepted-size-exceptions.md`
- `.omo/ulw-loop/tiny-yeah-win-opencode-20260623/review/programming-slop-review.md`
- `.omo/ulw-loop/tiny-yeah-win-opencode-20260623/review/manual-qa-matrix.md`
- `.omo/ulw-loop/tiny-yeah-win-opencode-20260623/brief.md`
- `.omo/ulw-loop/tiny-yeah-win-opencode-20260623/goals.json`
- `.omo/ulw-loop/tiny-yeah-win-opencode-20260623/evidence/raw/C003-npm-run-check.raw.txt`
- `.omo/ulw-loop/tiny-yeah-win-opencode-20260623/evidence/C001-happy-install-opencode-smoke.txt`
- `.omo/ulw-loop/tiny-yeah-win-opencode-20260623/evidence/C003-regression-quality.txt`
- `bin/tiny-yeah.js`
- `package.json`
- `src/head/installer/doctor.ts`
- `src/head/installer/lifecycle.ts`
- `src/core/pipeline/validate/playwright-driver.ts`
- `scripts/release/build-offline-bundle.mjs`
- `scripts/release/verify-offline-bundle.mjs`
- `tests/unit/installer/bin-install.test.ts`
- `tests/unit/installer/package-manifest.test.ts`
- `release/SHA256SUMS`

direct remove-ai-slops and programming pass:
- `doctor.test.ts` blocker resolution: pass. The current diff only removes `type DoctorMode` and `as DoctorMode`; no archive SHA test body remains in that oversized file.
- Oversized test growth: pass. `doctor.test.ts` remains pre-existing oversized at 400 pure LOC, but this change removes one net line there. New archive SHA coverage is isolated in `doctor-archive-sha.test.ts` at 116 pure LOC.
- Deletion-only test risk: pass. The new archive SHA test asserts a positive doctor full-mode outcome for an archive-path `SHA256SUMS` check.
- Tautological or implementation-mirroring test risk: pass for the requested blocker. The archive SHA test constructs observable filesystem inputs and calls the public `doctor` surface; it does not assert only helper constants or duplicate the implementation.
- Production extraction/parsing/normalization necessity: pass as recorded in `programming-slop-review.md`; the archive behavior is necessary for direct `.tar.gz` bundle input and is bounded to `.tar.gz`/`.tgz`.
- Review coverage: pass. `programming-slop-review.md` explicitly covers deletion-only tests, tautological tests, implementation-mirroring tests, excessive/useless tests, package overfit, production parsing necessity, TypeScript assertions, and oversized touched files.

evidence:
- Raw `C003-npm-run-check.raw.txt` reports `npm run check`, Node v26.3.0, npm 11.16.0, Vitest `64 passed (64)`, `513 passed | 1 todo (514)`, build pass, and `EXIT_CODE: 0`.
- `manual-qa-matrix.md` records executed host as macOS and not executed host as real Windows 10 with PowerShell 7.6.
- `accepted-size-exceptions.md` explicitly accepts bounded edits in existing oversized installer/release files and states that new doctor archive SHA coverage was split out of `doctor.test.ts`.

exact evidence gaps:
- No blocking evidence gaps found for the requested final gate.
- Non-blocking caveat: `evidence/C003-regression-quality.txt` still says `63 files passed`, but the requested raw transcript `evidence/raw/C003-npm-run-check.raw.txt` is the authoritative artifact inspected here and shows `64 passed (64)` with `EXIT_CODE: 0`.
