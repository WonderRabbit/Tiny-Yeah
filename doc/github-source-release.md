# Tiny-Yeah GitHub 소스코드 Release 절차

이 문서는 `WonderRabbit/Tiny-Yeah` 저장소의 소스코드를 GitHub Release로 배포하는 절차를
정리한다. 목표는 사용자가 GitHub의 `Source code (zip)` / `Source code (tar.gz)` 아카이브를
신뢰할 수 있게 내려받고, 필요한 경우 Tiny-Yeah 전용 offline bundle도 같은 릴리스에 첨부할 수
있게 만드는 것이다.

> 기준일: 2026-06-26. GitHub UI와 `gh` CLI 옵션은 바뀔 수 있으므로 릴리스 직전에는 아래
> "공식 참고 문서" 링크를 다시 확인한다.

## 핵심 결론

GitHub에서 "소스코드를 release"한다는 말은 보통 다음 두 가지를 포함한다.

1. Git tag를 특정 commit에 고정한다.
2. 그 tag로 GitHub Release를 만든다.

GitHub는 Release마다 `Source code (zip)`과 `Source code (tar.gz)`를 자동으로 제공한다. 따라서
Tiny-Yeah의 순수 소스 배포는 별도 zip을 직접 만들지 않고 tag와 Release를 올바르게 만드는 것이
기본이다.

Tiny-Yeah는 여기에 더해 `npm run release:offline`으로 생성하는
`release/tiny-yeah-offline-v<version>.tar.gz`를 Release asset으로 첨부할 수 있다. 이 파일은
GitHub 자동 소스 아카이브가 아니라 Tiny-Yeah의 설치/검증용 배포물이다.

## 배포 산출물 구분

| 산출물 | 생성 주체 | 용도 | 검증 기준 |
| --- | --- | --- | --- |
| Git tag `vX.Y.Z` | 배포자 | 어떤 commit을 릴리스할지 고정 | `git rev-parse vX.Y.Z`와 `git ls-remote --tags origin vX.Y.Z`가 같은 commit |
| GitHub Release | GitHub + 배포자 | tag, 릴리스 노트, assets를 사용자에게 공개 | `gh release view vX.Y.Z --json ...` 또는 GitHub Releases 화면 |
| `Source code (zip)` | GitHub 자동 생성 | tag 시점의 저장소 snapshot | 다운로드 후 파일 목록/commit 대응 확인 |
| `Source code (tar.gz)` | GitHub 자동 생성 | tag 시점의 저장소 snapshot | 다운로드 후 파일 목록/commit 대응 확인 |
| `release/tiny-yeah-offline-vX.Y.Z.tar.gz` | Tiny-Yeah release script | air-gapped / Windows standalone 설치 번들 | `npm run verify:offline -- --bundle ...` |
| `release/SHA256SUMS` | Tiny-Yeah release script 또는 배포자 | 첨부 asset 무결성 확인 | `shasum -a 256 -c release/SHA256SUMS` |

주의할 점:

- GitHub 자동 source archive는 저장소 전체 history를 담지 않는다. history까지 필요한 사용자는
  `git clone`을 사용해야 한다.
- branch/tag 이름은 이동할 수 있다. 재현성을 강하게 요구하면 릴리스 tag를 절대 다시 쓰지 말고,
  문서와 검증 로그에 commit SHA를 함께 남긴다.
- GitHub source archive의 압축 byte layout은 시간이 지나며 달라질 수 있다. 파일 내용 검증은
  압축 파일 자체 hash보다 tag commit과 추출된 파일 내용을 기준으로 본다.
- Git LFS를 쓰는 저장소라면 source archive에 실제 LFS 객체를 넣을지 repository settings에서
  관리해야 한다. 기본값은 pointer만 포함되는 쪽으로 이해하고, Tiny-Yeah가 LFS를 쓰게 되면
  릴리스 전에 별도 검증을 추가한다.

