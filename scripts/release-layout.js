'use strict'

const fs = require('fs')
const path = require('path')

const LAUNCHER_NAME = 'DeskWidget 실행.exe'
const IMAGES_DIR_NAME = '사진을 넣으면 위젯이 됩니다'
const USER_GUIDE_NAME = '사용 설명서.html'
const RUNTIME_DIR_NAME = '안 보셔도 됩니다'
const RUNTIME_EXE_NAME = 'DeskWidget.exe'
const DEFAULT_SAMPLE_IMAGE_NAME = 'dino.png'

// 사용자가 압축을 풀었을 때 보게 되는 최상위 4개 항목 — 순서 무관, 정확히 이 집합이어야 한다.
const TOP_LEVEL_ENTRIES = Object.freeze([LAUNCHER_NAME, IMAGES_DIR_NAME, USER_GUIDE_NAME, RUNTIME_DIR_NAME])

// electron-packager win32 산출물이 실제로 갖는 파일들 — 하나라도 빠지면 조립이 잘못된 것이다.
const RUNTIME_REQUIRED_FILES = Object.freeze([
  RUNTIME_EXE_NAME,
  path.join('resources', 'app.asar'),
  'LICENSE',
  'LICENSES.chromium.html',
  'LICENSE-DeskWidget.txt',
  'ASSETS-DeskWidget.md',
])
const RUNTIME_REQUIRED_NONEMPTY_DIRS = Object.freeze(['locales'])

// Windows 파일시스템은 대소문자를 구분하지 않으므로 이 목록·판정은 항상 소문자로 정규화해 비교한다.
const FORBIDDEN_EXACT_NAMES = new Set(['widgets.json', 'autostart.txt', '.ds_store', 'thumbs.db'])
const FORBIDDEN_EXTENSION_PATTERN = /\.(p12|pfx|key|pem|log)$/i

function fail(message) {
  throw new Error(`release layout: ${message}`)
}

function isForbiddenName(name) {
  const normalized = name.toLowerCase()
  if (FORBIDDEN_EXACT_NAMES.has(normalized)) return true
  if (normalized === '.env' || normalized.startsWith('.env.')) return true
  return FORBIDDEN_EXTENSION_PATTERN.test(normalized)
}

function lstatRequired(target, label) {
  let stat
  try {
    stat = fs.lstatSync(target)
  } catch (_error) {
    fail(`${label} missing: ${target}`)
  }
  if (stat.isSymbolicLink()) fail(`${label} must not be a symlink/reparse point: ${target}`)
  return stat
}

// releaseDir 전체(안 보셔도 됩니다/사진 폴더 내부까지 포함)를 재귀 순회한다. 심볼릭 링크는
// dirent 자체가 링크 타입으로 보고되므로 isDirectory()가 false가 되어 자동으로 하위 탐색을 멈춘다.
function walkEntries(root) {
  const stack = [root]
  const entries = []
  while (stack.length) {
    const dir = stack.pop()
    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, dirent.name)
      entries.push({ dirent, fullPath, name: dirent.name })
      if (dirent.isDirectory() && !dirent.isSymbolicLink()) stack.push(fullPath)
    }
  }
  return entries
}

function verifyNoSymlinksOrForbiddenFiles(releaseDir) {
  for (const { dirent, fullPath, name } of walkEntries(releaseDir)) {
    if (dirent.isSymbolicLink()) fail(`symlink/reparse point not allowed anywhere in the release: ${fullPath}`)
    if (isForbiddenName(name)) fail(`forbidden personal/secret/runtime file found: ${fullPath}`)
  }
}

// 관리자 권한 상승 없이 "실행 가능한 Windows PE"인지 최소한으로 확인한다 — 서명 검증은 아니다.
function assertPeHeader(filePath, label) {
  const fd = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(2)
    const bytesRead = fs.readSync(fd, buffer, 0, 2, 0)
    if (bytesRead < 2 || buffer[0] !== 0x4d || buffer[1] !== 0x5a) {
      fail(`${label} does not look like a Windows PE executable (missing MZ header): ${filePath}`)
    }
  } finally {
    fs.closeSync(fd)
  }
}

