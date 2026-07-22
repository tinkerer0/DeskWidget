'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  DEFAULT_SAMPLE_IMAGE_NAME,
  IMAGES_DIR_NAME,
  LAUNCHER_NAME,
  RUNTIME_DIR_NAME,
  RUNTIME_EXE_NAME,
  TOP_LEVEL_ENTRIES,
  USER_GUIDE_NAME,
  assertLocalOnlyHtml,
  isForbiddenName,
  verifyReleaseLayout,
} = require('../scripts/release-layout')

const PE_STUB = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00])
const VALID_GUIDE_HTML = [
  '<!doctype html>',
  '<html lang="ko">',
  '<head>',
  '<meta charset="utf-8" />',
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; connect-src \'none\'" />',
  '<title>guide</title>',
  '</head>',
  '<body>안내</body>',
  '</html>',
].join('\n')

function makeValidRelease(directory) {
  fs.writeFileSync(path.join(directory, LAUNCHER_NAME), PE_STUB)
  fs.writeFileSync(path.join(directory, USER_GUIDE_NAME), VALID_GUIDE_HTML)

  const imagesDir = path.join(directory, IMAGES_DIR_NAME)
  fs.mkdirSync(imagesDir, { recursive: true })
  fs.writeFileSync(path.join(imagesDir, DEFAULT_SAMPLE_IMAGE_NAME), 'fake-png-bytes')

  const runtimeDir = path.join(directory, RUNTIME_DIR_NAME)
  fs.mkdirSync(path.join(runtimeDir, 'resources'), { recursive: true })
  fs.mkdirSync(path.join(runtimeDir, 'locales'), { recursive: true })
  fs.writeFileSync(path.join(runtimeDir, RUNTIME_EXE_NAME), PE_STUB)
  fs.writeFileSync(path.join(runtimeDir, 'resources', 'app.asar'), 'fake-asar')
  fs.writeFileSync(path.join(runtimeDir, 'LICENSE'), 'electron license text')
  fs.writeFileSync(path.join(runtimeDir, 'LICENSES.chromium.html'), '<html>chromium licenses</html>')
  fs.writeFileSync(path.join(runtimeDir, 'LICENSE-DeskWidget.txt'), 'DeskWidget MIT license text')
  fs.writeFileSync(path.join(runtimeDir, 'ASSETS-DeskWidget.md'), 'DeskWidget asset license text')
  fs.writeFileSync(path.join(runtimeDir, 'locales', 'en-US.pak'), 'fake-locale')
}