## 권한과 도구

필수 권한:

- GitHub 저장소에 push 권한이 있어야 tag를 올릴 수 있다.
- GitHub Release를 만들려면 repository write 권한이 필요하다.
- API나 GitHub Actions로 Release를 만들 때는 최소 `contents: write` 권한을 부여한다. workflow가
  workflow 파일 자체를 변경하거나 특정 API 정책이 필요한 경우 `workflows: write`가 추가로 필요할
  수 있다.

권장 도구:

```bash
git --version
gh --version
node --version
npm --version
```

Tiny-Yeah 기준 런타임:

- Node `>=22.5.0`
- ESM / NodeNext
- release script: `npm run release:offline`, `npm run verify:offline`
- 원격 저장소 예시: `git@github.com:WonderRabbit/Tiny-Yeah.git`

## 버전 규칙

Tiny-Yeah는 `package.json`의 `version`을 기준으로 release tag를 만든다.

예를 들어 `package.json`이 다음과 같다면:

```json
{
  "name": "tiny-yeah",
  "version": "1.0.0"
}
```

release tag는 다음처럼 잡는다.

```bash
VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"
echo "$TAG"
```

권장 규칙:

- 정식 배포: `v1.0.0`, `v1.1.0`, `v2.0.0`
- 사전 배포: `v1.1.0-rc.1`, `v1.1.0-beta.1`
- tag는 한 번 공개하면 다시 만들지 않는다. 잘못 올렸다면 새 patch 버전을 만든다.
- GitHub Release의 title은 `Tiny-Yeah v1.0.0`처럼 프로젝트명과 tag를 모두 넣는다.

## 릴리스 전 준비

항상 `Tiny-Yeah/` 안에서 실행한다.

```bash
cd /Users/oneyoon/Workspace/Personal/Tiny-Yeah
```

### 1. 현재 branch와 원격 확인

```bash
git status --short --branch --untracked-files=all
git remote -v
git branch --show-current
git fetch origin --tags
```

확인 기준:

- 배포하려는 branch가 맞다. 보통 `main`.
- `origin`이 `git@github.com:WonderRabbit/Tiny-Yeah.git` 또는 의도한 HTTPS URL이다.
- 작업 중인 변경이 릴리스에 포함될 변경인지 확인한다.
- 릴리스 대상 변경은 모두 commit되어 있어야 한다.

작업 트리가 더럽다면 먼저 분류한다.

```bash
git diff --stat
git diff --name-only
git status --short --untracked-files=all
```

분류 기준:

- 릴리스에 포함할 변경: commit한다.
- 로컬 실험 파일: release 전에 치우거나 `.gitignore`에 맞게 관리한다.
- 다른 작업자가 만든 변경: 임의로 되돌리지 않는다.

### 2. 릴리스 commit 결정

현재 `HEAD`를 릴리스하려면:

```bash
RELEASE_SHA="$(git rev-parse HEAD)"
git show --stat --oneline "$RELEASE_SHA"
```

특정 commit을 릴리스하려면:

```bash
RELEASE_SHA="<commit-sha>"
git show --stat --oneline "$RELEASE_SHA"
```

이 SHA가 GitHub에 올라가 있어야 한다.

```bash
git branch --contains "$RELEASE_SHA"
git ls-remote origin "$RELEASE_SHA"
```

`git ls-remote origin "$RELEASE_SHA"`가 비어도 branch tip으로 이미 올라간 commit일 수 있으므로,
보통은 아래처럼 branch와 비교한다.

```bash
git fetch origin main
git merge-base --is-ancestor "$RELEASE_SHA" origin/main
```

exit code가 `0`이면 `origin/main`에 포함된 commit이다.

### 3. 품질 검증

Tiny-Yeah 기준 완료 검증은 다음 명령을 기본으로 한다.

```bash
npm run check
```

`npm run check`는 현재 `package.json` 기준으로 다음을 포함한다.

