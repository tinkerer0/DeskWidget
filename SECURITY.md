# Security Policy

## Supported versions

Only the latest released version is supported with security fixes. Electron and packaging dependencies are pinned in `package-lock.json`; dependency update pull requests and Electron security releases should be reviewed promptly.

## Reporting a vulnerability

Do not open a public Issue for an unpatched vulnerability or include private user data in a report. Use GitHub's **Report a vulnerability** / private security advisory flow and include:

- Affected version and Windows version
- Reproduction steps using non-sensitive test data
- Expected and observed behavior
- Whether the issue can cause code execution, data disclosure, persistence, or denial of service

Never attach real personal images, credentials, signing certificates, or private keys.

## Security boundaries

DeskWidget treats image files, filenames, and local configuration as untrusted input. It validates supported image headers and dimensions before opening a renderer window and uses a sandboxed Electron renderer with a fixed IPC bridge.

The app is not intended to defend against an attacker who already controls the same Windows user account. Electron ASAR packaging is not treated as a security boundary. Release authenticity depends on code signing and published checksums.
