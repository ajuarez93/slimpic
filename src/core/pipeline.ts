/**
 * The compression pipeline. Runs unchanged in a Web Worker (OffscreenCanvas) or on the main
 * thread (OffscreenCanvas or <canvas>). Everything environment-specific goes through `Env`.
 */

export type OutputType = 'image/jpeg' | 'image/webp' | 'image/avif' | 'image/png'

export interface PipelineOptions {
  maxWidth: number
  maxHeight: number
  /** Target size in bytes (0 = no target). */
  maxSize: number
  type: OutputType
  quality: number
  minQuality: number
  /** Never let canvases exceed this many pixels (iOS Safari draws black above ~16.7 MP). */
  maxPixels: number
  /** Never shrink dimensions to reach `maxSize`; only lower quality. */
  keepResolution: boolean
  /** Fill for transparent pixels when the output has no alpha (JPEG). */
  background: string
  maxIterations: number
}

export interface PipelineResult {
  blob: Blob
  width: number
  height: number
  /** The type actually produced (may differ from the requested one if the browser cannot encode it). */
  type: string
  quality: number | null
  /** Whether `maxSize` was reached (always true without a target). */
  targetMet: boolean
  iterations: number
  /** Decoded (orientation-corrected) size of the input. */
  srcWidth: number
  srcHeight: number
}

export interface Surface {
  width: number
  height: number
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  encode(type: string, quality?: number): Promise<Blob>
  release(): void
}

export interface Env {
  decode(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close(): void }>
  surface(width: number, height: number): Surface
}

/** iOS Safari's canvas area limit (4096 × 4096). */
export const IOS_MAX_PIXELS = 16_777_216

const LOSSLESS = new Set(['image/png'])
const FALLBACKS: Record<string, string[]> = {
  'image/avif': ['image/avif', 'image/webp', 'image/jpeg'],
  'image/webp': ['image/webp', 'image/jpeg'],
  'image/jpeg': ['image/jpeg'],
  'image/png': ['image/png'],
}

/** Fit `w × h` inside `maxW × maxH` and `maxPixels`, never upscaling. */
export function fitSize(w: number, h: number, maxW: number, maxH: number, maxPixels: number): { width: number; height: number } {
  let s = Math.min(1, maxW / w, maxH / h)
  if (w * h * s * s > maxPixels) s = Math.sqrt(maxPixels / (w * h))
  return { width: Math.max(1, Math.floor(w * s)), height: Math.max(1, Math.floor(h * s)) }
}

/**
 * Highest quality in [lo, hi] whose encoding fits `max` bytes.
 *
 * Tries the floor first, so an image that is far too big costs a single encode before the
 * caller shrinks it. Then interpolates between the sizes seen (size grows roughly linearly
 * with quality over short ranges), which converges in 2–4 encodes instead of ~8 bisections,
 * and stops as soon as a result lands within `tolerance` below the target.
 */
export async function searchQuality(
  encode: (q: number) => Promise<Blob>,
  max: number,
  lo: number,
  hi: number,
  steps = 5,
  tolerance = 0.08,
): Promise<{ blob: Blob; quality: number; fits: boolean; tries: number }> {
  let tries = 1
  const bottom = await encode(lo)
  if (bottom.size > max) return { blob: bottom, quality: lo, fits: false, tries }
  if (hi <= lo) return { blob: bottom, quality: lo, fits: true, tries }
  const top = await encode(hi)
  tries++
  if (top.size <= max) return { blob: top, quality: hi, fits: true, tries }
  let best = { blob: bottom, quality: lo }
  let a = lo
  let sa = bottom.size
  let b = hi
  let sb = top.size
  const goal = max * (1 - tolerance / 2)
  for (let i = 0; i < steps && b - a > 0.01; i++) {
    const span = b - a
    const guess = a + ((goal - sa) / (sb - sa || 1)) * span
    const q = Math.min(b - span * 0.1, Math.max(a + span * 0.1, guess))
    const blob = await encode(q)
    tries++
    if (blob.size <= max) {
      best = { blob, quality: q }
      if (blob.size >= max * (1 - tolerance)) break
      a = q
      sa = blob.size
    } else {
      b = q
      sb = blob.size
    }
  }
  return { ...best, fits: true, tries }
}

function render(env: Env, img: { source: CanvasImageSource; width: number; height: number }, w: number, h: number, background: string | null): Surface {
  // Halve repeatedly first: one big downscale with bilinear smoothing looks aliased.
  let src: CanvasImageSource = img.source
  let sw = img.width
  let sh = img.height
  let temp: Surface | null = null
  while (sw / 2 >= w * 1.5 && sh / 2 >= h * 1.5) {
    const nw = Math.round(sw / 2)
    const nh = Math.round(sh / 2)
    const next = env.surface(nw, nh)
    next.ctx.imageSmoothingQuality = 'high'
    next.ctx.drawImage(src, 0, 0, nw, nh)
    temp?.release()
    temp = next
    src = (next.ctx as CanvasRenderingContext2D).canvas as CanvasImageSource
    sw = nw
    sh = nh
  }
  const out = env.surface(w, h)
  if (background) {
    out.ctx.fillStyle = background
    out.ctx.fillRect(0, 0, w, h)
  }
  out.ctx.imageSmoothingQuality = 'high'
  out.ctx.drawImage(src, 0, 0, w, h)
  temp?.release()
  return out
}