- `npm run lint`
- `npm run naming:check`
- `npm run typecheck`
- `npm run test`
- `npm run build`

릴리스용 offline bundle까지 첨부할 계획이면 다음도 실행한다.

```bash
npm run release:offline
npm run verify:offline -- --bundle "release/tiny-yeah-offline-v${VERSION}.tar.gz"
```

`verify:offline` 결과가 실패하면 GitHub Release를 만들지 않는다. source archive만 배포할 수는
있지만, 그 경우 Release notes에 "offline bundle은 이번 릴리스에 포함하지 않음"을 명확히 적는다.

### 4. 릴리스 노트 초안 작성

권장 위치:

```bash
mkdir -p release-notes
$EDITOR "release-notes/${TAG}.md"
```

권장 구조:

```markdown
# Tiny-Yeah v1.0.0

## 요약

- 이번 릴리스의 가장 중요한 변경 2-4개.

## 사용자 영향

- 설치 방식, CLI, OpenCode plugin, TUI surface에 미치는 영향.

## 검증

- npm run check
- npm run release:offline
- npm run verify:offline -- --bundle release/tiny-yeah-offline-v1.0.0.tar.gz

## 다운로드

- Source code (zip)
- Source code (tar.gz)
- tiny-yeah-offline-v1.0.0.tar.gz
- SHA256SUMS

## 알려진 제한

- Windows / PowerShell / air-gapped 환경에서 아직 직접 확인하지 못한 항목이 있다면 여기에 쓴다.
```

GitHub의 자동 생성 release notes를 쓸 수도 있지만, Tiny-Yeah는 offline bundle 검증 결과와
Windows/PowerShell 제한을 명시해야 하므로 자동 생성 결과를 그대로 게시하지 말고 반드시 사람이
검토한다.

## 방법 A: GitHub 웹 UI로 Release 만들기

브라우저 절차는 처음 배포하거나 draft를 꼼꼼히 확인할 때 가장 안전하다.

### 1. tag 만들기 전 최종 확인

```bash
git fetch origin --tags
git status --short --branch --untracked-files=all
npm run check
```

offline bundle을 첨부한다면:

```bash
VERSION="$(node -p "require('./package.json').version")"
npm run release:offline
npm run verify:offline -- --bundle "release/tiny-yeah-offline-v${VERSION}.tar.gz"
```

### 2. tag 생성과 push

annotated tag를 권장한다. tag message는 나중에 감사할 때 유용하다.

```bash
VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"
RELEASE_SHA="$(git rev-parse HEAD)"

git tag -a "$TAG" "$RELEASE_SHA" -m "Tiny-Yeah ${TAG}"
git push origin "$TAG"
```

이미 tag가 존재하면 중단한다.

```bash
git ls-remote --tags origin "$TAG"
```

tag가 잘못된 commit을 가리키면 공개 전이라도 원인을 확인한다. 이미 공개한 tag를 강제로
덮어쓰는 방식은 사용자의 재현성을 깨뜨리므로 피한다.

### 3. GitHub Release draft 작성

1. GitHub에서 `WonderRabbit/Tiny-Yeah` 저장소로 이동한다.
2. 오른쪽의 `Releases`를 누른다.
3. `Draft a new release`를 누른다.
4. `Choose a tag`에서 방금 push한 `vX.Y.Z`를 선택한다.
5. `Release title`에 `Tiny-Yeah vX.Y.Z`를 입력한다.
6. 설명 칸에 `release-notes/vX.Y.Z.md` 내용을 붙여넣는다.
7. 이번 배포가 실험용이면 `Set as a pre-release`를 체크한다.
8. 정식 최신 릴리스로 공개할 배포라면 `Set as latest release`를 선택한다. 선택하지 않으면
   GitHub가 semantic versioning과 날짜를 기준으로 latest 표시를 자동 판단할 수 있다.
