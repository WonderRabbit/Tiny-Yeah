# Windows standalone 설치 가이드

이 문서는 개발자가 아닌 사용자도 Tiny-Yeah offline bundle을 Windows에서 설치할 수 있도록
정리한 절차입니다. 목표는 대상 PC에서 `npm install`을 다시 실행하지 않고, GitHub에서 받은
저장소 또는 완성된 bundle 파일만으로 설치하는 것입니다.

## 한눈에 보는 흐름

가장 쉬운 방법은 Tiny-Yeah 저장소 전체를 받은 뒤 루트에서 `install-from-repo.ps1`을 실행하는
것입니다.

1. Tiny-Yeah 저장소를 GitHub ZIP 또는 `git clone`으로 받습니다.
2. Windows PC에 Node.js 22.5 이상과 PowerShell 7 이상이 있는지 확인합니다.
3. 설치할 OpenCode 프로젝트 폴더를 정합니다.
4. 저장소 루트에서 `install-from-repo.ps1`을 실행합니다.
5. `tiny-yeah doctor`로 설치 상태를 확인합니다.

`tiny-yeah-offline-v1.0.0.tar.gz` 파일만 따로 받은 경우에는 아래의 “방법 B”를 사용합니다.

## 준비물

### Tiny-Yeah 파일

둘 중 하나가 필요합니다.

```text
방법 A: Tiny-Yeah 저장소 전체
  install-from-repo.ps1
  bin\tiny-yeah.js
  release\tiny-yeah-offline-v1.0.0.tar.gz

방법 B: offline bundle 파일
  tiny-yeah-offline-v1.0.0.tar.gz
```

정상 bundle은 “무거운 완성본”입니다. 내부에 `node_modules/tiny-yeah` 준비본을 가지고 있어서
설치 중 `npm install`을 다시 하지 않습니다.

### Windows PC에 필요한 프로그램

Windows PC에서 PowerShell 7을 열고 아래 명령을 실행합니다.

```powershell
node --version
pwsh --version
```

정상 조건은 다음과 같습니다.

- `node --version`이 `v22.5.0` 이상이어야 합니다.
- `pwsh --version`이 `7.x.x` 이상이어야 합니다.

Node.js가 없거나 버전이 낮으면 Node.js 22 이상을 설치해야 합니다. PowerShell이
`Windows PowerShell`로만 표시되거나 `pwsh` 명령이 없으면 PowerShell 7을 설치해야 합니다.

## 설치할 프로젝트 위치 정하기

Tiny-Yeah는 OpenCode 프로젝트 폴더 안의 `.opencode/`에 설치됩니다. 예를 들어 OpenCode로
사용할 프로젝트가 아래 경로라면:

```text
C:\Users\me\Projects\my-opencode-project
```

이 경로를 설치 대상(`-TargetProject`)으로 사용합니다.

설치 대상 폴더가 아직 없다면 먼저 만듭니다.

```powershell
mkdir C:\Users\me\Projects\my-opencode-project
```

## 방법 A: 저장소를 받은 뒤 바로 설치하기

GitHub에서 Tiny-Yeah 저장소를 ZIP으로 받았다면 먼저 압축을 풉니다. 예시는 `Downloads` 아래에
풀린 경우입니다.

```powershell
cd $env:USERPROFILE\Downloads\Tiny-Yeah
```

`git clone`으로 받았다면 clone한 폴더로 이동합니다.

```powershell
cd C:\Users\me\Projects\Tiny-Yeah
```

폴더 안에 아래 파일이 보이면 맞는 위치입니다.

```text
install-from-repo.ps1
bin\tiny-yeah.js
release\tiny-yeah-offline-v1.0.0.tar.gz
```

먼저 실제 파일을 쓰지 않는 시험 실행을 합니다.

```powershell
pwsh .\install-from-repo.ps1 -TargetProject C:\Users\me\Projects\my-opencode-project -DryRun -Yes
```

정상이라면 “plan computed, no files written”처럼 실제 파일을 쓰지 않았다는 메시지가 나옵니다.

문제가 없으면 설치를 실행합니다.

```powershell
pwsh .\install-from-repo.ps1 -TargetProject C:\Users\me\Projects\my-opencode-project -Yes
```

`install-from-repo.ps1`은 저장소 안의 `release\tiny-yeah-offline-v1.0.0.tar.gz`를 자동으로
찾아서 사용합니다. 다른 bundle 파일을 직접 지정해야 할 때만 `-Bundle`을 붙입니다.

```powershell
pwsh .\install-from-repo.ps1 -Bundle .\release\tiny-yeah-offline-v1.0.0.tar.gz -TargetProject C:\Users\me\Projects\my-opencode-project -Yes
```

## 방법 B: bundle 파일만 받은 경우

`tiny-yeah-offline-v1.0.0.tar.gz` 파일을 원하는 위치에 둡니다. 예시는 `Downloads`에 둔 경우입니다.

```powershell
cd $env:USERPROFILE\Downloads
tar -xzf .\tiny-yeah-offline-v1.0.0.tar.gz
cd .\tiny-yeah-offline-v1.0.0
```

압축을 푼 폴더 안에 아래 파일과 폴더가 있어야 합니다.

```text
install-offline.ps1
bin\tiny-yeah.js
manifest.json
node_modules\tiny-yeah
templates\opencode
vendor
```

`node_modules\tiny-yeah`가 있으면 standalone 설치가 가능한 bundle입니다.

### 먼저 시험 실행하기

실제 파일을 쓰기 전에 아래 명령으로 설치 계획만 확인할 수 있습니다.

