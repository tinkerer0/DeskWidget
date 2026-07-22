# DeskWidget Privacy Notice

Last updated: 2026-07-21

DeskWidget is designed as a local-only desktop utility.

## Data collection and transmission

DeskWidget does not include accounts, analytics, advertising, telemetry, crash reporting, an updater, an LLM connection, or an external API. The application does not intentionally send images, filenames, settings, or usage information over the network. Its Electron session also rejects renderer HTTP, HTTPS, and WebSocket requests as a defense-in-depth control.

## Data stored on the device

DeskWidget can access and store the following local data only for its visible functionality:

- Images the user places in the top-level `사진을 넣으면 위젯이 됩니다` folder of the extracted release (or the development `userData` folder when running from source)
- Image filenames, widget positions, widths, and stacking order in `%APPDATA%\DeskWidget\widgets.json`
- The user's autostart choice in `%APPDATA%\DeskWidget\autostart.txt`
- A Windows Startup shortcut when the user explicitly enables `부팅 시 시작`

The application does not copy image contents into its settings file. Filenames remain local but may themselves contain personal information, so packaged builds do not log them by default.

DeskWidget itself never transmits or syncs this data — "local processing" means the app only reads and writes files on this device. That said, `%APPDATA%\DeskWidget` lives inside the user's Windows profile, so if the machine already has Windows Roaming Profiles, OneDrive Folder Backup/Known Folder Move, or a similar OS- or account-level sync feature turned on, that existing Windows/user setting — not DeskWidget — may copy these settings files elsewhere. That is a Windows/account configuration choice made outside the app, not a DeskWidget network feature.

## User control and deletion

- Remove an image from the image folder to stop displaying it.
- Disable autostart from the tray before deleting the portable app.
- Delete `%APPDATA%\DeskWidget` to remove saved positions and preferences.
- User image files are never automatically deleted.

## Changes

If a future version adds any network feature, telemetry, account, updater, or crash-reporting service, this notice and the in-app disclosure must be updated before release.

Questions can be opened in the repository's GitHub Issues. Security-sensitive reports should use a private GitHub security advisory as described in `SECURITY.md`.