9. offline bundle을 첨부할 경우 `Attach binaries` 영역에 다음 파일을 올린다.
   - `release/tiny-yeah-offline-vX.Y.Z.tar.gz`
   - `release/SHA256SUMS`
10. 먼저 `Save draft`를 누르고, 다운로드/노트/asset 이름을 확인한다.
11. 문제가 없으면 `Publish release`를 누른다.

GitHub Release가 publish되면 `Assets` 아래에 GitHub가 자동 생성한 다음 항목이 보여야 한다.

- `Source code (zip)`
- `Source code (tar.gz)`

이 두 항목이 Tiny-Yeah 소스코드 배포의 핵심 산출물이다.

## 방법 B: `gh` CLI로 Release 만들기

반복 가능한 배포에는 `gh release create`가 편하다.

### 1. 로그인과 권한 확인

```bash
gh auth status
gh repo view WonderRabbit/Tiny-Yeah --json nameWithOwner,defaultBranchRef
```

실패하면 먼저 GitHub CLI 인증을 고친다.

```bash
gh auth login
```

### 2. tag 생성과 push

```bash
cd /Users/oneyoon/Workspace/Personal/Tiny-Yeah

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"
RELEASE_SHA="$(git rev-parse HEAD)"

git fetch origin --tags
git tag -a "$TAG" "$RELEASE_SHA" -m "Tiny-Yeah ${TAG}"
git push origin "$TAG"
```

### 3. source-only Release 생성

source archive만 공개하려면 asset 없이 release를 만든다.

```bash
gh release create "$TAG" \
  --repo WonderRabbit/Tiny-Yeah \
  --verify-tag \
  --title "Tiny-Yeah ${TAG}" \
  --notes-file "release-notes/${TAG}.md"
```

`--verify-tag`는 remote에 tag가 없으면 release 생성을 중단한다. source release에서는 tag가 기준점이므로
이 옵션을 기본으로 둔다.

### 4. offline bundle 포함 Release 생성

```bash
VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"
BUNDLE="release/tiny-yeah-offline-v${VERSION}.tar.gz"

npm run release:offline
npm run verify:offline -- --bundle "$BUNDLE"

gh release create "$TAG" \
  "$BUNDLE" \
  release/SHA256SUMS \
  --repo WonderRabbit/Tiny-Yeah \
  --verify-tag \
  --title "Tiny-Yeah ${TAG}" \
  --notes-file "release-notes/${TAG}.md"
```

### 5. 자동 release notes 사용

GitHub 자동 생성 notes를 쓰려면:

```bash
gh release create "$TAG" \
  --repo WonderRabbit/Tiny-Yeah \
  --verify-tag \
  --title "Tiny-Yeah ${TAG}" \
  --generate-notes
```

다만 Tiny-Yeah는 release 검증 결과와 offline bundle 상태를 명시해야 하므로 자동 notes를 그대로
게시하지 않는 편이 낫다. 자동 notes를 초안으로 쓰고, 다음 정보를 사람이 추가한다.

- `npm run check` 성공 여부
- `npm run release:offline` 성공 여부
- `npm run verify:offline -- --bundle ...` 성공 여부
- `airGapComplete` 상태
- Windows/PowerShell에서 확인한 범위

## 방법 C: GitHub Actions로 자동 Release 만들기

수동 배포가 안정화된 뒤에만 자동화를 추가한다. 초기에는 브라우저 또는 `gh` CLI로 먼저 성공 경로를
검증한다.

권장 workflow trigger:

