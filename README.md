# Tiny-Yeah

Tiny-Yeah is a **small-model-safe orchestration kernel** (SPEC-TINY-YEAH-001, "Checkpointed
Composer Kernel"). The model emits only intents / manifests / approvals; everything else
(serialization, locking, validation, analysis, rendering, evidence matching, writing) is a
deterministic algorithm owned by the kernel. Every model-facing artifact write is forced through
a preview → checkpoint → apply path with create-only atomic primitives.

## Status

Phase 0 — scaffold + donor characterization tests. No runtime modules are implemented yet. See
[`../.moai/specs/SPEC-TINY-YEAH-001/plan.md`](../.moai/specs/SPEC-TINY-YEAH-001/plan.md) for the
6-phase delivery plan (Phases 0–5).

## Runtime target

- **Node ≥ 22.5**, ESM only (`"type": "module"`), NodeNext module resolution.
- **PowerShell 7+ is the sole shell target.** The kernel uses only Node built-ins
  (`node:fs` / `node:crypto` / `node:path`) and never shells out to `bash`/`zsh`. PowerShell
  is reserved for shell-out tooling only.
- **Single-host local filesystem only.** The advisory lock is built on local-FS advisory
  semantics and is **not** safe on NFS / SMB / distributed filesystems (REQ-TY-010). Non-local
  FS detection fails closed.

## Commands

```bash
npm install
npm run check      # lint + typecheck + test + build (run before declaring done)
npm run build      # tsc -p tsconfig.build.json  ->  dist/
npm run typecheck  # tsc --noEmit (src only)
npm test           # vitest run
npm run lint       # biome check .
npm run format     # biome format --write .
```

Single test: `npx vitest run tests/characterization/<file>.test.ts`

## Characterization tests

`tests/characterization/` captures the load-bearing invariants of the three donor codebases
(Tiny-Chu, Tinker.Gen, ui_pop) **before** any migration, so later phases cannot silently break
them. The tests import donor `.ts` sources directly via vitest's native TS transform.