function withTempDir(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskwidget-release-layout-test-'))
  try {
    return callback(directory)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('exactly four top-level entries are required, in Korean, matching the shipped UX', () => {
  assert.deepEqual([...TOP_LEVEL_ENTRIES].sort(), [
    'DeskWidget 실행.exe',
    '사용 설명서.html',
    '사진을 넣으면 위젯이 됩니다',
    '안 보셔도 됩니다',
  ])
})

test('a correctly assembled release layout passes verification', () => {
  withTempDir(directory => {
    makeValidRelease(directory)
    const result = verifyReleaseLayout(directory)
    assert.equal(path.basename(result.runtimeExePath), RUNTIME_EXE_NAME)
  })
})

test('an extra top-level file (e.g. a leaked personal/runtime file) fails verification', () => {
  withTempDir(directory => {
    makeValidRelease(directory)
    fs.writeFileSync(path.join(directory, 'widgets.json'), '{}')
    assert.throws(() => verifyReleaseLayout(directory), /top level must be exactly/)
  })
})

test('a missing internal runtime executable fails verification', () => {
  withTempDir(directory => {
    makeValidRelease(directory)
    fs.rmSync(path.join(directory, RUNTIME_DIR_NAME, RUNTIME_EXE_NAME))
    assert.throws(() => verifyReleaseLayout(directory), /runtime file "DeskWidget\.exe" missing/)
  })
})

test('an empty image drop folder fails verification (no default sample)', () => {
  withTempDir(directory => {
    makeValidRelease(directory)
    fs.rmSync(path.join(directory, IMAGES_DIR_NAME, DEFAULT_SAMPLE_IMAGE_NAME))
    assert.throws(() => verifyReleaseLayout(directory), /must contain exactly one file/)
  })
})

test('an extra file dropped into the image folder (e.g. a personal photo) fails verification', () => {
  withTempDir(directory => {
    makeValidRelease(directory)
    fs.writeFileSync(path.join(directory, IMAGES_DIR_NAME, 'personal.jpg'), 'someones-photo')
    assert.throws(() => verifyReleaseLayout(directory), /must contain exactly one file/)
  })
})

test('a nested .env file inside the runtime folder fails verification', () => {
  withTempDir(directory => {
    makeValidRelease(directory)
    fs.writeFileSync(path.join(directory, RUNTIME_DIR_NAME, 'resources', '.env'), 'SECRET=1')
    assert.throws(() => verifyReleaseLayout(directory), /forbidden personal\/secret\/runtime file/)
  })
})

test('a missing resources/app.asar fails verification even if DeskWidget.exe is present', () => {
  withTempDir(directory => {
    makeValidRelease(directory)
    fs.rmSync(path.join(directory, RUNTIME_DIR_NAME, 'resources', 'app.asar'))
    assert.throws(() => verifyReleaseLayout(directory), /runtime file "resources[/\\]app\.asar" missing/)
  })
})

test('a missing or empty locales directory fails verification', () => {
  withTempDir(directory => {
    makeValidRelease(directory)
    fs.rmSync(path.join(directory, RUNTIME_DIR_NAME, 'locales', 'en-US.pak'))
    assert.throws(() => verifyReleaseLayout(directory), /runtime dir must not be empty/)
  })
})

test('missing Electron/Chromium license files fail verification', () => {
  withTempDir(directory => {
    makeValidRelease(directory)
    fs.rmSync(path.join(directory, RUNTIME_DIR_NAME, 'LICENSES.chromium.html'))
    assert.throws(() => verifyReleaseLayout(directory), /runtime file "LICENSES\.chromium\.html" missing/)
  })
})

test('missing DeskWidget code or asset notices fail verification', () => {
  for (const filename of ['LICENSE-DeskWidget.txt', 'ASSETS-DeskWidget.md']) {
    withTempDir(directory => {
      makeValidRelease(directory)
      fs.rmSync(path.join(directory, RUNTIME_DIR_NAME, filename))
      assert.throws(() => verifyReleaseLayout(directory), new RegExp(`runtime file "${filename.replace('.', '\\.')}" missing`))
    })
  }
})

test('a fake (non-PE) internal executable fails verification', () => {
  withTempDir(directory => {
    makeValidRelease(directory)
    fs.writeFileSync(path.join(directory, RUNTIME_DIR_NAME, RUNTIME_EXE_NAME), 'not-actually-an-exe')
    assert.throws(() => verifyReleaseLayout(directory), /missing MZ header/)
  })
})

test('a fake (non-PE) top-level launcher fails verification', () => {
  withTempDir(directory => {
    makeValidRelease(directory)
    fs.writeFileSync(path.join(directory, LAUNCHER_NAME), 'echo not a real exe')
    assert.throws(() => verifyReleaseLayout(directory), /missing MZ header/)
  })
})

test('the internal runtime is confined to its own folder, not spilled to top level', () => {
  withTempDir(directory => {
    makeValidRelease(directory)
    const entries = fs.readdirSync(directory)
    assert.equal(entries.includes('resources'), false)
    assert.equal(entries.includes(RUNTIME_EXE_NAME), false)
  })
})

test('a symlinked launcher is rejected as a reparse point, not silently followed', () => {
  withTempDir(directory => {
    makeValidRelease(directory)
    const launcherPath = path.join(directory, LAUNCHER_NAME)
    const realTarget = path.join(directory, RUNTIME_DIR_NAME, 'real-launcher.exe')
    fs.renameSync(launcherPath, realTarget)
    try {
      fs.symlinkSync(realTarget, launcherPath)
    } catch (_error) {
      // 심볼릭 링크 생성에 권한이 필요한 환경(Windows non-elevated 등)에서는 이 검사를 건너뛴다.
      fs.renameSync(realTarget, launcherPath)
      return
    }
    assert.throws(() => verifyReleaseLayout(directory), /symlink\/reparse point not allowed/)
  })
})

test('a symlink nested deep inside the runtime folder is rejected', () => {
  withTempDir(directory => {
    makeValidRelease(directory)
    const target = path.join(directory, RUNTIME_DIR_NAME, 'resources', 'app.asar')
    const linkPath = path.join(directory, RUNTIME_DIR_NAME, 'resources', 'app-link.asar')
    try {
      fs.symlinkSync(target, linkPath)
    } catch (_error) {
      return
    }
    assert.throws(() => verifyReleaseLayout(directory), /symlink\/reparse point not allowed/)
  })
})

test('isForbiddenName rejects known personal/secret/runtime patterns', () => {
  for (const name of ['.env', '.env.production', 'a.p12', 'a.pfx', 'id.key', 'cert.pem', 'run.log', 'widgets.json', 'autostart.txt', '.DS_Store', 'Thumbs.db']) {
    assert.equal(isForbiddenName(name), true, `expected ${name} to be forbidden`)
  }
  for (const name of ['dino.png', 'DeskWidget.exe', 'app.asar', 'LICENSE']) {
    assert.equal(isForbiddenName(name), false, `expected ${name} to be allowed`)
  }
})

test('isForbiddenName is case-insensitive (Windows filesystem semantics)', () => {
  for (const name of ['.ENV', '.Env.Production', 'A.P12', 'ID.KEY', 'WIDGETS.JSON', 'AUTOSTART.TXT', 'thumbs.DB', 'Thumbs.Db']) {
    assert.equal(isForbiddenName(name), true, `expected ${name} to be forbidden regardless of case`)
  }
})

test('a nested uppercase WIDGETS.JSON inside the runtime folder fails verification', () => {
  withTempDir(directory => {
    makeValidRelease(directory)
    fs.writeFileSync(path.join(directory, RUNTIME_DIR_NAME, 'WIDGETS.JSON'), '{}')
    assert.throws(() => verifyReleaseLayout(directory), /forbidden personal\/secret\/runtime file/)
  })
})

test('a nested uppercase .ENV file inside the runtime folder fails verification', () => {
  withTempDir(directory => {
    makeValidRelease(directory)
    fs.writeFileSync(path.join(directory, RUNTIME_DIR_NAME, 'resources', '.ENV'), 'SECRET=1')
    assert.throws(() => verifyReleaseLayout(directory), /forbidden personal\/secret\/runtime file/)
  })
})

test('the release directory itself being a symlink is rejected before reading its contents', () => {
  withTempDir(parent => {
    const realDir = path.join(parent, 'real-release')
    fs.mkdirSync(realDir, { recursive: true })
    makeValidRelease(realDir)
    const linkDir = path.join(parent, 'release-link')
    try {
      fs.symlinkSync(realDir, linkDir, 'dir')
    } catch (_error) {
      return
    }
    assert.throws(() => verifyReleaseLayout(linkDir), /must not be a symlink\/reparse point/)
  })
})

test('the user guide must carry a Content-Security-Policy meta tag', () => {
  const html = VALID_GUIDE_HTML.replace(/<meta http-equiv="Content-Security-Policy"[^>]*\/>/, '')
  assert.throws(() => assertLocalOnlyHtml_withContent(html), /missing a Content-Security-Policy/)
})

test('a CSP missing the required script-src \'none\' directive fails, even if the tag is present', () => {
  const html = VALID_GUIDE_HTML.replace(
    /content="[^"]*"/,
    'content="default-src \'none\'; connect-src \'none\'"',
  )
  assert.throws(() => assertLocalOnlyHtml_withContent(html), /CSP must include/)
})

test('a CSP missing the required connect-src \'none\' directive fails', () => {
  const html = VALID_GUIDE_HTML.replace(
    /content="[^"]*"/,
    'content="default-src \'none\'; script-src \'none\'"',
  )
  assert.throws(() => assertLocalOnlyHtml_withContent(html), /CSP must include/)
})