```yaml
name: release

on:
  push:
    tags:
      - "v*"

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "22.5.0"
          cache: npm

      - run: npm ci
      - run: npm run check
      - run: npm run release:offline

      - name: Resolve version and bundle
        id: release
        shell: bash
        run: |
          VERSION="$(node -p "require('./package.json').version")"
          echo "version=${VERSION}" >> "$GITHUB_OUTPUT"
          echo "bundle=release/tiny-yeah-offline-v${VERSION}.tar.gz" >> "$GITHUB_OUTPUT"

      - run: npm run verify:offline -- --bundle "${{ steps.release.outputs.bundle }}"

      - name: Create GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release create "${GITHUB_REF_NAME}" \
            "${{ steps.release.outputs.bundle }}" \
            release/SHA256SUMS \
            --repo "${GITHUB_REPOSITORY}" \
            --verify-tag \
            --title "Tiny-Yeah ${GITHUB_REF_NAME}" \
            --generate-notes
```

자동화 시 주의:

- `permissions: contents: write`를 명시한다.
- tag push가 trigger이므로 workflow 내부에서 tag를 새로 만들지 않는다.
- release notes를 완전 자동화하면 Tiny-Yeah의 수동 검증 메모가 빠질 수 있다. 처음에는 draft
  release를 만들거나 수동 notes file을 함께 관리한다.
- workflow 파일을 새로 추가하는 작업은 source release 절차와 분리해서 별도 PR/commit으로 검증한다.

## Release 검증

Release를 publish한 뒤에는 반드시 실제 GitHub surface를 확인한다.

### 1. Release 메타데이터 확인

```bash
gh release view "$TAG" \
  --repo WonderRabbit/Tiny-Yeah \
  --json tagName,name,isDraft,isPrerelease,isLatest,url,createdAt,publishedAt,assets
```

확인 기준:

- `tagName`이 `vX.Y.Z`이다.
- `isDraft`가 `false`이다.
- 정식 배포라면 `isPrerelease`가 `false`이다.
- title이 `Tiny-Yeah vX.Y.Z`이다.
- 첨부 asset 이름이 의도와 같다.

### 2. tag commit 확인

```bash
REMOTE_TAG_SHA="$(git ls-remote --tags origin "refs/tags/${TAG}" | awk '{print $1}')"
LOCAL_TAG_SHA="$(git rev-list -n 1 "$TAG")"

echo "remote=${REMOTE_TAG_SHA}"
echo "local=${LOCAL_TAG_SHA}"
test "$REMOTE_TAG_SHA" = "$LOCAL_TAG_SHA"
```

annotated tag의 경우 `refs/tags/${TAG}`가 tag object를 가리킬 수 있다. commit SHA를 확실히 보려면
다음도 확인한다.

```bash
git ls-remote --tags origin "refs/tags/${TAG}^{}"
git rev-list -n 1 "$TAG"
```

### 3. source archive 다운로드 검증

GitHub source archive URL 형식:

```bash
OWNER="WonderRabbit"
REPO="Tiny-Yeah"

curl -L -o "/tmp/${REPO}-${TAG}.zip" \
  "https://github.com/${OWNER}/${REPO}/archive/refs/tags/${TAG}.zip"

curl -L -o "/tmp/${REPO}-${TAG}.tar.gz" \
  "https://github.com/${OWNER}/${REPO}/archive/refs/tags/${TAG}.tar.gz"
```

압축을 풀고 핵심 파일이 있는지 확인한다.

```bash
TMP="$(mktemp -d)"
unzip -q "/tmp/${REPO}-${TAG}.zip" -d "$TMP/zip"
tar -xzf "/tmp/${REPO}-${TAG}.tar.gz" -C "$TMP"

find "$TMP" -maxdepth 3 -type f \( \
  -name package.json -o \
  -name README.md -o \
  -name AGENTS.md -o \
  -name install-offline.ps1 \
\) | sort
```

source archive에는 최소 다음 파일이 있어야 한다.

- `package.json`
- `README.md`
- `AGENTS.md`
- `src/`
- `scripts/release/`
- `install-offline.ps1`
- `LICENSE`

### 4. offline bundle asset 검증

Release asset을 내려받아 검증한다.

