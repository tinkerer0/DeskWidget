# Windows 패키징

README에서 옮긴 패키징 구조와 공개 배포 전 확인 절차다.

패키징은 두 단계로 분리돼 있고, 검증도 각 단계별로 따로 한다.

1. **Electron 앱 소스 staging** — [scripts/package.js](../scripts/package.js)의 고정 allowlist(`APP_FILES`)에 있는 파일만 임시 staging 폴더에 복사한 뒤 `dist/DeskWidget-win32-x64`에 ASAR bundle을 만든다. `npm run package:verify`가 이 allowlist만 검증한다. `.gitignore`에만 의존하지 않으므로 개발용 이미지·`.env`·테스트·문서·코드서명 파일이 여기 들어갈 수 없다.
2. **최종 배포 폴더 조립** — [scripts/assemble-release.js](../scripts/assemble-release.js)가 1번 산출물을 `안 보셔도 됩니다`로 옮기고, [launcher/launcher.cs](../launcher/launcher.cs)를 Windows에 내장된 `csc.exe`(.NET Framework 컴파일러, 추가 설치 불필요)로 빌드해 `DeskWidget 실행.exe`를 만들고, 예시 이미지·`사용 설명서.html`·DeskWidget의 MIT/CC0 고지를 채운 뒤 [scripts/release-layout.js](../scripts/release-layout.js)로 최상위가 정확히 4개 항목인지, 내부 runtime이 `안 보셔도 됩니다` 안에만 있는지, 개인/런타임 파일이 섞이지 않았는지 검사한다. 이 최종 layout 검증은 소스 allowlist 검증과 별개다.

런처(`launcher/launcher.cs`)는 `.lnk`/`.bat`/`.cmd`/`.vbs`가 아니라 C#으로 작성해 `csc.exe`(.NET Framework 컴파일러)로 컴파일한 작은 Windows GUI 실행 파일(managed PE)이며, 자기 자신의 위치를 기준으로 `안 보셔도 됩니다\DeskWidget.exe`만 상대 경로로 실행한다. 관리자 권한 상승, 네트워크, 셸 호출, 사용자 입력 기반 경로 조합이 없고, 내부 exe가 없으면 한국어 오류 메시지를 띄우고 종료한다. `scripts/build-launcher.js`는 지원 대상 Windows 빌드 환경(CI 러너 포함)에서 흔한 `csc.exe` 설치 경로를 검색해 사용하며, 찾지 못하면 새 도구를 임의로 설치하지 않고 빌드를 명확한 에러로 실패시킨다 — 항상 존재한다고 가정하지 않는다. 이 런처는 관리 코드(managed code)이므로 실행하려면 대상 Windows에 .NET Framework 런타임이 있어야 한다. Windows 10/11은 기본적으로 이를 포함하지만, 이는 최종 사용자 쪽 런타임 요구 사항이며 별도 설치가 필요한 환경도 있을 수 있다.

공개 binary를 만들 때는 다음이 추가로 필요하다.

1. clean checkout에서 `npm ci`와 `npm test`
2. Windows CI에서 `npm run release:win`
3. 조립된 배포 폴더에 allowlist 밖 파일과 사용자 이미지가 없는지 검사(위 최종 layout 검증이 자동 수행)
4. Authenticode 코드서명(런처와 내부 exe 모두)
5. SHA-256 checksum 생성
6. Windows Defender/SmartScreen과 clean Windows 계정에서 실행·재부팅·삭제 확인

> macOS 개발 머신에는 `csc.exe`가 없어 `DeskWidget 실행.exe`를 실제로 컴파일·실행할 수 없다. `npm run package:win`(electron-packager 산출물 생성)과 구조적 layout 검증(`test/release-layout.test.js`, PE MZ header·CSP·심볼릭 링크·개인/비밀 파일 잔여 검사 포함)은 macOS/Linux에서도 통과하지만, 런처의 실제 빌드·실행 검증은 Windows CI(`package-windows` job)에서만 이뤄진다.

서명되지 않은 개발 build를 공개 Release로 배포하지 않는다. 전체 절차는 [docs/RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)를 따른다.

