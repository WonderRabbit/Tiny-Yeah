# Tiny-Yeah

Tiny-Yeah는 **소형 모델 안전 오케스트레이션 커널**입니다
(SPEC-TINY-YEAH-001, "Checkpointed Composer Kernel"). 모델은 intent / manifest / approval만
내보내며, 그 밖의 모든 작업(직렬화, 잠금, 검증, 분석, 렌더링, 증거 매칭, 쓰기)은 커널이
소유한 결정적 알고리즘으로 처리합니다. 모델과 맞닿은 모든 산출물 쓰기는 create-only 원자
프리미티브를 사용하는 preview → checkpoint → apply 경로를 반드시 통과합니다.

## 상태

Phase 0 — scaffold 및 donor 특성화 테스트 단계입니다. 아직 런타임 모듈은 구현되지
않았습니다. 6단계 전달 계획(Phases 0–5)은
[`../.moai/specs/SPEC-TINY-YEAH-001/plan.md`](../.moai/specs/SPEC-TINY-YEAH-001/plan.md)를
참고하세요.

## 런타임 대상

- **Node ≥ 22.5**, ESM 전용(`"type": "module"`), NodeNext 모듈 해석.
- **PowerShell 7+가 유일한 shell 대상입니다.** 커널은 Node 기본 모듈
  (`node:fs` / `node:crypto` / `node:path`)만 사용하며 `bash`/`zsh`로 shell-out하지 않습니다.
  PowerShell은 shell-out tooling에만 예약됩니다.
- **단일 호스트 local filesystem 전용입니다.** advisory lock은 local-FS advisory 의미론에
  기반하며 NFS / SMB / distributed filesystem에서는 **안전하지 않습니다**(REQ-TY-010).
  non-local FS 감지는 fail-closed로 처리합니다.

## 명령어

```bash
npm install
npm run check      # lint + typecheck + test + build (완료 선언 전 실행)
npm run build      # tsc -p tsconfig.build.json  ->  dist/
npm run typecheck  # tsc --noEmit (src만)
npm test           # vitest run
npm run lint       # biome check .
npm run format     # biome format --write .
```

단일 테스트: `npx vitest run tests/characterization/<file>.test.ts`

## Windows standalone offline 실행

비개발자는 [Windows standalone 설치 가이드](docs/windows-standalone-install.md)를 먼저
보세요. 이 저장소를 GitHub ZIP 또는 `git clone`으로 받은 뒤에는 루트에서 아래 명령만 실행하면
저장소 안의 `release/tiny-yeah-offline-v<version>.tar.gz`를 자동으로 찾아 설치합니다.

```powershell
pwsh .\install-from-repo.ps1 -TargetProject C:\path\to\opencode-project -Yes
```

릴리스 tarball만 따로 받은 경우에는 압축을 풀고 bundle 루트에서 실행합니다.

```powershell
pwsh ./install-offline.ps1 -TargetProject C:\path\to\opencode-project -Yes
```

개발자가 새 릴리스 번들을 만들고 검증할 때는 아래 명령을 사용합니다.

```bash
npm run release:offline
npm run verify:offline -- --bundle release/tiny-yeah-offline-v1.0.0.tar.gz
```

`airGapComplete: true` 번들은 `node_modules/tiny-yeah` 준비본을 함께 담습니다. installer가 준비본을
`.opencode/`로 복사하므로 대상 PC에서 `npm install`을 다시 실행하지 않아도 됩니다.

번들이 준비본을 담지 못한 경우에는 manifest가 `airGapComplete: false`로 남고, 검증 스크립트도
그 상태를 숨기지 않습니다.

## 특성화 테스트

`tests/characterization/`은 마이그레이션 전에 세 donor codebase(Tiny-Chu, Tinker.Gen, ui_pop)의
핵심 불변 조건을 고정합니다. 이후 단계가 이 조건을 조용히 깨지 못하도록 하기
위함입니다. 테스트는 vitest의 native TS transform을 통해 donor `.ts` 소스를 직접 import합니다.