```bash
gh release download "$TAG" \
  --repo WonderRabbit/Tiny-Yeah \
  --pattern "tiny-yeah-offline-v${VERSION}.tar.gz" \
  --pattern "SHA256SUMS" \
  --dir "/tmp/tiny-yeah-${TAG}-release"

cd /Users/oneyoon/Workspace/Personal/Tiny-Yeah
npm run verify:offline -- --bundle "/tmp/tiny-yeah-${TAG}-release/tiny-yeah-offline-v${VERSION}.tar.gz"
```

`SHA256SUMS`를 함께 제공했다면:

```bash
cd "/tmp/tiny-yeah-${TAG}-release"
shasum -a 256 -c SHA256SUMS
```

### 5. 사용자 설치 관점 확인

source archive 사용자는 다음 중 하나를 한다.

```bash
git clone --branch "$TAG" --depth 1 https://github.com/WonderRabbit/Tiny-Yeah.git
```

또는 GitHub Release 화면에서 `Source code (zip)` / `Source code (tar.gz)`를 내려받는다.

offline bundle 사용자는 Release asset을 내려받은 뒤 Windows PowerShell 7+에서 다음 흐름을 따른다.

```powershell
pwsh ./install-offline.ps1 -TargetProject C:\path\to\opencode-project -Yes
```

릴리스 노트에 이 두 경로를 분리해서 적는다.

## 체크리스트

릴리스 전:

- [ ] `cd /Users/oneyoon/Workspace/Personal/Tiny-Yeah`
- [ ] `git status --short --branch --untracked-files=all`로 작업 트리 확인
- [ ] 릴리스 대상 변경이 모두 commit됨
- [ ] `git fetch origin --tags`
- [ ] `package.json`의 `version` 확인
- [ ] `npm run check` 통과
- [ ] offline bundle을 첨부한다면 `npm run release:offline` 통과
- [ ] offline bundle을 첨부한다면 `npm run verify:offline -- --bundle ...` 통과
- [ ] `release-notes/vX.Y.Z.md` 작성
- [ ] 기존 tag와 충돌하지 않음: `git ls-remote --tags origin vX.Y.Z`

릴리스 생성:

- [ ] annotated tag 생성: `git tag -a vX.Y.Z <sha> -m "Tiny-Yeah vX.Y.Z"`
- [ ] tag push: `git push origin vX.Y.Z`
- [ ] GitHub Release 생성
- [ ] title: `Tiny-Yeah vX.Y.Z`
- [ ] notes에 검증 결과 포함
- [ ] 정식 배포와 prerelease 여부 확인
- [ ] offline bundle과 `SHA256SUMS` 첨부 여부 확인
- [ ] `Source code (zip)` / `Source code (tar.gz)` 자동 노출 확인

릴리스 후:

- [ ] `gh release view vX.Y.Z --repo WonderRabbit/Tiny-Yeah --json ...` 확인
- [ ] tag가 의도한 commit을 가리키는지 확인
- [ ] source archive 다운로드 및 압축 해제 smoke 확인
- [ ] offline bundle asset 다운로드 및 `verify:offline` 재검증
- [ ] release URL을 README, 공지, 설치 문서 등에 공유

## 실패와 복구

### tag를 잘못된 commit에 만들었다

아직 push하지 않았다면:

```bash
git tag -d "$TAG"
git tag -a "$TAG" "$CORRECT_SHA" -m "Tiny-Yeah ${TAG}"
```

이미 push했지만 Release를 publish하지 않았다면, 팀 정책에 따라 tag 삭제 후 재생성할 수 있다.
단, 공개 저장소에서는 tag rewrite가 사용자 재현성을 깨뜨릴 수 있으므로 가능하면 새 patch version을
만든다.

이미 Release가 publish되었다면:

1. 잘못된 Release notes에 문제를 명시한다.
2. 필요한 경우 Release를 `pre-release`로 바꾸거나 삭제한다.
3. 새 version을 올린다. 예: `v1.0.1`.

