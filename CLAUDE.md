# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

## What this is

Tiny-Yeah is the **Checkpointed Composer Kernel** (SPEC-TINY-YEAH-001) — a small-model-safe
orchestration kernel. The model only parses intent, plans, generates copy, and approves; all
deterministic work (serialization, locking, path safety, validation, analysis, rendering,
evidence matching, writing) lives in the kernel. Every model-facing artifact write is forced
through `preview → checkpoint → apply` with create-only atomic primitives.

Authoritative SPEC documents live at `../.moai/specs/SPEC-TINY-YEAH-001/`:
- `spec.md` — 29 EARS requirements (REQ-TY-001..029)
- `strategy.md` — architecture (module boundary map §4, model contract §5)
- `plan.md` — 6-phase delivery plan (Phase 0–5), technical decisions §3

## Build and test

```bash
npm run build          # tsc -p tsconfig.build.json  ->  dist/  (strict, NodeNext, declarations)
npm run typecheck      # tsc --noEmit (src only)
npm test               # vitest run
npm run lint           # biome check .
npm run check          # lint && typecheck && test && build  (run before declaring done)
```

Single test: `npx vitest run tests/characterization/<file>.test.ts`.

vitest imports donor `.ts` sources directly (native TS transform), so characterization tests do
**not** require the donor projects to be built first.

## Architecture (load-bearing)

One core principle: **the model never holds a write handle.** All model-facing artifact writes
flow through `core/checkpoint/universal-write-path.ts` (Phase 1), which enforces
preview → checkpoint → apply. Two write layers must stay distinct:

- **(A) Model-facing artifact writes** — checkpointed + create-only. The (c) no-clobber
  guarantee applies here. Uses `fs.open(path, O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW, 0o600)` +
  temp-file + `fs.rename`/`fs.link` (REQ-TY-005).
- **(B) Kernel internal state writes** (`.tiny-yeah/` tasks/locks/index) — atomic via
  `writeJsonAtomic` (temp+rename, create-or-replace). Kernel-owned; the model has no handle.
  Not subject to REQ-TY-004.

The composer registry (`core/composer`, Phase 2) is the **single source of truth** consumed by
three independent surfaces (library API, OpenCode head, install-check). Never hand-edit parallel
tool arrays — add a `YeahFeaturePackage` descriptor and bind it through the composer.

## Conventions

- **ESM + NodeNext**: relative imports use explicit `.js` extensions even in `.ts` sources.
- **Deterministic output**: persisted JSON uses sorted keys + trailing newline.
- **Minimal deps**: runtime is `zod` only; head adds `@opencode-ai/plugin`, tui adds
  `@opentui/solid`. Core uses Node built-ins exclusively — no shell-outs to `bash`/`zsh`.
- **Fail-closed**: malformed `.tiny-yeah/**/*.json` throws `MalformedJsonError` (never silently
  dropped, quarantined, or rewritten).
