'use strict'

const {
  MAX_WINDOW_DIMENSION,
  MIN_WINDOW_DIMENSION,
  dimensionsForWidth,
  isSupportedFilename,
} = require('./image-utils')

const MAX_ABSOLUTE_COORDINATE = 1_000_000
const MAX_ABSOLUTE_Z = 1_000_000

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finiteInteger(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(min, Math.min(max, Math.round(value)))
}

function isSafeConfigFilename(filename) {
  return typeof filename === 'string' && filename.length > 0 && filename.length <= 255 &&
    !filename.includes('/') && !filename.includes('\\') && !filename.includes('\0') &&
    isSupportedFilename(filename)
}

function normalizeWidgetState(value) {
  if (!isRecord(value)) return null

  const normalized = {}
  const x = finiteInteger(value.x, -MAX_ABSOLUTE_COORDINATE, MAX_ABSOLUTE_COORDINATE)
  const y = finiteInteger(value.y, -MAX_ABSOLUTE_COORDINATE, MAX_ABSOLUTE_COORDINATE)
  const width = finiteInteger(value.width, MIN_WINDOW_DIMENSION, MAX_WINDOW_DIMENSION)
  const z = finiteInteger(value.z, -MAX_ABSOLUTE_Z, MAX_ABSOLUTE_Z)

  if (x !== null) normalized.x = x
  if (y !== null) normalized.y = y
  if (width !== null) normalized.width = width
  if (z !== null) normalized.z = z
  return normalized
}

function normalizeConfig(value) {
  const normalized = Object.create(null)
  if (!isRecord(value)) return normalized

  for (const [filename, state] of Object.entries(value)) {
    if (!isSafeConfigFilename(filename)) continue
    const cleanState = normalizeWidgetState(state)
    if (cleanState) normalized[filename] = cleanState
  }
  return normalized
}

function boundsFromSavedState(state, aspect) {
  if (!isRecord(state)) return null
  const x = finiteInteger(state.x, -MAX_ABSOLUTE_COORDINATE, MAX_ABSOLUTE_COORDINATE)
  const y = finiteInteger(state.y, -MAX_ABSOLUTE_COORDINATE, MAX_ABSOLUTE_COORDINATE)
  const width = finiteInteger(state.width, MIN_WINDOW_DIMENSION, MAX_WINDOW_DIMENSION)
  if (x === null || y === null || width === null) return null

  const dimensions = dimensionsForWidth(width, aspect)
  return { x, y, ...dimensions }
}

module.exports = {
  MAX_ABSOLUTE_COORDINATE,
  MAX_ABSOLUTE_Z,
  boundsFromSavedState,
  isSafeConfigFilename,
  normalizeConfig,
  normalizeWidgetState,
}
