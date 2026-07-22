'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { buildAutostartScript, powershellSingleQuoted } = require('../src/windows-utils')

test('PowerShell single-quoted paths escape apostrophes', () => {
  assert.equal(
    powershellSingleQuoted("C:\\Users\\O'Brien\\DeskWidget.exe"),
    "'C:\\Users\\O''Brien\\DeskWidget.exe'",
  )
})

test('autostart script uses only literal fixed shortcut operations', () => {
  const enabled = buildAutostartScript(true, "C:\\Users\\O'Brien\\DeskWidget.exe")
  assert.match(enabled, /TargetPath='C:\\Users\\O''Brien\\DeskWidget\.exe'/)
  assert.doesNotMatch(enabled, /ExecutionPolicy|Invoke-Expression|Start-Process/)

  const disabled = buildAutostartScript(false, 'C:\\DeskWidget\\DeskWidget.exe')
  assert.match(disabled, /Remove-Item -LiteralPath \$p -Force/)
})
