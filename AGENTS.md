# AGENTS.md

이 파일은 Codex (Codex.ai/code)가 이 저장소에서 코드를 다룰 때 따라야 할 지침입니다.

## 이 저장소의 정체

Tiny-Yeah는 **Checkpointed Composer Kernel**(SPEC-TINY-YEAH-001)입니다. 소형 모델 안전
오케스트레이션 커널이며, 모델은 intent 파싱, planning, copy generation, approval만 담당합니다.
모든 결정적 작업(직렬화, 잠금, 경로 안전성, 검증, 분석, 렌더링, 증거 매칭, 쓰기)은 커널 안에
있습니다. 모델과 맞닿은 모든 산출물 쓰기는 create-only 원자 프리미티브를 사용하는
`preview → checkpoint → apply` 경로를 반드시 통과합니다.

권위 있는 SPEC 문서는 `../.moai/specs/SPEC-TINY-YEAH-001/`에 있습니다.
- `spec.md` — 29개 EARS 요구사항(REQ-TY-001..029)
- `strategy.md` — 아키텍처(module boundary map §4, model contract §5)
- `plan.md` — 6단계 전달 계획(Phase 0–5), 기술 결정 §3

## 빌드와 테스트

```bash
npm run build          # tsc -p tsconfig.build.json  ->  dist/  (strict, NodeNext, declaration 출력)
npm run typecheck      # tsc --noEmit (src만)
npm test               # vitest run
npm run lint           # biome check .
npm run check          # lint && typecheck && test && build  (완료 선언 전 실행)
```

단일 테스트: `npx vitest run tests/characterization/<file>.test.ts`.

vitest는 donor `.ts` 소스를 직접 import합니다(native TS transform). 따라서 특성화 테스트는
donor project를 먼저 build할 필요가 **없습니다**.

## 아키텍처(load-bearing)

핵심 원칙은 하나입니다. **모델은 쓰기 핸들을 절대 들고 있지 않습니다.** 모델과 맞닿은 모든
산출물 쓰기는 `core/checkpoint/universal-write-path.ts`(Phase 1)를 통해 흐르며, 이 경로가
preview → checkpoint → apply를 강제합니다. 두 쓰기 계층은 반드시 분리되어야 합니다.

- **(A) 모델 대면 산출물 쓰기** — checkpointed + create-only입니다. (c) no-clobber
  보장이 여기에 적용됩니다. `fs.open(path, O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW, 0o600)` +
  temp-file + `fs.rename`/`fs.link`를 사용합니다(REQ-TY-005).
- **(B) 커널 내부 상태 쓰기** (`.tiny-yeah/` tasks/locks/index) — `writeJsonAtomic`
  (temp+rename, create-or-replace)을 통해 atomic하게 처리합니다. 커널 소유이며 모델은 핸들을
  갖지 않습니다. REQ-TY-004의 적용 대상이 아닙니다.

composer registry(`core/composer`, Phase 2)는 세 독립 surface(library API, OpenCode head,
install-check)가 소비하는 **단일 기준점**입니다. 병렬 tool array를 손으로 편집하지
마세요. `YeahFeaturePackage` descriptor를 추가하고 composer를 통해 bind해야 합니다.

## 규칙

- **ESM + NodeNext**: `.ts` source에서도 relative imports는 명시적 `.js` extension을 사용합니다.
- **결정적 출력**: persisted JSON은 sorted keys + trailing newline을 사용합니다.
- **최소 dependency**: runtime dependency는 `zod`뿐입니다. head는 `@opencode-ai/plugin`, tui는
  `@opentui/solid`를 추가합니다. Core는 Node 기본 모듈만 사용하며 `bash`/`zsh`로 shell-out하지
  않습니다.
- **Fail-closed**: malformed `.tiny-yeah/**/*.json`은 `MalformedJsonError`를 throw합니다. 조용히
  drop, quarantine, rewrite하지 않습니다.