```powershell
pwsh .\install-offline.ps1 -TargetProject C:\Users\me\Projects\my-opencode-project -DryRun -Yes
```

정상이라면 “plan computed, no files written”처럼 실제 파일을 쓰지 않았다는 메시지가 나옵니다.

### 설치 실행하기

문제가 없으면 아래 명령을 실행합니다.

```powershell
pwsh .\install-offline.ps1 -TargetProject C:\Users\me\Projects\my-opencode-project -Yes
```

정상 설치 결과에는 `installed` 또는 “installed”가 포함됩니다. 설치 후 대상 프로젝트 안에는
아래 파일들이 만들어집니다.

```text
C:\Users\me\Projects\my-opencode-project\.opencode\package.json
C:\Users\me\Projects\my-opencode-project\.opencode\plugins\tiny-yeah.ts
C:\Users\me\Projects\my-opencode-project\.opencode\tui.json
C:\Users\me\Projects\my-opencode-project\.opencode\node_modules\tiny-yeah
C:\Users\me\Projects\my-opencode-project\.opencode\.tiny-yeah-install.json
```

`node_modules\tiny-yeah` 폴더가 만들어졌다면 이 설치는 대상 프로젝트에서 `npm install`을 다시
실행하지 않은 standalone 설치입니다.

## 설치 확인하기

설치가 끝나면 Tiny-Yeah 저장소 루트 또는 압축을 푼 bundle 폴더에서 아래 명령을 실행합니다.

```powershell
node .\bin\tiny-yeah.js doctor --project C:\Users\me\Projects\my-opencode-project --json
```

정상 설치라면 JSON 출력 안에 아래 내용이 보입니다.

```json
{
  "command": "doctor",
  "schemaVersion": "tiny-yeah.doctor.v1"
}
```

`summary.overall`은 `healthy` 또는 `degraded`일 수 있습니다. `opencode` 명령이 아직 PATH에
없으면 `degraded`가 나올 수 있지만, `exports-smoke-import` check가 `pass`이면 Tiny-Yeah
package 자체는 정상적으로 설치된 것입니다.

## 이미 설치된 경우

같은 버전이 이미 설치되어 있으면 다시 실행해도 `noop` 또는 “already at version”으로 끝날 수
있습니다. 이것은 정상입니다.

다시 덮어써야 할 때만 `-Force`를 붙입니다.

```powershell
pwsh .\install-offline.ps1 -TargetProject C:\Users\me\Projects\my-opencode-project -Force -Yes
```

`-Force`는 기존 관리 파일을 백업한 뒤 교체합니다.

## 자주 나는 문제

### `pwsh` 명령을 찾을 수 없음

PowerShell 7이 설치되어 있지 않거나 PATH에 없습니다. PowerShell 7을 설치한 뒤 새 터미널을 열어
다시 실행합니다.

```powershell
pwsh --version
```

### Node 버전이 낮음

Tiny-Yeah는 Node.js 22.5 이상이 필요합니다.

```powershell
node --version
```

`v22.5.0`보다 낮으면 Node.js 22 이상을 설치한 뒤 다시 실행합니다.

### `bin\tiny-yeah.js not found`

명령을 실행한 위치가 Tiny-Yeah 저장소 루트 또는 압축을 푼 bundle 폴더가 아닙니다.
저장소 방식이면 `install-from-repo.ps1`이 있는 폴더로, bundle 방식이면 `install-offline.ps1`이
있는 폴더로 이동한 뒤 다시 실행합니다.

```powershell
cd C:\Users\me\Projects\Tiny-Yeah
pwsh .\install-from-repo.ps1 -TargetProject C:\Users\me\Projects\my-opencode-project -Yes

# 또는 bundle 방식
cd .\tiny-yeah-offline-v1.0.0
pwsh .\install-offline.ps1 -TargetProject C:\Users\me\Projects\my-opencode-project -Yes
```

### `release` 폴더 또는 offline bundle을 찾을 수 없음

저장소 ZIP을 받을 때 `release\tiny-yeah-offline-v1.0.0.tar.gz`가 빠졌거나, release 파일이 없는
브랜치를 받은 상태입니다. Tiny-Yeah 저장소 루트에서 아래 파일이 있는지 확인합니다.

```powershell
dir .\release\tiny-yeah-offline-v*.tar.gz
```

파일이 없다면 완성된 offline bundle이 포함된 저장소 또는 release 파일을 다시 받아야 합니다.

### `node_modules\tiny-yeah`가 없음

그 bundle은 완성형 standalone bundle이 아닙니다. 이 경우 설치가 `npm install --offline` 경로로
넘어갈 수 있고, Windows PC의 npm 상태에 따라 실패할 수 있습니다. `airGapComplete: true`로
검증된 bundle을 다시 받아야 합니다.

### 권한 문제로 설치 실패

대상 프로젝트가 관리자 권한이 필요한 위치에 있거나 백신/Defender가 파일을 잠그고 있을 수
있습니다. 사용자 폴더 아래의 프로젝트 위치를 사용하고, 잠시 뒤 다시 실행합니다.

## 설치 파일을 만드는 사람을 위한 확인 명령

설치 파일을 배포하기 전에 만든 사람은 아래 명령으로 bundle을 검증합니다.

```bash
npm run release:offline
npm run verify:offline -- --bundle release/tiny-yeah-offline-v1.0.0.tar.gz
```

정상 출력에는 아래 값이 포함되어야 합니다.

```json
{
  "airGapComplete": true,
  "standaloneInstall": {
    "available": true,
    "kind": "installed"
  },
  "offlineInstallOk": true
}
```

이 값이 확인된 bundle만 Windows 사용자에게 전달합니다.