test('the user guide must not reference an external http(s) URL', () => {
  const html = VALID_GUIDE_HTML.replace('안내', '<a href="https://example.com">link</a>')
  assert.throws(() => assertLocalOnlyHtml_withContent(html), /external http\(s\) URL/)
})

test('the user guide must not reference a protocol-relative URL via src/href', () => {
  const html = VALID_GUIDE_HTML.replace('안내', '<img src="//example.com/tracker.png" />')
  assert.throws(() => assertLocalOnlyHtml_withContent(html), /protocol-relative \("\/\/"\) reference/)
})

test('a CSS @import of a protocol-relative stylesheet is rejected (reported bypass)', () => {
  const html = VALID_GUIDE_HTML.replace('안내', '<style>@import "//evil.example/x.css";</style>')
  assert.throws(() => assertLocalOnlyHtml_withContent(html), /protocol-relative \("\/\/"\) reference|CSS @import/)
})

test('any CSS @import is rejected even without "//" (a single self-contained file never needs one)', () => {
  const html = VALID_GUIDE_HTML.replace('안내', '<style>@import "local-but-separate.css";</style>')
  assert.throws(() => assertLocalOnlyHtml_withContent(html), /CSS @import/)
})

test('a CSS url() reference to an external resource is rejected', () => {
  const html = VALID_GUIDE_HTML.replace('안내', '<style>body { background: url(https://evil.example/bg.png); }</style>')
  assert.throws(() => assertLocalOnlyHtml_withContent(html), /external http\(s\) URL|CSS url\(\)/)
})

