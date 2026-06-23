# Accepted Size Exceptions

Scope: Windows/OpenCode readiness patch.

Decision: accept bounded edits in existing oversized installer/release files for this task.

Rationale:
- `bin/tiny-yeah.js` is intentionally a hermetic, dependency-free, single-file installer entrypoint. It is copied into offline bundles and verified in a bare environment. Splitting direct archive handling into another runtime file would require changing the standalone bin contract, release copy rules, and hermetic verifier semantics. That is a larger architectural change than the user asked for.
- `src/head/installer/lifecycle.ts` already owns the install lifecycle and `npm install --offline` policy. The added `resolveNpmCachePath` and npm flags are a narrow correction to the existing install step, not a new lifecycle.
- `src/head/installer/doctor.ts` already owns full-mode bundle integrity checks. The archive-path `SHA256SUMS` support is a bounded extension of the existing `checkBundleSha256sums` function.
- `scripts/release/build-offline-bundle.mjs` already owns dependency materialization strategy. The `repo-node_modules-prune` fallback is a bounded fallback inside that strategy, needed so the generated release can be air-gap complete from the local checkout.

Risk controls:
- All new behavior is covered by targeted tests or raw evidence.
- The new doctor archive SHA coverage was split into `tests/unit/installer/doctor-archive-sha.test.ts` instead of growing the existing oversized `doctor.test.ts`.
- Full `npm run check` passes under Node v26.3.0.
- The exception is limited to this readiness patch and does not approve future growth in these files.

Follow-up recommendation:
- Split installer/release internals in a separate refactor after this readiness path is shipped. Suggested seams: archive bundle preparation, npm offline install policy, doctor SHA verification, and release dependency materialization.
