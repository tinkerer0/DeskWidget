'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  MAX_IMAGE_BYTES,
  MAX_WINDOW_DIMENSION,
  MIN_WINDOW_DIMENSION,
  inspectImageFile,
  isSafeSourceDimensions,
  parseImageDimensions,
  sizeForAspect,
} = require('../src/image-utils')

const root = path.resolve(__dirname, '..')

test('bundled PNG assets have safe dimensions', () => {
  for (const filename of ['default-dino.png']) {
    const inspected = inspectImageFile(path.join(root, filename))
    assert.equal(inspected.ok, true, `${filename}: ${inspected.reason || 'unknown error'}`)
    assert.equal(inspected.format, 'png')
  }
})

test('crafted VP8X dimensions are rejected and never expand window bounds', () => {
  const buffer = Buffer.alloc(30)
  buffer.write('RIFF', 0, 'ascii')
  buffer.write('WEBP', 8, 'ascii')
  buffer.write('VP8X', 12, 'ascii')
  buffer[27] = 0xff
  buffer[28] = 0xff
  buffer[29] = 0xff

  const dimensions = parseImageDimensions(buffer)
  assert.deepEqual(dimensions, { format: 'webp', width: 1, height: 16_777_216 })
  assert.equal(isSafeSourceDimensions(dimensions), false)

  const windowSize = sizeForAspect(200, dimensions.height / dimensions.width)
  assert.equal(windowSize.width, MIN_WINDOW_DIMENSION)
  assert.equal(windowSize.height, 200)
  assert.ok(windowSize.height <= MAX_WINDOW_DIMENSION)
})

test('normal aspect ratios preserve expected shape', () => {
  assert.deepEqual(sizeForAspect(200, 0.5), { width: 200, height: 100 })
  assert.deepEqual(sizeForAspect(200, 2), { width: 100, height: 200 })
  assert.deepEqual(sizeForAspect(200, Number.POSITIVE_INFINITY), { width: 200, height: 200 })
})

test('GIF and JPEG header parsers read dimensions without decoding pixels', () => {
  const gif = Buffer.alloc(10)
  gif.write('GIF89a', 0, 'ascii')
  gif.writeUInt16LE(320, 6)
  gif.writeUInt16LE(180, 8)
  assert.deepEqual(parseImageDimensions(gif), { format: 'gif', width: 320, height: 180 })

  const jpeg = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    0x00, 0xb4,
    0x01, 0x40,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ])
  assert.deepEqual(parseImageDimensions(jpeg), { format: 'jpeg', width: 320, height: 180 })
})

test('small lossless WebP headers are accepted without requiring a 30-byte buffer', () => {
  const webp = Buffer.alloc(25)
  webp.write('RIFF', 0, 'ascii')
  webp.write('WEBP', 8, 'ascii')
  webp.write('VP8L', 12, 'ascii')
  webp[20] = 0x2f
  assert.deepEqual(parseImageDimensions(webp), { format: 'webp', width: 1, height: 1 })
})

test('a file with an image extension but non-image content is rejected', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskwidget-image-test-'))
  try {
    const filename = path.join(directory, 'not-an-image.png')
    fs.writeFileSync(filename, '<script>alert(1)</script>', 'utf8')
    assert.deepEqual(inspectImageFile(filename), { ok: false, reason: 'unsupported-or-corrupt-image' })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('oversized files are rejected before image parsing', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deskwidget-large-image-test-'))
  try {
    const filename = path.join(directory, 'oversized.png')
    fs.closeSync(fs.openSync(filename, 'w'))
    fs.truncateSync(filename, MAX_IMAGE_BYTES + 1)
    assert.deepEqual(inspectImageFile(filename), { ok: false, reason: 'file-too-large' })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('header parser does not throw on deterministic malformed input', () => {
  let state = 0x12345678
  for (let index = 0; index < 1_000; index += 1) {
    const length = index % 96
    const buffer = Buffer.alloc(length)
    for (let offset = 0; offset < length; offset += 1) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      buffer[offset] = state & 0xff
    }
    assert.doesNotThrow(() => parseImageDimensions(buffer))
  }
})
