# DeskWidget

**내 이미지를 Windows 바탕화면 위젯으로 띄우는 작은 앱.**

폴더에 PNG·GIF·WebP·JPG를 넣으면 이미지마다 투명한 위젯 창이 생긴다. 끌어서 옮기고, 휠로 크기를 바꾸고, 위젯끼리 앞뒤 순서를 정할 수 있으며 위치는 저장된다.

> [!NOTE]
> 실행 파일은 아직 배포하지 않는다. 코드 서명과 깨끗한 Windows에서의 검증을 마친 뒤에 올릴 예정이다. 그 전까지는 Windows에서 [직접 빌드](#직접-빌드)한 압축 해제형(portable) 폴더로 쓴다.

## 사용법

배포 폴더를 열면 최상위에 정확히 네 가지만 보인다.

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

## 직접 빌드

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

`npm run release:win`이 만든 배포 폴더를 위 [사용법](#사용법)대로 쓴다. 패키징을 어떻게 안전하게 나눴는지와 공개 배포 전 확인 절차는 [docs/PACKAGING.md](docs/PACKAGING.md)에 있다.

## 삭제

1. 트레이에서 `부팅 시 시작`을 끈다.
2. DeskWidget을 종료한다.
3. 압축을 풀었던 앱 폴더를 삭제한다.
4. 위치·설정 기록까지 지우려면 `%APPDATA%\DeskWidget`을 사용자가 직접 삭제한다.

이미지 폴더에는 사용자 파일이 있으므로 앱이 자동 삭제하지 않는다.

## 보안 제보

취약점은 공개 Issue보다 GitHub의 private security advisory로 먼저 제보한다. 범위와 처리 방식은 [SECURITY.md](SECURITY.md)에 정리돼 있다.

## Feedback

제가 이런 분야를 접한 지 얼마 안 돼서 부족한 점이 많습니다. 고칠 점이나 알려주실 내용이 있다면 issue나 PR로 남겨주시면 너무 감사하겠습니다.

I am still new to this, so there is a lot to improve. Issues and pull requests with fixes or suggestions are very welcome.

## 라이선스

소스 코드는 [MIT License](LICENSE)로 공개한다. `default-dino.png`는 코드와 별도로 [CC0 1.0 Universal](ASSETS.md)을 적용하며, 앱은 이 공룡 이미지를 축소해 트레이 아이콘으로도 사용한다.