test('a CSS url() reference to a bare local file is rejected (not a single self-contained file)', () => {
  const html = VALID_GUIDE_HTML.replace('안내', '<style>body { background: url(bg.png); }</style>')
  assert.throws(() => assertLocalOnlyHtml_withContent(html), /CSS url\(\)/)
})

test('a meta refresh tag that could navigate away is rejected', () => {
  const html = VALID_GUIDE_HTML.replace('안내', '') +
    '<meta http-equiv="refresh" content="0;url=data:text/html,hi">'
  assert.throws(() => assertLocalOnlyHtml_withContent(html), /meta refresh/)
})

test('an unquoted src/href attribute is rejected', () => {
  const html = VALID_GUIDE_HTML.replace('안내', '<img src=icon.png />')
  assert.throws(() => assertLocalOnlyHtml_withContent(html), /unquoted src\/href/)
})

test('a <link> tag (which can load external stylesheets) is rejected', () => {
  const html = VALID_GUIDE_HTML.replace('안내', '<link rel="stylesheet" href="data:text/css,body{}" />')
  assert.throws(() => assertLocalOnlyHtml_withContent(html), /disallowed <link> element/)
})

test('a <base> tag (which can redirect relative URLs externally) is rejected', () => {
  const html = VALID_GUIDE_HTML.replace('안내', '<base href="https://evil.example/" />')
  assert.throws(() => assertLocalOnlyHtml_withContent(html), /external http\(s\) URL|disallowed <base> element/)
})

test('the user guide must not contain a <script> tag', () => {
  const html = VALID_GUIDE_HTML.replace('안내', '<script>alert(1)</script>')
  assert.throws(() => assertLocalOnlyHtml_withContent(html), /disallowed <script> element/)
})

test('the user guide must not contain an <iframe> tag', () => {
  const html = VALID_GUIDE_HTML.replace('안내', '<iframe src="data:text/html,hi"></iframe>')
  assert.throws(() => assertLocalOnlyHtml_withContent(html), /disallowed <iframe> element/)
})

test('a valid self-contained guide passes the local-only HTML check', () => {
  assertLocalOnlyHtml_withContent(VALID_GUIDE_HTML)
})

test('the shipped docs/user-guide.html passes the local-only HTML check', () => {
  const shippedPath = path.resolve(__dirname, '..', 'docs', 'user-guide.html')
  assertLocalOnlyHtml(shippedPath)
})

function assertLocalOnlyHtml_withContent(html) {
  return withTempDir(directory => {
    const filePath = path.join(directory, USER_GUIDE_NAME)
    fs.writeFileSync(filePath, html)
    assertLocalOnlyHtml(filePath)
  })
}
