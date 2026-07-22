'use strict'

const path = require('path')

function powershellSingleQuoted(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function buildAutostartScript(enabled, executablePath) {
  if (typeof executablePath !== 'string' || executablePath.length === 0 || executablePath.includes('\0')) {
    throw new TypeError('A valid executable path is required')
  }

  const shortcut = "(Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Startup\\DeskWidget.lnk')"
  if (!enabled) return `$p=${shortcut}; if(Test-Path -LiteralPath $p){Remove-Item -LiteralPath $p -Force}`

  return [
    `$p=${shortcut}`,
    '$s=(New-Object -ComObject WScript.Shell).CreateShortcut($p)',
    `$s.TargetPath=${powershellSingleQuoted(executablePath)}`,
    `$s.WorkingDirectory=${powershellSingleQuoted(path.dirname(executablePath))}`,
    '$s.Save()',
  ].join('; ')
}

module.exports = { buildAutostartScript, powershellSingleQuoted }
