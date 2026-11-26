import type { Decoder } from './core/compress'

/**
 * HEIC/HEIF decoder for browsers that cannot open iPhone photos (everything but Safari).
 * Uses the optional peer dependency `heic-to` (libheif in WebAssembly, loaded on demand).
 *
 *   import { heicDecoder } from 'picpress/heic'
 *   compress(file, { decoders: [heicDecoder()] })
 */
export function heicDecoder(options: { quality?: number } = {}): Decoder {
  return async (file, type) => {
    if (type !== 'image/heic') return null
    // Safari decodes HEIC natively; skip the 1 MB+ WASM there.
    if (typeof createImageBitmap === 'function') {
      try {
        ;(await createImageBitmap(file)).close()
        return file
      } catch {
        /* not natively supported: use libheif */
      }
    }
    let mod: { heicTo: (o: { blob: Blob; type: string; quality?: number }) => Promise<Blob> }
    try {
      mod = (await import('heic-to')) as typeof mod
    } catch {
      throw new Error('picpress/heic needs the optional dependency "heic-to" (npm install heic-to)')
    }
    return mod.heicTo({ blob: file, type: 'image/png', quality: options.quality })
  }
}
