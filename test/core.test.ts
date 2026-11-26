import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { extractExif, insertExif, readOrientation, resetOrientation } from '../src/core/exif'
import { formatBytes } from '../src/core/format'
import { fitSize, IOS_MAX_PIXELS, searchQuality } from '../src/core/pipeline'
import { isAnimated, sniffType } from '../src/core/sniff'

const bytes = (...parts: Array<string | number[]>) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)))
const pad = (n: number) => new Array(n).fill(0)

describe('sniffType', () => {
  it('detects formats from magic bytes', async () => {
    const jpg = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#f00' } }).jpeg().toBuffer()
    const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#f00' } }).png().toBuffer()
    const webp = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#f00' } }).webp().toBuffer()
    expect(sniffType(jpg)).toBe('image/jpeg')
    expect(sniffType(png)).toBe('image/png')
    expect(sniffType(webp)).toBe('image/webp')
    expect(sniffType(bytes(pad(4), 'ftypheic', pad(8)))).toBe('image/heic')
    expect(sniffType(bytes(pad(4), 'ftypavif', pad(8)))).toBe('image/avif')
    expect(sniffType(bytes('GIF89a', pad(10)))).toBe('image/gif')
    expect(sniffType(bytes('hello world!!'))).toBe(null)
  })
})

describe('isAnimated', () => {
  const gce = [0x21, 0xf9, 0x04, 0, 0, 0, 0, 0]
  it('GIF: one frame vs two', () => {
    expect(isAnimated(bytes('GIF89a', pad(7), gce, pad(10)))).toBe(false)
    expect(isAnimated(bytes('GIF89a', pad(7), gce, pad(10), gce, pad(10)))).toBe(true)
  })
  it('APNG: acTL before IDAT', () => {
    const chunk = (type: string, len = 0) => [0, 0, 0, len, ...[...type].map((c) => c.charCodeAt(0)), ...pad(len + 4)]
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    expect(isAnimated(bytes(sig, chunk('IHDR', 13), chunk('acTL', 8), chunk('IDAT', 2)))).toBe(true)
    expect(isAnimated(bytes(sig, chunk('IHDR', 13), chunk('IDAT', 2)))).toBe(false)
  })
  it('animated WebP via sharp', async () => {
    const frame = (c: string) => sharp({ create: { width: 4, height: 4, channels: 3, background: c } }).png().toBuffer()
    const anim = await sharp([await frame('#f00'), await frame('#0f0')], { join: { animated: true } }).webp().toBuffer()
    const still = await sharp(await frame('#f00')).webp().toBuffer()
    expect(isAnimated(anim)).toBe(true)
    expect(isAnimated(still)).toBe(false)
  })
})

describe('EXIF', () => {
  it('reads, resets and re-inserts orientation', async () => {
    const src = await sharp({ create: { width: 8, height: 4, channels: 3, background: '#08f' } })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Make: 'TestCam' } } })
      .toBuffer()
    expect(readOrientation(src)).toBe(6)
    const app1 = extractExif(src)!
    expect(app1).not.toBeNull()
    const bare = await sharp({ create: { width: 4, height: 8, channels: 3, background: '#08f' } }).jpeg().toBuffer()
    expect(extractExif(bare)).toBeNull()
    const merged = insertExif(bare, resetOrientation(app1))
    expect(readOrientation(merged)).toBe(1)
    const meta = await sharp(Buffer.from(merged)).metadata()
    expect(meta.width).toBe(4)
    expect(meta.exif?.toString('latin1')).toContain('TestCam')
  })
})

describe('fitSize', () => {
  it('fits inside the box without upscaling', () => {
    expect(fitSize(4000, 3000, 1920, 1920, Infinity)).toEqual({ width: 1920, height: 1440 })
    expect(fitSize(800, 600, 1920, 1920, Infinity)).toEqual({ width: 800, height: 600 })
  })
  it('caps the canvas area for iOS', () => {
    const { width, height } = fitSize(8064, 6048, Infinity, Infinity, IOS_MAX_PIXELS)
    expect(width * height).toBeLessThanOrEqual(IOS_MAX_PIXELS)
    expect(width / height).toBeCloseTo(8064 / 6048, 2)
  })
})

describe('searchQuality', () => {
  const fake = (perQuality: number) => async (q: number) => new Blob([new Uint8Array(Math.round(q * perQuality))])
  it('returns the highest quality under the target', async () => {
    const r = await searchQuality(fake(1000), 500, 0.4, 0.9)
    expect(r.fits).toBe(true)
    expect(r.blob.size).toBeLessThanOrEqual(500)
    expect(r.quality).toBeGreaterThan(0.48)
  })
  it('stops after two encodes when the top quality already fits', async () => {
    const r = await searchQuality(fake(100), 500, 0.4, 0.9)
    expect(r).toMatchObject({ quality: 0.9, fits: true, tries: 2 })
  })
  it('reports when even the floor is too big', async () => {
    const r = await searchQuality(fake(10_000), 500, 0.4, 0.9)
    expect(r).toMatchObject({ quality: 0.4, fits: false })
  })
})

describe('formatBytes', () => {
  it('formats', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})

describe('searchQuality efficiency', () => {
  it('converges in few encodes on a realistic curve', async () => {
    // JPEG-ish: size grows faster than linearly near the top.
    const encode = async (q: number) => new Blob([new Uint8Array(Math.round(200_000 * q ** 2.2 + 20_000))])
    const r = await searchQuality(encode, 100_000, 0.4, 0.95)
    expect(r.fits).toBe(true)
    expect(r.blob.size).toBeGreaterThan(90_000)
    expect(r.tries).toBeLessThanOrEqual(6)
  })
  it('costs a single encode when even the floor is too big', async () => {
    const r = await searchQuality(async () => new Blob([new Uint8Array(1000)]), 10, 0.4, 0.9)
    expect(r.tries).toBe(1)
  })
})
