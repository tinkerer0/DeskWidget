'use strict'

const fs = require('fs')
const path = require('path')

const IMAGE_EXTENSIONS = Object.freeze(['.png', '.gif', '.webp', '.jpg', '.jpeg'])
const IMAGE_EXTENSION_SET = new Set(IMAGE_EXTENSIONS)

const MAX_IMAGE_BYTES = 50 * 1024 * 1024
const MAX_SOURCE_DIMENSION = 16_384
const MAX_SOURCE_PIXELS = 64_000_000
const MIN_WINDOW_DIMENSION = 48
const MAX_WINDOW_DIMENSION = 1_400
const DEFAULT_WINDOW_DIMENSION = 200

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
])

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function isSupportedFilename(filename) {
  return typeof filename === 'string' && IMAGE_EXTENSION_SET.has(path.extname(filename).toLowerCase())
}

function parsePng(buffer) {
  if (buffer.length < 24) return null
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!buffer.subarray(0, 8).equals(signature) || buffer.toString('ascii', 12, 16) !== 'IHDR') return null
  return { format: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function parseGif(buffer) {
  if (buffer.length < 10) return null
  const header = buffer.toString('ascii', 0, 6)
  if (header !== 'GIF87a' && header !== 'GIF89a') return null
  return { format: 'gif', width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16)
}

function parseWebp(buffer) {
  if (buffer.length < 16) return null
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null

  const chunk = buffer.toString('ascii', 12, 16)
  if (chunk === 'VP8X') {
    if (buffer.length < 30) return null
    return {
      format: 'webp',
      width: readUInt24LE(buffer, 24) + 1,
      height: readUInt24LE(buffer, 27) + 1,
    }
  }

  if (chunk === 'VP8 ') {
    if (buffer.length < 30) return null
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) return null
    return {
      format: 'webp',
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    }
  }

  if (chunk === 'VP8L') {
    if (buffer.length < 25) return null
    if (buffer[20] !== 0x2f) return null
    const bits = buffer.readUInt32LE(21)
    return {
      format: 'webp',
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    }
  }

  return null
}

function parseJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null

  let offset = 2
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }

    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1
    if (offset >= buffer.length) return null

    const marker = buffer[offset]
    offset += 1

    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
    if (marker === 0xd9 || marker === 0xda || offset + 1 >= buffer.length) return null

    const segmentLength = buffer.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > buffer.length) return null

    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 7) return null
      return {
        format: 'jpeg',
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
      }
    }

    offset += segmentLength
  }

  return null
}

function parseImageDimensions(buffer) {
  if (!Buffer.isBuffer(buffer)) return null
  return parsePng(buffer) || parseGif(buffer) || parseWebp(buffer) || parseJpeg(buffer)
}

function isSafeSourceDimensions(dimensions) {
  if (!dimensions) return false
  const { width, height } = dimensions
  return Number.isInteger(width) && Number.isInteger(height) &&
    width > 0 && height > 0 &&
    width <= MAX_SOURCE_DIMENSION && height <= MAX_SOURCE_DIMENSION &&
    width * height <= MAX_SOURCE_PIXELS
}

function normalizeAspect(aspect) {
  if (!Number.isFinite(aspect) || aspect <= 0) return 1
  const minAspect = MIN_WINDOW_DIMENSION / MAX_WINDOW_DIMENSION
  const maxAspect = MAX_WINDOW_DIMENSION / MIN_WINDOW_DIMENSION
  return clamp(aspect, minAspect, maxAspect)
}

function dimensionsForWidth(width, aspect) {
  const safeWidth = clamp(Math.round(width), MIN_WINDOW_DIMENSION, MAX_WINDOW_DIMENSION)
  const safeHeight = clamp(
    Math.round(safeWidth * normalizeAspect(aspect)),
    MIN_WINDOW_DIMENSION,
    MAX_WINDOW_DIMENSION,
  )
  return { width: safeWidth, height: safeHeight }
}

function sizeForAspect(maxLength, aspect) {
  const safeMax = clamp(Math.round(maxLength), MIN_WINDOW_DIMENSION, MAX_WINDOW_DIMENSION)
  const safeAspect = normalizeAspect(aspect)
  const dimensions = safeAspect >= 1
    ? { width: Math.round(safeMax / safeAspect), height: safeMax }
    : { width: safeMax, height: Math.round(safeMax * safeAspect) }

  return {
    width: clamp(dimensions.width, MIN_WINDOW_DIMENSION, MAX_WINDOW_DIMENSION),
    height: clamp(dimensions.height, MIN_WINDOW_DIMENSION, MAX_WINDOW_DIMENSION),
  }
}

function readFileBounded(filePath) {
  const linkStat = fs.lstatSync(filePath)
  if (!linkStat.isFile()) return { ok: false, reason: 'not-regular-file' }

  const fd = fs.openSync(filePath, 'r')
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile()) return { ok: false, reason: 'not-regular-file' }
    if (stat.size <= 0) return { ok: false, reason: 'empty-file' }
    if (stat.size > MAX_IMAGE_BYTES) return { ok: false, reason: 'file-too-large' }

    const buffer = Buffer.allocUnsafe(stat.size)
    let offset = 0
    while (offset < stat.size) {
      const bytesRead = fs.readSync(fd, buffer, offset, stat.size - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset !== stat.size) return { ok: false, reason: 'short-read' }

    return { ok: true, buffer, stat }
  } finally {
    fs.closeSync(fd)
  }
}

function inspectImageFile(filePath) {
  if (!isSupportedFilename(path.basename(filePath))) return { ok: false, reason: 'unsupported-extension' }

  try {
    const read = readFileBounded(filePath)
    if (!read.ok) return read

    const dimensions = parseImageDimensions(read.buffer)
    if (!dimensions) return { ok: false, reason: 'unsupported-or-corrupt-image' }
    if (!isSafeSourceDimensions(dimensions)) return { ok: false, reason: 'unsafe-dimensions' }

    return {
      ok: true,
      ...dimensions,
      aspect: normalizeAspect(dimensions.height / dimensions.width),
      bytes: read.stat.size,
      signature: `${read.stat.size}:${Math.trunc(read.stat.mtimeMs)}:${dimensions.width}x${dimensions.height}`,
    }
  } catch (error) {
    return { ok: false, reason: error && error.code ? error.code : 'read-error' }
  }
}

module.exports = {
  DEFAULT_WINDOW_DIMENSION,
  IMAGE_EXTENSIONS,
  MAX_IMAGE_BYTES,
  MAX_SOURCE_DIMENSION,
  MAX_SOURCE_PIXELS,
  MAX_WINDOW_DIMENSION,
  MIN_WINDOW_DIMENSION,
  dimensionsForWidth,
  inspectImageFile,
  isSafeSourceDimensions,
  isSupportedFilename,
  normalizeAspect,
  parseImageDimensions,
  sizeForAspect,
}
