import { extractExif, insertExif, resetOrientation } from './exif'
import { canUseOffscreen, domEnv, IOS_MAX_PIXELS, offscreenEnv, runPipeline, type OutputType, type PipelineOptions, type PipelineResult } from './pipeline'
import { isAnimated, sniffType } from './sniff'
import { workerSource } from '../generated/worker-source'

export type { OutputType }

/** Turns an input the browser cannot decode (e.g. HEIC outside Safari) into one it can. */
export type Decoder = (file: Blob, type: string | null) => Promise<Blob | null>

export interface CompressOptions {
  /** Max output width in px. Default: no limit (still capped by `maxPixels`). */
  maxWidth?: number
  /** Max output height in px. */
  maxHeight?: number
  /** Target size in bytes, e.g. `500_000`. Quality is lowered first, then dimensions. */
  maxSize?: number
  /**
   * Output type. `'auto'` (default) keeps JPEG/PNG/WebP/AVIF and turns everything else
   * (HEIC, BMP, static GIF) into JPEG. If the browser cannot encode the requested type,
   * the next best one is used and reported in `result.type` — never silently ignored.
   */
  type?: OutputType | 'auto'
  /** Starting (and maximum) quality, 0–1. Default `0.82`. */
  quality?: number
  /** Lowest quality the size search may use. Default `0.4`. */
  minQuality?: number
  /** Only lower quality to reach `maxSize`, never the dimensions. */
  keepResolution?: boolean
  /** Copy EXIF (camera, date, GPS!) into JPEG output, with orientation reset. Default `false`. */
  keepExif?: boolean
  /** Background for transparent pixels when the output is JPEG. Default `'#fff'`. */
  background?: string
  /** Max canvas area. Default `16_777_216` (the iOS Safari limit; larger draws black). */
  maxPixels?: number
  /** Return the original when the result would be larger (and no resize was needed). Default `true`. */
  skipIfLarger?: boolean
  /** Compress animated GIF / APNG / WebP anyway (keeps only the first frame). Default `false`. */
  allowAnimated?: boolean
  /** Run in a Web Worker when possible. Default `true`. */
  worker?: boolean
  /** Extra decoders tried before giving up, e.g. `heicDecoder()` from `slimpic/heic`. */
  decoders?: Decoder[]
  /** Max resize rounds when chasing `maxSize`. Default `8`. */
  maxIterations?: number
  onProgress?: (percent: number) => void
  signal?: AbortSignal
}

export type SkipReason = 'animated' | 'larger-than-original' | 'unsupported-type'

export interface CompressResult {
  file: File
  originalSize: number
  size: number
  width: number
  height: number
  type: string
  /** Final quality used, or null for lossless output. */
  quality: number | null
  /** `maxSize` was reached (true when there is no target). */
  targetMet: boolean
  /** Set when the original file is returned unchanged. */
  skipped?: SkipReason
  /** True when the requested type could not be encoded and a fallback was used. */
  typeFallback: boolean
  durationMs: number
  offThread: boolean
}

export type SlimpicErrorCode = 'DECODE_FAILED' | 'ENCODE_FAILED' | 'ABORTED' | 'INVALID_INPUT'

export class SlimpicError extends Error {
  constructor(public readonly code: SlimpicErrorCode, message: string) {
    super(message)
    this.name = 'SlimpicError'
  }
}

const ENCODABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' }

function renameFor(name: string, type: string): string {
  const ext = EXT[type] ?? 'img'
  return /\.[^./]+$/.test(name) ? name.replace(/\.[^./]+$/, `.${ext}`) : `${name}.${ext}`
}

// ---- shared worker -------------------------------------------------------------------------

type Pending = { resolve: (r: PipelineResult) => void; reject: (e: Error) => void; onProgress?: (p: number) => void }
let worker: Worker | null = null
let workerOk: Promise<boolean> | null = null
let workerUrl = ''
let idleTimer: ReturnType<typeof setTimeout> | undefined
let nextId = 0
const pending = new Map<number, Pending>()

function killWorker(reason?: Error) {
  worker?.terminate()
  if (workerUrl) URL.revokeObjectURL(workerUrl)
  worker = null
  workerOk = null
  workerUrl = ''
  for (const p of pending.values()) p.reject(reason ?? new SlimpicError('ABORTED', 'worker terminated'))
  pending.clear()
}

function getWorker(): Promise<boolean> {
  if (workerOk) return workerOk
  workerOk = new Promise<boolean>((resolve) => {
    try {
      workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
      worker = new Worker(workerUrl)
    } catch {
      resolve(false) // CSP without blob: workers, or no Worker at all
      return
    }
    const timer = setTimeout(() => resolve(false), 3000)
    worker.onmessage = (e: MessageEvent) => {
      const d = e.data
      if ('probe' in d) {
        clearTimeout(timer)
        resolve(!!d.probe)
        return
      }
      const job = pending.get(d.id)
      if (!job) return
      if (d.progress !== undefined) return job.onProgress?.(d.progress)
      pending.delete(d.id)
      if (d.error) job.reject(new Error(d.error))
      else job.resolve(d.result)
      scheduleIdle()
    }
    worker.onerror = () => {
      clearTimeout(timer)
      resolve(false)
    }
    worker.postMessage({ probe: true })
  })
  return workerOk
}

function scheduleIdle() {
  clearTimeout(idleTimer)
  if (!pending.size) idleTimer = setTimeout(() => !pending.size && killWorker(), 10_000)
}

function runInWorker(blob: Blob, options: PipelineOptions, onProgress?: (p: number) => void): Promise<PipelineResult> {
  clearTimeout(idleTimer)
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress })
    worker!.postMessage({ id, blob, options })
  })
}

