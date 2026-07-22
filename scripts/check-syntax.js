'use strict'

const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const files = [
  'main.js',
  'preload.js',
  'widget.js',
  'scripts/assemble-release.js',
  'scripts/build-launcher.js',
  'scripts/check-syntax.js',
  'scripts/package.js',
  'scripts/release-layout.js',
  'src/config-utils.js',
  'src/image-utils.js',
  'src/windows-utils.js',
]

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status || 1)
}

console.log(`syntax ok (${files.length} files)`)
