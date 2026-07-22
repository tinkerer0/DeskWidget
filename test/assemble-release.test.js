'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { ROOT } = require('../scripts/package')
const { assembleRelease, assertReleaseDirIsSafe } = require('../scripts/assemble-release')

const DIST_ROOT = path.join(ROOT, 'dist')

test('a normal dist subdirectory is accepted as a release directory', () => {
  const safe = assertReleaseDirIsSafe(path.join(DIST_ROOT, 'release-win32-x64'))
  assert.equal(safe, path.resolve(DIST_ROOT, 'release-win32-x64'))
})

test('a nested dist subdirectory is accepted', () => {
  assertReleaseDirIsSafe(path.join(DIST_ROOT, 'nested', 'release'))
})

test('dist itself is rejected as a release directory (would wipe all packaging output)', () => {
  assert.throws(() => assertReleaseDirIsSafe(DIST_ROOT), /strict descendant/)
})

test('the repository root is rejected as a release directory', () => {
  assert.throws(() => assertReleaseDirIsSafe(ROOT), /strict descendant/)
})

test('a "dist/.." escape is rejected', () => {
  assert.throws(() => assertReleaseDirIsSafe(path.join(DIST_ROOT, '..')), /strict descendant/)
  assert.throws(() => assertReleaseDirIsSafe(path.join(DIST_ROOT, '..', '..', 'etc')), /strict descendant/)
})

test('an absolute path entirely outside the repository is rejected', () => {
  assert.throws(() => assertReleaseDirIsSafe('/etc/deskwidget-release'), /strict descendant/)
  assert.throws(() => assertReleaseDirIsSafe(require('node:os').tmpdir()), /strict descendant/)
})

test('a sibling directory that merely shares the "dist" prefix is rejected, not matched by string prefix', () => {
  assert.throws(() => assertReleaseDirIsSafe(`${DIST_ROOT}-evil`), /strict descendant/)
})

test('a release directory reached through a symlinked ancestor is rejected (reported bypass regression)', () => {
  fs.mkdirSync(DIST_ROOT, { recursive: true })
  const externalTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'deskwidget-ancestor-link-target-'))
  const linkPath = path.join(DIST_ROOT, '.ancestor-link-test')
  try {
    fs.symlinkSync(externalTarget, linkPath, 'dir')
  } catch (_error) {
    // 심볼릭 링크 생성에 권한이 필요한 환경(Windows non-elevated 등)에서는 이 검사를 건너뛴다.
    fs.rmSync(externalTarget, { recursive: true, force: true })
    return
  }
  try {
    assert.throws(
      () => assertReleaseDirIsSafe(path.join(linkPath, 'release')),
      /symlink\/junction\/reparse point/,
    )
  } finally {
    fs.rmSync(linkPath, { force: true })
    fs.rmSync(externalTarget, { recursive: true, force: true })
  }
})

test('assembleRelease itself refuses an unsafe release directory before touching the filesystem', async () => {
  await assert.rejects(() => assembleRelease(ROOT), /strict descendant/)
})

test('assembleRelease refuses to run on a non-Windows platform', { skip: process.platform === 'win32' }, async () => {
  await assert.rejects(
    () => assembleRelease(path.join(DIST_ROOT, 'release-win32-x64')),
    /requires Windows/,
  )
})
