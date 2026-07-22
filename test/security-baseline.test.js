'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8')

test('Electron renderer security baseline remains explicit', () => {
  const main = read('main.js')
  const html = read('widget.html')
  assert.match(main, /contextIsolation:\s*true/)
  assert.match(main, /nodeIntegration:\s*false/)
  assert.match(main, /sandbox:\s*true/)
  assert.match(main, /setWindowOpenHandler/)
  assert.match(main, /trustedWidgetForEvent/)
  assert.match(main, /webRequest\.onBeforeRequest/)
  assert.match(html, /Content-Security-Policy/)
  assert.doesNotMatch(html, /<script>\s*/)
})

test('autostart does not default on or persist a PowerShell script', () => {
  const main = read('main.js')
  assert.match(main, /catch \{ return false \}/)
  assert.doesNotMatch(main, /autostart\.ps1|ExecutionPolicy/)
})

test('release dependencies are exact and reproducible', () => {
  const packageJson = JSON.parse(read('package.json'))
  assert.match(packageJson.devDependencies.electron, /^\d+\.\d+\.\d+$/)
  assert.match(packageJson.devDependencies['@electron/packager'], /^\d+\.\d+\.\d+$/)
  assert.equal(typeof packageJson.scripts['package:win'], 'string')
})
