'use strict'

const fs = require('fs')
const path = require('path')

const { packageApplication } = require('./package')
const { buildLauncher } = require('./build-launcher')
const {
  DEFAULT_SAMPLE_IMAGE_NAME,
  IMAGES_DIR_NAME,
  LAUNCHER_NAME,
  RUNTIME_DIR_NAME,
  USER_GUIDE_NAME,
  verifyReleaseLayout,
} = require('./release-layout')

const ROOT = path.resolve(__dirname, '..')
const DIST_ROOT = path.join(ROOT, 'dist')
const DEFAULT_SAMPLE_IMAGE_SOURCE = path.join(ROOT, 'default-dino.png')
const USER_GUIDE_SOURCE = path.join(ROOT, 'docs', 'user-guide.html')
const CODE_LICENSE_SOURCE = path.join(ROOT, 'LICENSE')
const ASSET_LICENSE_SOURCE = path.join(ROOT, 'ASSETS.md')

function walk(directory) {
  const result = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    result.push(fullPath)
    if (entry.isDirectory()) result.push(...walk(fullPath))
  }
  return result
}

// DIST_ROOT 자체와 releaseDir까지 이미 존재하는 조상 경로 성분마다 symlink/junction/reparse
// point를 거부한다. lexical 검사(path.relative)만으로는 "dist/some-link -> 저장소 밖"처럼 문자열상
// 하위 경로처럼 보이지만 실제로는 심볼릭 링크를 거쳐 탈출하는 경로를 잡아내지 못한다.
// 아직 존재하지 않는 성분(mkdirSync가 새로 만들 releaseDir 자신 등)은 lstat 대상이 아니다 — 아직
// 아무것도 아니므로 심볼릭 링크일 수 없다.
function assertNoSymlinkedAncestors(resolvedReleaseDir) {
  const relative = path.relative(DIST_ROOT, resolvedReleaseDir)
  const segments = relative.split(path.sep).filter(Boolean)

  let current = DIST_ROOT
  const checkpoints = [current]
  for (const segment of segments) {
    current = path.join(current, segment)
    checkpoints.push(current)
  }

  for (const checkpoint of checkpoints) {
    let stat
    try {
      stat = fs.lstatSync(checkpoint)
    } catch (_error) {
      continue
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`release directory path passes through a symlink/junction/reparse point: ${checkpoint}`)
    }
  }
}

// releaseDir는 반드시 ROOT/dist의 "진짜" 하위 경로여야 한다 — dist 자체, 저장소 루트, dist 밖 절대
// 경로, ".." 탈출, 심볼릭 링크/junction을 경유하는 조상 경로는 전부 거부한다. 이 함수를 통과하지
// 않은 경로에는 절대 rm/mkdir을 실행하지 않는다.
function assertReleaseDirIsSafe(releaseDir) {
  const resolved = path.resolve(releaseDir)
  const relative = path.relative(DIST_ROOT, resolved)
  if (relative === '' || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`release directory must be a strict descendant of ${DIST_ROOT}, got: ${resolved}`)
  }
  assertNoSymlinkedAncestors(resolved)
  return resolved
}

// electron-packager의 원시 출력 폴더를 "안 보셔도 됩니다"로 옮긴다. 같은 드라이브면 원자적 rename,
// 아니면 복사 후 심볼릭 링크 유무를 검사하고 원본을 지운다(패키징 결과에 reparse point가 섞이면 거부).
function movePackagedApp(packagedDir, destination) {
  try {
    fs.renameSync(packagedDir, destination)
    return
  } catch (error) {
    if (error.code !== 'EXDEV') throw error
  }
  fs.cpSync(packagedDir, destination, { recursive: true, verbatimSymlinks: true })
  for (const entry of walk(destination)) {
    if (fs.lstatSync(entry).isSymbolicLink()) throw new Error(`refusing packaged output containing a symlink: ${entry}`)
  }
  fs.rmSync(packagedDir, { recursive: true, force: true })
}

async function assembleRelease(releaseDir) {
  // 경로 안전성은 플랫폼과 무관하게 항상 먼저 검증한다 — 어떤 fs 조작보다도 앞선다.
  const safeReleaseDir = assertReleaseDirIsSafe(releaseDir)

  if (process.platform !== 'win32') {
    throw new Error('release assembly requires Windows (Windows GUI launcher build + win32 electron package)')
  }

  if (fs.existsSync(safeReleaseDir)) fs.rmSync(safeReleaseDir, { recursive: true, force: true })
  fs.mkdirSync(safeReleaseDir, { recursive: true })

  try {
    const appPaths = await packageApplication()
    if (!appPaths || appPaths.length !== 1) {
      throw new Error(`expected exactly one packaged app output, got ${appPaths ? appPaths.length : 0}`)
    }

    const runtimeDir = path.join(safeReleaseDir, RUNTIME_DIR_NAME)
    movePackagedApp(appPaths[0], runtimeDir)
    fs.copyFileSync(CODE_LICENSE_SOURCE, path.join(runtimeDir, 'LICENSE-DeskWidget.txt'))
    fs.copyFileSync(ASSET_LICENSE_SOURCE, path.join(runtimeDir, 'ASSETS-DeskWidget.md'))

    const imagesDir = path.join(safeReleaseDir, IMAGES_DIR_NAME)
    fs.mkdirSync(imagesDir, { recursive: true })
    fs.copyFileSync(DEFAULT_SAMPLE_IMAGE_SOURCE, path.join(imagesDir, DEFAULT_SAMPLE_IMAGE_NAME))

    fs.copyFileSync(USER_GUIDE_SOURCE, path.join(safeReleaseDir, USER_GUIDE_NAME))

    buildLauncher(path.join(safeReleaseDir, LAUNCHER_NAME))

    return verifyReleaseLayout(safeReleaseDir)
  } catch (error) {
    // 실패 시 releaseDir 자신만 정리한다 — packageApplication()이 만든 다른 dist/ 산출물이나
    // 패키징 원본에는 절대 손대지 않는다(이미 movePackagedApp으로 옮겨졌다면 releaseDir 안에 있으므로 같이 지워진다).
    fs.rmSync(safeReleaseDir, { recursive: true, force: true })
    throw error
  }
}

if (require.main === module) {
  const outputArgument = process.argv[2] || path.join(DIST_ROOT, 'release-win32-x64')
  const releaseDir = path.resolve(outputArgument)
  assembleRelease(releaseDir)
    .then(() => console.log(`release assembled and verified: ${releaseDir}`))
    .catch(error => {
      console.error(error.message)
      process.exitCode = 1
    })
}

module.exports = { assembleRelease, assertReleaseDirIsSafe }
