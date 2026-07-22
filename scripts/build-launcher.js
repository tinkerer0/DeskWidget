'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const LAUNCHER_SOURCE = path.join(ROOT, 'launcher', 'launcher.cs')

// 지원 대상 Windows 빌드 환경(대부분의 Windows 10/11, GitHub Actions windows-latest 러너 포함)은
// .NET Framework(csc.exe)를 이 고정 경로에 두는 경우가 흔하다 — 그러나 "항상 있다"고 가정하지 않고
// 못 찾으면 명확한 에러로 빌드를 실패시킨다(호출부 buildLauncher() 참고). Roslyn 기반 csc.exe(빌드
// 도구에 포함)가 있으면 그것도 허용 — 어느 쪽이든 소스는 C# 5 문법만 쓴다.
function findCsc() {
  const windir = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
  const candidates = [
    path.join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  const located = spawnSync('where', ['csc.exe'], { encoding: 'utf8' })
  if (located.status === 0 && located.stdout) {
    const first = located.stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean)
    if (first) return first
  }
  return null
}

function buildLauncher(outputPath) {
  if (process.platform !== 'win32') {
    throw new Error('launcher build requires Windows (csc.exe) — cannot run on this platform')
  }

  const csc = findCsc()
  if (!csc) throw new Error('csc.exe not found on this Windows machine — install the .NET Framework developer pack or run this on a build environment that has it')

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  if (fs.existsSync(outputPath)) fs.rmSync(outputPath)

  const result = spawnSync(csc, [
    '/nologo',
    '/target:winexe',
    '/platform:anycpu',
    '/optimize+',
    `/out:${outputPath}`,
    LAUNCHER_SOURCE,
  ], { cwd: ROOT, encoding: 'utf8' })

  if (result.status !== 0) {
    throw new Error(`csc.exe failed (exit ${result.status}): ${result.stdout || ''}${result.stderr || ''}`)
  }
  if (!fs.existsSync(outputPath)) throw new Error(`csc.exe did not produce: ${outputPath}`)
  return outputPath
}

if (require.main === module) {
  const outputArgument = process.argv[2]
  if (!outputArgument) {
    console.error('usage: node scripts/build-launcher.js <output-exe-path>')
    process.exitCode = 1
  } else {
    try {
      const outputPath = buildLauncher(path.resolve(outputArgument))
      console.log(`launcher built: ${outputPath}`)
    } catch (error) {
      console.error(error.message)
      process.exitCode = 1
    }
  }
}

module.exports = { LAUNCHER_SOURCE, buildLauncher, findCsc }
