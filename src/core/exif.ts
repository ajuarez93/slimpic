/**
 * Minimal JPEG EXIF handling: copy the APP1/Exif segment from the original into the
 * compressed JPEG, with the Orientation tag reset to 1 (the pixels are already rotated).
 */

/** Returns the whole APP1 "Exif" segment (marker + length + payload), or null. */
export function extractExif(jpeg: Uint8Array): Uint8Array | null {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null
  let i = 2
  while (i + 4 <= jpeg.length && jpeg[i] === 0xff) {
    const marker = jpeg[i + 1]
    if (marker === 0xda || marker === 0xd9) break // start of scan / end of image
    const len = (jpeg[i + 2] << 8) | jpeg[i + 3]
    if (marker === 0xe1 && jpeg[i + 4] === 0x45 && jpeg[i + 5] === 0x78 && jpeg[i + 6] === 0x69 && jpeg[i + 7] === 0x66) {
      return jpeg.slice(i, i + 2 + len)
    }
    i += 2 + len
  }
  return null
}

/** Set the IFD0 Orientation tag (0x0112) of an APP1 segment to 1, in place. */
export function resetOrientation(app1: Uint8Array): Uint8Array {
  const tiff = 10 // FF E1 LL LL "Exif\0\0"
  if (app1.length < tiff + 8) return app1
  const le = app1[tiff] === 0x49 // "II" = little endian
  const u16 = (o: number) => (le ? app1[o] | (app1[o + 1] << 8) : (app1[o] << 8) | app1[o + 1])
  const u32 = (o: number) => (le ? (app1[o] | (app1[o + 1] << 8) | (app1[o + 2] << 16) | (app1[o + 3] << 24)) >>> 0 : ((app1[o] << 24) | (app1[o + 1] << 16) | (app1[o + 2] << 8) | app1[o + 3]) >>> 0)
  const ifd0 = tiff + u32(tiff + 4)
  if (ifd0 + 2 > app1.length) return app1
  const count = u16(ifd0)
  for (let n = 0; n < count; n++) {
    const e = ifd0 + 2 + n * 12
    if (e + 12 > app1.length) break
    if (u16(e) === 0x0112) {
      // SHORT value stored inline in the first two bytes of the value field.
      if (le) {
        app1[e + 8] = 1
        app1[e + 9] = 0
      } else {
        app1[e + 8] = 0
        app1[e + 9] = 1
      }
      break
    }
  }
  return app1
}

/** Insert an APP1 segment into a JPEG that has none (after SOI and an optional APP0/JFIF). */
export function insertExif(jpeg: Uint8Array, app1: Uint8Array): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || extractExif(jpeg)) return jpeg
  let at = 2
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + ((jpeg[4] << 8) | jpeg[5])
  const out = new Uint8Array(jpeg.length + app1.length)
  out.set(jpeg.subarray(0, at), 0)
  out.set(app1, at)
  out.set(jpeg.subarray(at), at + app1.length)
  return out
}

/** Read the EXIF orientation (1–8) of a JPEG, or 1 when absent. */
export function readOrientation(jpeg: Uint8Array): number {
  const app1 = extractExif(jpeg)
  if (!app1) return 1
  const tiff = 10
  const le = app1[tiff] === 0x49
  const u16 = (o: number) => (le ? app1[o] | (app1[o + 1] << 8) : (app1[o] << 8) | app1[o + 1])
  const u32 = (o: number) => (le ? (app1[o] | (app1[o + 1] << 8) | (app1[o + 2] << 16) | (app1[o + 3] << 24)) >>> 0 : ((app1[o] << 24) | (app1[o + 1] << 16) | (app1[o + 2] << 8) | app1[o + 3]) >>> 0)
  const ifd0 = tiff + u32(tiff + 4)
  const count = u16(ifd0)
  for (let n = 0; n < count; n++) {
    const e = ifd0 + 2 + n * 12
    if (u16(e) === 0x0112) return u16(e + 8)
  }
  return 1
}