const DISALLOWED_TAG_PATTERN = /<\s*(script|iframe|object|embed|link|base|audio|video|source|track|applet|frame|frameset|portal)\b/i
const REQUIRED_CSP_DIRECTIVES = Object.freeze([/default-src\s+'none'/i, /script-src\s+'none'/i, /connect-src\s+'none'/i])

// 속성값이 그 자체로 다른 종류의 따옴표를 포함할 수 있으므로(예: CSP의 default-src 'none'),
// 여는/닫는 따옴표만 구분하고 값 내부는 그대로 담는다 — [^"']류 문자클래스는 내부 따옴표에서
// 값을 잘라먹는 버그를 낸다.
function matchQuotedAttribute(source, attributeNamePattern) {
  const match = source.match(new RegExp(`${attributeNamePattern}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
  if (!match) return null
  return match[1] !== undefined ? match[1] : match[2]
}

function extractCspContent(html) {
  const metaTag = html.match(/<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i)
  if (!metaTag) return null
  return matchQuotedAttribute(metaTag[0], 'content')
}

// "완전한 로컬 단일 파일" 요구를 코드로 강제한다: 외부 네트워크 참조, script/iframe/object/embed류
// 태그, CSS @import·url(), protocol-relative("//") 참조, meta refresh, unquoted src/href, 이 파일
// 밖을 가리키는 src/href가 전혀 없어야 하고 CSP가 default-src/script-src/connect-src 'none'을 포함해야 한다.
function assertLocalOnlyHtml(filePath) {
  const html = fs.readFileSync(filePath, 'utf8')

  const csp = extractCspContent(html)
  if (!csp) fail(`user guide is missing a Content-Security-Policy meta tag: ${filePath}`)
  for (const directive of REQUIRED_CSP_DIRECTIVES) {
    if (!directive.test(csp)) fail(`user guide CSP must include ${directive}: ${filePath}`)
  }

  if (/http-equiv=["']refresh["']/i.test(html)) fail(`user guide must not use meta refresh: ${filePath}`)
  if (/https?:\/\//i.test(html)) fail(`user guide references an external http(s) URL: ${filePath}`)
  if (html.includes('//')) fail(`user guide contains a protocol-relative ("//") reference: ${filePath}`)
  if (/@import\b/i.test(html)) fail(`user guide must not use CSS @import: ${filePath}`)

  for (const match of html.matchAll(/url\(\s*(["']?)([^)]*)\1\s*\)/gi)) {
    const value = match[2].trim()
    if (!/^data:/i.test(value)) fail(`user guide contains a CSS url() reference to an external/local resource ("${value}"): ${filePath}`)
  }

  const disallowedTag = html.match(DISALLOWED_TAG_PATTERN)
  if (disallowedTag) fail(`user guide contains a disallowed <${disallowedTag[1]}> element: ${filePath}`)

  if (/\b(?:src|href)\s*=\s*(?!["'])[^\s>]+/i.test(html)) {
    fail(`user guide contains an unquoted src/href attribute: ${filePath}`)
  }

  const attributePattern = /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
  let match
  while ((match = attributePattern.exec(html))) {
    const value = (match[1] !== undefined ? match[1] : match[2]).trim()
    if (value === '' || value.startsWith('#') || /^data:/i.test(value)) continue
    fail(`user guide references an external/local resource via src or href ("${value}"): ${filePath}`)
  }
}

function assertImagesDirExactlyDefaultSample(imagesPath) {
  const entries = fs.readdirSync(imagesPath, { withFileTypes: true })
  if (entries.length !== 1) {
    fail(`images dir must contain exactly one file right after assembly (${DEFAULT_SAMPLE_IMAGE_NAME}), got ${entries.length}: ${imagesPath}`)
  }
  const [entry] = entries
  if (entry.name !== DEFAULT_SAMPLE_IMAGE_NAME) {
    fail(`images dir's only entry must be ${DEFAULT_SAMPLE_IMAGE_NAME}, got ${entry.name}: ${imagesPath}`)
  }
  const samplePath = path.join(imagesPath, entry.name)
  if (!lstatRequired(samplePath, 'default sample image').isFile()) {
    fail(`default sample image must be a regular file: ${samplePath}`)
  }
}

function assertRuntimeComplete(runtimePath) {
  for (const relativeFile of RUNTIME_REQUIRED_FILES) {
    const fullPath = path.join(runtimePath, relativeFile)
    if (!lstatRequired(fullPath, `runtime file "${relativeFile}"`).isFile()) {
      fail(`runtime file must be a regular file: ${fullPath}`)
    }
  }
  for (const relativeDir of RUNTIME_REQUIRED_NONEMPTY_DIRS) {
    const fullPath = path.join(runtimePath, relativeDir)
    if (!lstatRequired(fullPath, `runtime dir "${relativeDir}"`).isDirectory()) {
      fail(`runtime dir must be a directory: ${fullPath}`)
    }
    if (fs.readdirSync(fullPath).length === 0) fail(`runtime dir must not be empty: ${fullPath}`)
  }
  assertPeHeader(path.join(runtimePath, RUNTIME_EXE_NAME), 'runtime exe')
}

// 실제 electron-packager 서명 여부까지는 검사하지 않는다 — 여기서는 최종 배포 구조 전체를 본다.
// 내부 electron 앱 파일 allowlist 검증은 scripts/package.js의 verifyStage가 별도로 담당한다.
function verifyReleaseLayout(releaseDir) {
  if (!lstatRequired(releaseDir, 'release directory').isDirectory()) {
    fail(`release directory must be a regular directory, not a symlink/junction/reparse point: ${releaseDir}`)
  }

  const entries = fs.readdirSync(releaseDir).sort()
  const expected = [...TOP_LEVEL_ENTRIES].sort()
  if (JSON.stringify(entries) !== JSON.stringify(expected)) {
    fail(`top level must be exactly ${JSON.stringify(expected)}, got ${JSON.stringify(entries)}`)
  }

  verifyNoSymlinksOrForbiddenFiles(releaseDir)

  const launcherPath = path.join(releaseDir, LAUNCHER_NAME)
  if (!lstatRequired(launcherPath, 'launcher').isFile()) fail(`launcher must be a regular file: ${launcherPath}`)
  assertPeHeader(launcherPath, 'launcher')

  const guidePath = path.join(releaseDir, USER_GUIDE_NAME)
  if (!lstatRequired(guidePath, 'user guide').isFile()) fail(`user guide must be a regular file: ${guidePath}`)
  assertLocalOnlyHtml(guidePath)

  const imagesPath = path.join(releaseDir, IMAGES_DIR_NAME)
  if (!lstatRequired(imagesPath, 'images dir').isDirectory()) fail(`images dir must be a directory: ${imagesPath}`)
  assertImagesDirExactlyDefaultSample(imagesPath)

  const runtimePath = path.join(releaseDir, RUNTIME_DIR_NAME)
  if (!lstatRequired(runtimePath, 'runtime dir').isDirectory()) fail(`runtime dir must be a directory: ${runtimePath}`)
  assertRuntimeComplete(runtimePath)

  return {
    guidePath,
    imagesPath,
    launcherPath,
    runtimeExePath: path.join(runtimePath, RUNTIME_EXE_NAME),
    runtimePath,
  }
}

module.exports = {
  DEFAULT_SAMPLE_IMAGE_NAME,
  IMAGES_DIR_NAME,
  LAUNCHER_NAME,
  RUNTIME_DIR_NAME,
  RUNTIME_EXE_NAME,
  TOP_LEVEL_ENTRIES,
  USER_GUIDE_NAME,
  assertLocalOnlyHtml,
  assertPeHeader,
  isForbiddenName,
  verifyReleaseLayout,
}
