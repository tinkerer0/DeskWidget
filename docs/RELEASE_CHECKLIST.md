# DeskWidget Release Checklist

Public source and public binary are separate gates. A source tag does not prove that a binary was built from that source.

## 1. Rights and metadata

- [x] Add the MIT `LICENSE` for the source code.
- [x] Record the repository owner's CC0 dedication for `default-dino.png` in `ASSETS.md`; ship no standalone image asset that is not listed there.
- [ ] Confirm the version, changelog, repository URL, privacy notice, and security policy.
- [ ] Do not add a real email address, local absolute path, signing identity file, or personal image to the repository.

## 2. Clean source verification

Run from a fresh clone or clean CI checkout:

```bash
git status --short
npm ci
npm audit
npm test
npm run package:verify
gitleaks git . --redact --no-banner
```

Required results:

- [ ] Working tree was clean before the build.
- [ ] `npm ci`, `npm audit`, and all tests passed.
- [ ] Electron is on a currently supported security release.
- [ ] `package-lock.json` changed only when dependency updates were intentional.
- [ ] Secret scan found no credential or personal path.

## 3. Windows package

Build on a dedicated Windows CI runner:

```bash
npm run release:win
```

- [ ] The Electron app was produced from `scripts/package.js` staging, not by packaging the working directory directly — `resources/app.asar` contains only the files in `APP_FILES` (`npm run package:verify`).
- [ ] The final assembled release folder has **exactly four top-level entries**: `DeskWidget 실행.exe`, `사진을 넣으면 위젯이 됩니다/`, `사용 설명서.html`, `안 보셔도 됩니다/` (`scripts/release-layout.js` / `test/release-layout.test.js`).
- [ ] All Electron/Chromium runtime files (the packaged exe, `resources/`, `locales/`, DLLs, license files) live only inside `안 보셔도 됩니다/` — none at the top level.
- [ ] `DeskWidget 실행.exe` was compiled from `launcher/launcher.cs` — a small C# (.NET Framework, managed PE) Windows GUI program, not hand-copied and not a `.lnk`/`.bat`/`.cmd`/`.vbs` file — by `scripts/build-launcher.js`, which searches known `csc.exe` locations on the build machine and fails the build clearly if none is found (it does not assume the compiler is always present).
- [ ] `사진을 넣으면 위젯이 됩니다/` contains exactly one file (`dino.png`, the default sample) right after assembly, and no other file, folder, or link.
- [ ] `사용 설명서.html` is a single local file with a Content-Security-Policy meta tag and no external `http(s)://` reference, protocol-relative URL, external `src`/`href`, or `<script>`/`<iframe>`/`<object>`/`<embed>` element.
- [ ] No `.env`/`.env.*`, `.p12`/`.pfx`/`.key`/`.pem`, `widgets.json`, `autostart.txt`, `*.log`, `.DS_Store`, `Thumbs.db`, or symlink/reparse point exists anywhere in the assembled release folder (recursive check — `scripts/release-layout.js`).
- [ ] `안 보셔도 됩니다/` contains, at minimum, `DeskWidget.exe`, `resources/app.asar`, a non-empty `locales/` directory, Electron's `LICENSE` and `LICENSES.chromium.html`, plus DeskWidget's `LICENSE-DeskWidget.txt` and `ASSETS-DeskWidget.md` notices.
- [ ] `DeskWidget 실행.exe` and the internal `DeskWidget.exe` both start with a Windows PE `MZ` header (a minimum executability check, not a substitute for signature verification below).
- [ ] Every shipped PE file (`DeskWidget 실행.exe` and the internal `DeskWidget.exe`) is signed with the intended Authenticode identity.
- [ ] The final archive has a separately published SHA-256 checksum.
- [ ] `DeskWidget 실행.exe` is managed code — running it requires the .NET Framework runtime on the end-user's Windows install (present by default on Windows 10/11; do not assume it on stripped-down or Server Core images).

## 4. Clean Windows smoke test

Test with a standard non-admin user on a clean Windows 11 environment.

- [ ] Extracting the archive to a writable user folder shows exactly the four top-level items above — nothing else.
- [ ] Double-clicking `DeskWidget 실행.exe` (not any file inside `안 보셔도 됩니다/`) launches the app.
- [ ] Moving `DeskWidget 실행.exe` out of the release folder by itself (leaving `안 보셔도 됩니다/` behind) shows a Korean error dialog and exits cleanly instead of crashing.
- [ ] SmartScreen/Defender behavior and publisher identity are recorded for both `DeskWidget 실행.exe` and the internal `DeskWidget.exe`.
- [ ] Autostart is OFF on first launch.
- [ ] Enabling autostart, signing out/rebooting, and disabling it all work.
- [ ] Startup shortcut is removed after disabling autostart.
- [ ] The bundled example image in `사진을 넣으면 위젯이 됩니다/` shows as a widget on first launch.
- [ ] PNG, animated GIF, WebP, and JPEG display correctly.
- [ ] Same-name image replacement reloads the widget.
- [ ] Corrupt, spoofed, oversized, extremely wide, and extremely tall images do not crash or freeze the app.
- [ ] Drag, resize, stacking, tray actions, `Ctrl+Alt+Q`, and second launch behavior work.
- [ ] Removing an image closes its widget.
- [ ] Optional `%APPDATA%\DeskWidget` cleanup removes settings without deleting user images.
- [ ] `사용 설명서.html` opens correctly in a browser directly from the extracted folder, fully offline.

## 5. Publish and rollback

- [ ] Create a draft GitHub Release first.
- [ ] Attach only the signed archive and checksum generated by CI.
- [ ] Verify the downloaded asset's signature and hash again.
- [ ] Publish release notes with known limitations and the local-only privacy statement.
- [ ] Keep the previous signed release available for rollback.
- [ ] If a post-release security issue appears, stop distribution, publish an advisory, rotate any affected signing material, and issue a new version rather than replacing an existing asset in place.

## Microsoft Store gate

The current portable build writes the image folder at the top level of the extracted release folder (not inside a Store/MSIX package location) and is not Store/MSIX-ready. Before Store submission, move user data to a supported writable location or folder picker, adopt a packaged startup task, provide a hosted privacy-policy URL, produce a compliant signed installer/package, and re-run Store certification tests.