// ---- public API ----------------------------------------------------------------------------

/**
 * Compress / resize / convert an image in the browser.
 * Never fetches anything from the network; runs in a Web Worker when it can.
 */
export async function compress(input: Blob, options: CompressOptions = {}): Promise<CompressResult> {
  const started = performance.now()
  const { signal, onProgress } = options
  if (!(input instanceof Blob)) throw new SlimpicError('INVALID_INPUT', 'compress() expects a File or Blob')
  const abortError = () => new SlimpicError('ABORTED', 'compression aborted')
  if (signal?.aborted) throw abortError()

  const name = input instanceof File ? input.name : 'image'
  const head = new Uint8Array(await input.slice(0, 64 * 1024).arrayBuffer())
  const sniffed = sniffType(head)
  const original = input instanceof File ? input : new File([input], name, { type: sniffed ?? input.type })

  const unchanged = (skipped: SkipReason): CompressResult => ({
    file: original,
    originalSize: input.size,
    size: input.size,
    width: 0,
    height: 0,
    type: sniffed ?? input.type,
    quality: null,
    targetMet: !options.maxSize || input.size <= options.maxSize,
    skipped,
    typeFallback: false,
    durationMs: performance.now() - started,
    offThread: false,
  })

  // Canvas keeps only the first frame of an animation (browser-image-compression#24).
  if (!options.allowAnimated && isAnimated(sniffed === 'image/gif' ? new Uint8Array(await input.arrayBuffer()) : head, sniffed)) {
    return unchanged('animated')
  }

  const wanted = options.type ?? 'auto'
  const type = (wanted === 'auto' ? (sniffed && ENCODABLE.has(sniffed) ? sniffed : 'image/jpeg') : wanted) as OutputType

  // Decode plug-ins (HEIC etc.) run on the main thread before the pipeline.
  let source: Blob = input
  if (options.decoders?.length && sniffed && !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(sniffed)) {
    for (const d of options.decoders) {
      const out = await d(input, sniffed)
      if (out) {
        source = out
        break
      }
    }
  }

  const pipeline: PipelineOptions = {
    maxWidth: options.maxWidth ?? Infinity,
    maxHeight: options.maxHeight ?? Infinity,
    maxSize: options.maxSize ?? 0,
    type,
    quality: Math.min(1, Math.max(0.05, options.quality ?? 0.82)),
    minQuality: Math.min(1, Math.max(0.05, options.minQuality ?? 0.4)),
    maxPixels: options.maxPixels ?? IOS_MAX_PIXELS,
    keepResolution: !!options.keepResolution,
    background: options.background ?? '#fff',
    maxIterations: options.maxIterations ?? 8,
  }

  let offThread = false
  let result: PipelineResult
  const onAbort = () => killWorker(abortError())
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    if (options.worker !== false && typeof Worker !== 'undefined' && (await getWorker())) {
      offThread = true
      result = await runInWorker(source, pipeline, onProgress)
    } else {
      result = await runPipeline(canUseOffscreen() ? offscreenEnv() : domEnv(), source, pipeline, onProgress)
    }
  } catch (err) {
    if (signal?.aborted) throw abortError()
    const msg = err instanceof Error ? err.message : String(err)
    if (/DECODE|decode|InvalidState|source image/i.test(msg)) {
      const hint = sniffed === 'image/heic' ? ' (HEIC: add `decoders: [heicDecoder()]` from "slimpic/heic")' : ''
      throw new SlimpicError('DECODE_FAILED', `could not decode ${sniffed ?? input.type ?? 'input'}${hint}`)
    }
    throw new SlimpicError('ENCODE_FAILED', msg)
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
  if (signal?.aborted) throw abortError()

  let blob = result.blob
  if (options.keepExif && result.type === 'image/jpeg' && sniffed === 'image/jpeg') {
    const exif = extractExif(new Uint8Array(await input.slice(0, 256 * 1024).arrayBuffer()))
    if (exif) blob = new Blob([insertExif(new Uint8Array(await blob.arrayBuffer()), resetOrientation(exif)) as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' })
  }

  // A smaller or equal file in the same format and size is pointless: keep the original.
  const sameDimensions = result.width === result.srcWidth && result.height === result.srcHeight
  if (options.skipIfLarger !== false && blob.size >= input.size && result.type === sniffed && sameDimensions) {
    return { ...unchanged('larger-than-original'), width: result.srcWidth, height: result.srcHeight, offThread }
  }

  return {
    file: new File([blob], renameFor(name, result.type), { type: result.type, lastModified: Date.now() }),
    originalSize: input.size,
    size: blob.size,
    width: result.width,
    height: result.height,
    type: result.type,
    quality: result.quality,
    targetMet: result.targetMet,
    typeFallback: result.type !== type,
    durationMs: performance.now() - started,
    offThread,
  }
}

/** Compress several files with bounded concurrency; results keep the input order. */
export async function compressAll(files: Iterable<Blob>, options: CompressOptions & { concurrency?: number } = {}): Promise<Array<CompressResult | SlimpicError>> {
  const list = [...files]
  const out: Array<CompressResult | SlimpicError> = new Array(list.length)
  let i = 0
  const run = async () => {
    while (i < list.length) {
      const n = i++
      try {
        out[n] = await compress(list[n], options)
      } catch (e) {
        out[n] = e instanceof SlimpicError ? e : new SlimpicError('ENCODE_FAILED', String(e))
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 2) }, run))
  return out
}

/** Stop the shared worker now (it also stops by itself after 10 s idle). */
export const terminateWorker = () => killWorker()
