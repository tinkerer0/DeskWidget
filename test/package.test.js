'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { APP_FILES, stageApplication, verifyStage } = require('../scripts/package')

test('packaging uses an exact allowlist and excludes personal/runtime files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskwidget-stage-test-'))
  try {
    stageApplication(directory)
    assert.deepEqual(verifyStage(directory), [...APP_FILES].sort())
    assert.equal(APP_FILES.includes('사진을 넣으면 위젯이 됩니다'), false)
    assert.equal(APP_FILES.includes('.env'), false)
    assert.equal(APP_FILES.includes('README.md'), false)
    assert.equal(APP_FILES.some(file => file.startsWith('test/')), false)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