### `gh release create`가 tag를 찾지 못한다

```bash
git ls-remote --tags origin "$TAG"
git push origin "$TAG"
gh release create "$TAG" --repo WonderRabbit/Tiny-Yeah --verify-tag ...
```

`--verify-tag`는 remote tag가 없으면 실패하는 것이 정상이다.

### Release는 됐지만 source archive 내용이 예상과 다르다

원인은 보통 tag가 잘못된 commit을 가리키는 것이다.

```bash
git rev-list -n 1 "$TAG"
git show --stat --oneline "$TAG"
gh release view "$TAG" --repo WonderRabbit/Tiny-Yeah --json tagName,targetCommitish
```

GitHub 자동 source archive는 tag가 가리키는 저장소 snapshot이다. Release asset을 잘못 첨부한
문제와 source archive 문제를 분리해서 본다.

### offline bundle 검증이 실패한다

다음 순서로 본다.

```bash
npm run build
npm run release:offline
npm run verify:offline -- --bundle "release/tiny-yeah-offline-v${VERSION}.tar.gz"
```

실패 원인을 release notes에 숨기지 않는다. bundle을 첨부하지 않고 source-only Release를 할 수는
있지만, 그 경우 사용자는 source archive에서 직접 build해야 한다.

### SSH push가 실패한다

```bash
ssh -T git@github.com
gh auth status
```

SSH key 문제가 있으면 GitHub CLI 인증으로 HTTPS push를 설정할 수 있다.

```bash
gh auth setup-git
git remote set-url origin https://github.com/WonderRabbit/Tiny-Yeah.git
git push origin "$TAG"
```

원격 URL을 바꾸는 것은 저장소 정책에 영향을 줄 수 있으므로, 팀에서 SSH를 표준으로 쓰면 원인을
해결한 뒤 다시 SSH URL로 되돌린다.

### `latest` 표시가 예상과 다르다

GitHub는 release의 날짜와 semantic versioning을 기준으로 latest를 자동 판단할 수 있다. CLI에서는
필요할 때 다음 옵션을 사용한다.

```bash
gh release create "$TAG" --latest
gh release create "$TAG" --latest=false
```

정식 배포가 아니면 `--prerelease`를 붙이고 latest로 지정하지 않는다.

## Release notes에 넣을 문구 예시

```markdown
# Tiny-Yeah v1.0.0

Tiny-Yeah v1.0.0 source release입니다.

## 다운로드

- GitHub 자동 source archive: `Source code (zip)`, `Source code (tar.gz)`
- Offline bundle: `tiny-yeah-offline-v1.0.0.tar.gz`
- Checksum: `SHA256SUMS`

## 검증

- `npm run check`
- `npm run release:offline`
- `npm run verify:offline -- --bundle release/tiny-yeah-offline-v1.0.0.tar.gz`

## 설치 메모

source archive 사용자는 Node >=22.5.0 환경에서 `npm install` 후 `npm run check`로 확인하세요.
offline bundle 사용자는 PowerShell 7+에서 `install-offline.ps1`을 사용하세요.
```

## 공식 참고 문서

- GitHub Docs: Managing releases in a repository  
  https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository
- GitHub Docs: About releases  
  https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases
- GitHub Docs: Downloading source code archives  
  https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives
- GitHub Docs: Automatically generated release notes  
  https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes
- GitHub Docs: REST API endpoints for releases  
  https://docs.github.com/en/rest/releases/releases?apiVersion=2022-11-28
- GitHub CLI manual: `gh release create`  
  https://cli.github.com/manual/gh_release_create
- GitHub Docs: Managing Git LFS objects in archives  
  https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-git-lfs-objects-in-archives-of-your-repository
- GitHub Docs: Use `GITHUB_TOKEN` for authentication in workflows  
  https://docs.github.com/en/actions/tutorials/authenticate-with-github_token
