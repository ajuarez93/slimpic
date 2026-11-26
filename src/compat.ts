/**
 * Drop-in replacement for `browser-image-compression`:
 *
 *   - import imageCompression from 'browser-image-compression'
 *   + import imageCompression from 'picpress/compat'
 *
 * Same options and return value (a File). Differences: never loads anything from a CDN
 * (`libURL` is ignored), keeps animated GIFs intact, errors are real `Error`s.
 */
import { compress, type OutputType } from './core/compress'

export interface Options {
  maxSizeMB?: number
  maxWidthOrHeight?: number
  useWebWorker?: boolean
  libURL?: string
  preserveExif?: boolean
  signal?: AbortSignal
  maxIteration?: number
  exifOrientation?: number
  onProgress?: (progress: number) => void
  fileType?: string
  initialQuality?: number
  alwaysKeepResolution?: boolean
}

async function imageCompression(file: File, options: Options = {}): Promise<File> {
  const max = options.maxWidthOrHeight
  const result = await compress(file, {
    maxSize: options.maxSizeMB && Number.isFinite(options.maxSizeMB) ? Math.floor(options.maxSizeMB * 1024 * 1024) : undefined,
    maxWidth: max,
    maxHeight: max,
    worker: options.useWebWorker ?? true,
    keepExif: options.preserveExif,
    signal: options.signal,
    maxIterations: options.maxIteration ?? 10,
    onProgress: options.onProgress,
    type: (options.fileType as OutputType | undefined) ?? 'auto',
    quality: options.initialQuality ?? 1,
    keepResolution: options.alwaysKeepResolution,
  })
  return result.file
}

imageCompression.getDataUrlFromFile = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })

imageCompression.getFilefromDataUrl = async (dataUrl: string, filename: string, lastModified = Date.now()): Promise<File> => {
  const blob = await (await fetch(dataUrl)).blob()
  return new File([blob], filename, { type: blob.type, lastModified })
}

imageCompression.version = 'picpress-compat'

export default imageCompression
export { imageCompression }
