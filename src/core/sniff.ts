/** Detect image formats and animation from the file's bytes (never trust the extension or `file.type`). */

export type SniffedType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'image/avif' | 'image/heic' | 'image/bmp' | null

const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len))

export function sniffType(b: Uint8Array): SniffedType {
  if (b.length < 12) return null
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'image/png'
  if (ascii(b, 0, 4) === 'GIF8') return 'image/gif'
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp'
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp'
  if (ascii(b, 4, 4) === 'ftyp') {
    const brands = ascii(b, 8, Math.min(32, b.length - 8))
    if (/avi[fs]/.test(brands)) return 'image/avif'
    if (/hei[cxms]|hev[cx]|mif1|msf1/.test(brands)) return 'image/heic'
  }
  return null
}

/** GIF: more than one Graphic Control Extension / image. */
function gifIsAnimated(b: Uint8Array): boolean {
  let frames = 0
  for (let i = 13; i < b.length - 3; i++) {
    // Graphic Control Extension: 0x21 0xF9 0x04
    if (b[i] === 0x21 && b[i + 1] === 0xf9 && b[i + 2] === 0x04 && ++frames > 1) return true
  }
  return false
}

/** PNG: an `acTL` chunk before the first `IDAT` means APNG. */
function pngIsAnimated(b: Uint8Array): boolean {
  let i = 8
  while (i + 8 <= b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
    const type = ascii(b, i + 4, 4)
    if (type === 'acTL') return true
    if (type === 'IDAT') return false
    i += 12 + len
  }
  return false
}

/** WebP: `VP8X` header with the animation flag, or an `ANIM` chunk. */
function webpIsAnimated(b: Uint8Array): boolean {
  if (ascii(b, 12, 4) === 'VP8X') return (b[20] & 0x02) !== 0
  return ascii(b, 12, Math.min(b.length - 12, 64)).includes('ANIM')
}

/** True for animated GIF, APNG and animated WebP. Canvas would keep only the first frame. */
export function isAnimated(b: Uint8Array, type: SniffedType = sniffType(b)): boolean {
  if (type === 'image/gif') return gifIsAnimated(b)
  if (type === 'image/png') return pngIsAnimated(b)
  if (type === 'image/webp') return webpIsAnimated(b)
  return false
}
