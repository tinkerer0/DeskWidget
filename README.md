# DeskWidget

Windows 바탕화면에 사용자의 PNG, GIF, WebP, JPG 이미지를 투명 위젯으로 띄우는 작은 Electron 앱이다. 이미지 하나당 창 하나를 만들며 드래그 이동, 휠 크기 조절, 위젯끼리의 앞뒤 순서와 위치 저장을 지원한다.

> 현재 배포 모델은 **압축을 풀어 사용하는 Windows portable 앱**이다. Microsoft Store/MSIX용 패키지는 아직 지원하지 않는다.

## 사용법

압축을 풀면 최상위에 정확히 네 가지만 보인다.

```
DeskWidget 실행.exe          ← 이것만 더블클릭하면 된다
사진을 넣으면 위젯이 됩니다/   ← 여기에 이미지를 넣는다
사용 설명서.html              ← 자세한 사용법(로컬 단일 파일)
안 보셔도 됩니다/             ← Electron 런타임 등 내부 파일(직접 열 필요 없음)
```

1. **`사진을 넣으면 위젯이 됩니다`** 폴더에 이미지(PNG/GIF/WebP/JPG)를 넣는다. 압축 해제 직후에는 예시로 공룡 이미지 1개가 이미 들어 있다.
2. **`DeskWidget 실행.exe`**를 더블클릭한다. 이 파일은 내부의 실제 실행 파일(`안 보셔도 됩니다\DeskWidget.exe`)을 상대 경로로 찾아 실행하는 아주 작은 Windows GUI 런처이며, 관리자 권한이나 네트워크를 쓰지 않는다. 내부 파일을 찾지 못하면 한국어 오류 안내를 띄우고 안전하게 종료한다.
3. 위젯을 좌클릭한 채 끌어서 옮긴다. 크기는 마우스 커서를 위젯 위에 올린 상태에서 휠을 위로 굴리면 커지고 아래로 굴리면 작아진다. 크기 조절 전에 클릭할 필요는 없으며, 바탕화면 빈 곳에서 굴린 휠에는 반응하지 않는다.
4. 우클릭 메뉴에서 크기 초기화, 위젯끼리의 순서 변경, 새로고침과 종료를 사용할 수 있다.

자세한 단계별 설명은 `사용 설명서.html`(오프라인 단일 파일)을 참고한다. 종료 단축키는 `Ctrl+Alt+Q`다. 부팅 시 시작은 기본적으로 꺼져 있으며, 트레이 메뉴에서 사용자가 직접 켤 수 있다.

## 동작과 로컬 데이터

- 배포 앱의 이미지 폴더: 배포 최상위의 `사진을 넣으면 위젯이 됩니다` (내부 exe 옆이 아니다)
- 개발 실행의 이미지 폴더: `%APPDATA%\DeskWidget\development\사진을 넣으면 위젯이 됩니다`
- 위치·크기·겹침 순서: `%APPDATA%\DeskWidget\widgets.json`
- 자동시작 선호: `%APPDATA%\DeskWidget\autostart.txt`

앱 소스에는 서버 통신, 계정, 광고, telemetry, LLM 또는 외부 API가 없다. 이미지와 설정은 로컬에서만 읽는다. 자세한 내용은 [PRIVACY.md](PRIVACY.md)를 참고한다.

## 입력 안전 제한

다운로드한 이미지도 입력될 수 있으므로 렌더링 전에 파일 헤더와 크기를 검사한다.

- 지원 형식: PNG, GIF, WebP, JPEG
- 파일 하나당 최대 50 MiB
- 원본 한 축 최대 16,384 px
- 원본 총 픽셀 최대 64,000,000
- 위젯 창 한 축 최대 1,400 px
- 동시에 읽는 이미지 최대 100개
- regular file만 허용하며 symlink와 폴더는 제외

형식이 손상됐거나 제한을 넘은 이미지는 표시하지 않는다.

## 개발

필수 환경은 Node.js 22.12 이상이다. Electron과 Packager 버전은 `package.json`과 `package-lock.json`에 고정돼 있다.

```bash
npm ci
npm test
npm start
```

주요 명령:

```bash
npm run check            # JavaScript 구문 검사
npm test                 # 단위·보안 회귀 테스트
npm run package:verify   # Electron 앱 소스 allowlist만 검증
npm run package:win      # Windows x64 electron-packager 산출물만 생성(dist/DeskWidget-win32-x64)
npm run release:win      # 위 산출물 + 런처 + 사용 설명서 + 예시 이미지를 최종 배포 폴더로 조립·검증 (Windows 전용)
```

## 안전한 Windows 패키징

패키징은 두 단계로 분리돼 있고, 검증도 각 단계별로 따로 한다.