/** Encode, falling back (avif → webp → jpeg) when the browser silently returns another type. */
async function encodeAs(s: Surface, type: string, quality: number): Promise<Blob> {
  let last: Blob | null = null
  for (const t of FALLBACKS[type] ?? [type]) {
    const blob = await s.encode(t, LOSSLESS.has(t) ? undefined : quality)
    if (blob.type === t) return blob
    last = blob
  }
  if (!last || !last.size) throw new Error('ENCODE_FAILED')
  return last
}

export async function runPipeline(
  env: Env,
  input: Blob,
  o: PipelineOptions,
  progress: (pct: number) => void = () => {},
): Promise<PipelineResult> {
  const img = await env.decode(input)
  progress(10)
  try {
    const fit = fitSize(img.width, img.height, o.maxWidth, o.maxHeight, o.maxPixels)
    const background = o.type === 'image/jpeg' ? o.background : null
    let { width, height } = fit
    let best: PipelineResult | null = null
    let iterations = 0

    for (let round = 0; round < Math.max(1, o.maxIterations); round++) {
      const surface = render(env, img, width, height, background)
      try {
        let blob: Blob
        let quality: number | null
        let fits: boolean
        if (!o.maxSize) {
          blob = await encodeAs(surface, o.type, o.quality)
          quality = LOSSLESS.has(blob.type) ? null : o.quality
          fits = true
          iterations++
        } else if (LOSSLESS.has(o.type)) {
          blob = await encodeAs(surface, o.type, 1)
          quality = null
          fits = blob.size <= o.maxSize
          iterations++
        } else {
          let produced: string = o.type
          const r = await searchQuality(
            async (q) => {
              const b = await encodeAs(surface, o.type, q)
              produced = b.type
              return b
            },
            o.maxSize,
            o.minQuality,
            o.quality,
          )
          blob = r.blob
          quality = LOSSLESS.has(produced) ? null : r.quality
          fits = r.fits
          iterations += r.tries
        }
        const result: PipelineResult = { blob, width, height, type: blob.type, quality, targetMet: fits, iterations, srcWidth: img.width, srcHeight: img.height }
        if (!best || fits || blob.size < best.blob.size) best = result
        progress(Math.min(95, 20 + round * 15))
        if (fits || o.keepResolution) break
        // Shrink in proportion to how far off we are (area scales with the square).
        const s = Math.max(0.5, Math.min(0.9, Math.sqrt(o.maxSize / blob.size) * 0.95))
        const nw = Math.floor(width * s)
        const nh = Math.floor(height * s)
        if (nw < 16 || nh < 16) break
        width = nw
        height = nh
      } finally {
        surface.release()
      }
    }
    progress(100)
    return { ...best!, iterations }
  } finally {
    img.close()
  }
}

/** Env backed by OffscreenCanvas + createImageBitmap (Web Worker, or modern main thread). */
export function offscreenEnv(): Env {
  return {
    async decode(blob) {
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() }
    },
    surface(width, height) {
      const canvas = new OffscreenCanvas(width, height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('NO_CANVAS')
      return {
        width,
        height,
        ctx,
        encode: (type, quality) => canvas.convertToBlob({ type, quality }),
        release() {
          // Zero-size canvases free their backing store right away (iOS keeps them otherwise).
          canvas.width = 0
          canvas.height = 0
        },
      }
    },
  }
}

/** Env for browsers without OffscreenCanvas 2D: <img> + <canvas>. */
export function domEnv(): Env {
  return {
    async decode(blob) {
      if (typeof createImageBitmap === 'function') {
        try {
          const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
          return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() }
        } catch {
          /* fall through to <img> */
        }
      }
      const url = URL.createObjectURL(blob)
      const img = new Image()
      img.src = url
      try {
        await img.decode()
      } catch {
        URL.revokeObjectURL(url)
        throw new Error('DECODE_FAILED')
      }
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) }
    },
    surface(width, height) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('NO_CANVAS')
      return {
        width,
        height,
        ctx,
        encode: (type, quality) =>
          new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('ENCODE_FAILED'))), type, quality)),
        release() {
          canvas.width = 0
          canvas.height = 0
        },
      }
    },
  }
}

/** True when this context can run `offscreenEnv` (2D OffscreenCanvas with encoding). */
export function canUseOffscreen(): boolean {
  try {
    return (
      typeof OffscreenCanvas !== 'undefined' &&
      typeof createImageBitmap === 'function' &&
      !!new OffscreenCanvas(1, 1).getContext('2d') &&
      typeof OffscreenCanvas.prototype.convertToBlob === 'function'
    )
  } catch {
    return false
  }
}
