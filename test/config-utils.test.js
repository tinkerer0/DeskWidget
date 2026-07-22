'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  boundsFromSavedState,
  normalizeConfig,
  normalizeWidgetState,
} = require('../src/config-utils')

test('null, arrays, and path-like config keys cannot crash or escape the image folder', () => {
  assert.deepEqual({ ...normalizeConfig(null) }, {})
  assert.deepEqual({ ...normalizeConfig([]) }, {})

  const normalized = normalizeConfig({
    '../secret.png': { x: 1, y: 2, width: 100 },
    'safe.png': { x: 1, y: 2, width: 100 },
  })
  assert.deepEqual({ ...normalized }, { 'safe.png': { x: 1, y: 2, width: 100 } })
})

test('widget state accepts only bounded finite numbers', () => {
  assert.deepEqual(normalizeWidgetState({ x: '1', y: null, width: -5, z: Number.NaN }), { width: 48 })
  assert.deepEqual(normalizeWidgetState({ x: 1.2, y: -2.8, width: 99999, z: 99999999 }), {
    x: 1,
    y: -3,
    width: 1400,
    z: 1000000,
  })
})

test('saved bounds require x, y, and width and clamp derived height', () => {
  assert.equal(boundsFromSavedState({ x: 1, width: 200 }, 1), null)
  assert.deepEqual(boundsFromSavedState({ x: 1, y: 2, width: 200 }, 100000), {
    x: 1,
    y: 2,
    width: 200,
    height: 1400,
  })
})