1. **Electron 앱 소스 staging** — [scripts/package.js](scripts/package.js)의 고정 allowlist(`APP_FILES`)에 있는 파일만 임시 staging 폴더에 복사한 뒤 `dist/DeskWidget-win32-x64`에 ASAR bundle을 만든다. `npm run package:verify`가 이 allowlist만 검증한다. `.gitignore`에만 의존하지 않으므로 개발용 이미지·`.env`·테스트·문서·코드서명 파일이 여기 들어갈 수 없다.
2. **최종 배포 폴더 조립** — [scripts/assemble-release.js](scripts/assemble-release.js)가 1번 산출물을 `안 보셔도 됩니다`로 옮기고, [launcher/launcher.cs](launcher/launcher.cs)를 Windows에 내장된 `csc.exe`(.NET Framework 컴파일러, 추가 설치 불필요)로 빌드해 `DeskWidget 실행.exe`를 만들고, 예시 이미지·`사용 설명서.html`·DeskWidget의 MIT/CC0 고지를 채운 뒤 [scripts/release-layout.js](scripts/release-layout.js)로 최상위가 정확히 4개 항목인지, 내부 runtime이 `안 보셔도 됩니다` 안에만 있는지, 개인/런타임 파일이 섞이지 않았는지 검사한다. 이 최종 layout 검증은 소스 allowlist 검증과 별개다.

런처(`launcher/launcher.cs`)는 `.lnk`/`.bat`/`.cmd`/`.vbs`가 아니라 C#으로 작성해 `csc.exe`(.NET Framework 컴파일러)로 컴파일한 작은 Windows GUI 실행 파일(managed PE)이며, 자기 자신의 위치를 기준으로 `안 보셔도 됩니다\DeskWidget.exe`만 상대 경로로 실행한다. 관리자 권한 상승, 네트워크, 셸 호출, 사용자 입력 기반 경로 조합이 없고, 내부 exe가 없으면 한국어 오류 메시지를 띄우고 종료한다. `scripts/build-launcher.js`는 지원 대상 Windows 빌드 환경(CI 러너 포함)에서 흔한 `csc.exe` 설치 경로를 검색해 사용하며, 찾지 못하면 새 도구를 임의로 설치하지 않고 빌드를 명확한 에러로 실패시킨다 — 항상 존재한다고 가정하지 않는다. 이 런처는 관리 코드(managed code)이므로 실행하려면 대상 Windows에 .NET Framework 런타임이 있어야 한다. Windows 10/11은 기본적으로 이를 포함하지만, 이는 최종 사용자 쪽 런타임 요구 사항이며 별도 설치가 필요한 환경도 있을 수 있다.

공개 binary를 만들 때는 다음이 추가로 필요하다.

1. clean checkout에서 `npm ci`와 `npm test`
2. Windows CI에서 `npm run release:win`
3. 조립된 배포 폴더에 allowlist 밖 파일과 사용자 이미지가 없는지 검사(위 최종 layout 검증이 자동 수행)
4. Authenticode 코드서명(런처와 내부 exe 모두)
5. SHA-256 checksum 생성
6. Windows Defender/SmartScreen과 clean Windows 계정에서 실행·재부팅·삭제 확인

> macOS 개발 머신에는 `csc.exe`가 없어 `DeskWidget 실행.exe`를 실제로 컴파일·실행할 수 없다. `npm run package:win`(electron-packager 산출물 생성)과 구조적 layout 검증(`test/release-layout.test.js`, PE MZ header·CSP·심볼릭 링크·개인/비밀 파일 잔여 검사 포함)은 macOS/Linux에서도 통과하지만, 런처의 실제 빌드·실행 검증은 Windows CI(`package-windows` job)에서만 이뤄진다.

서명되지 않은 개발 build를 공개 Release로 배포하지 않는다. 전체 절차는 [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)를 따른다.

## 삭제

1. 트레이에서 `부팅 시 시작`을 끈다.
2. DeskWidget을 종료한다.
3. 압축을 풀었던 앱 폴더를 삭제한다.
4. 위치·설정 기록까지 지우려면 `%APPDATA%\DeskWidget`을 사용자가 직접 삭제한다.

이미지 폴더에는 사용자 파일이 있으므로 앱이 자동 삭제하지 않는다.

## 보안 제보

취약점은 공개 Issue보다 GitHub의 private security advisory로 먼저 제보한다. 범위와 처리 방식은 [SECURITY.md](SECURITY.md)에 정리돼 있다.

## 라이선스

소스 코드는 [MIT License](LICENSE)로 공개한다. `default-dino.png`는 코드와 별도로 [CC0 1.0 Universal](ASSETS.md)을 적용하며, 앱은 이 공룡 이미지를 축소해 트레이 아이콘으로도 사용한다.
