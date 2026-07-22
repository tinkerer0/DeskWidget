'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const APP_FILES = Object.freeze([
  'default-dino.png',
  'main.js',
  'package.json',
  'preload.js',
  'src/config-utils.js',
  'src/image-utils.js',
  'src/windows-utils.js',
  'widget.css',
  'widget.html',
  'widget.js',
])

function resolveInside(base, relativePath) {
  const resolved = path.resolve(base, relativePath)
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error(`Path escapes staging root: ${relativePath}`)
  }
  return resolved
}

function stageApplication(destination) {
  fs.mkdirSync(destination, { recursive: true })

  for (const relativePath of APP_FILES) {
    const source = resolveInside(ROOT, relativePath)
    const sourceStat = fs.lstatSync(source)
    if (!sourceStat.isFile()) throw new Error(`Refusing to package non-regular file: ${relativePath}`)

    const target = resolveInside(destination, relativePath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target)
  }

  return [...APP_FILES]
}

function listFiles(directory, base = directory) {
  const result = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...listFiles(fullPath, base))
    else if (entry.isFile()) result.push(path.relative(base, fullPath).split(path.sep).join('/'))
    else throw new Error(`Unexpected staged entry: ${entry.name}`)
  }
  return result.sort()
}

function verifyStage(directory) {
  const actual = listFiles(directory)
  const expected = [...APP_FILES].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Staging allowlist mismatch: ${JSON.stringify(actual)}`)
  }
  return actual
}

function readOption(name, fallback) {
  const prefix = `--${name}=`
  const argument = process.argv.find(value => value.startsWith(prefix))
  return argument ? argument.slice(prefix.length) : fallback
}

async function packageApplication() {
  const platform = readOption('platform', 'win32')
  const arch = readOption('arch', 'x64')
  if (platform !== 'win32') throw new Error(`Unsupported platform: ${platform}`)
  if (!['x64', 'arm64'].includes(arch)) throw new Error(`Unsupported architecture: ${arch}`)

  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deskwidget-package-'))
  const stagedApp = path.join(stagingRoot, 'app')
  try {
    stageApplication(stagedApp)
    const files = verifyStage(stagedApp)

    if (process.argv.includes('--verify-only')) {
      console.log(`package allowlist ok (${files.length} files)`)
      return []
    }

    const { packager } = require('@electron/packager')
    const electronVersion = require('electron/package.json').version
    const appPaths = await packager({
      dir: stagedApp,
      name: 'DeskWidget',
      out: path.join(ROOT, 'dist'),
      platform,
      arch,
      electronVersion,
      asar: true,
      junk: true,
      overwrite: true,
      prune: true,
    })
    console.log(`packaged ${appPaths.length} app(s)`)
    return appPaths
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true })
  }
}

if (require.main === module) {
  packageApplication().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}

module.exports = { APP_FILES, ROOT, listFiles, packageApplication, stageApplication, verifyStage }
