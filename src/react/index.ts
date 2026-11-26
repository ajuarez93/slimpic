import { useCallback, useEffect, useRef, useState } from 'react'
import { compress, PicpressError, type CompressOptions, type CompressResult } from '../core/compress'

export * from '../core/index'

export interface CompressItem {
  id: number
  original: File
  status: 'pending' | 'done' | 'error'
  progress: number
  result?: CompressResult
  error?: PicpressError
  /** Object URL of the compressed file (revoked automatically on reset/unmount). */
  previewUrl?: string
}

/**
 * State for an upload field: `add(files)` compresses each file and tracks progress.
 *
 *   const { items, add, reset, pending } = useCompress({ maxSize: 500_000, type: 'image/webp' })
 *   <input type="file" multiple accept="image/*" onChange={(e) => add(e.target.files)} />
 */
export function useCompress(options: CompressOptions = {}) {
  const [items, setItems] = useState<CompressItem[]>([])
  const opts = useRef(options)
  opts.current = options
  const urls = useRef<string[]>([])
  const nextId = useRef(0)
  const controller = useRef<AbortController | null>(null)

  const patch = (id: number, p: Partial<CompressItem>) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...p } : it)))

  const add = useCallback(async (files: FileList | File[] | null | undefined): Promise<CompressResult[]> => {
    const list = Array.from(files ?? [])
    if (!list.length) return []
    controller.current ??= new AbortController()
    const signal = controller.current.signal
    const created = list.map((original) => ({ id: nextId.current++, original, status: 'pending' as const, progress: 0 }))
    setItems((prev) => [...prev, ...created])
    const done: CompressResult[] = []
    for (const item of created) {
      try {
        const result = await compress(item.original, { ...opts.current, signal, onProgress: (p) => patch(item.id, { progress: p }) })
        const previewUrl = URL.createObjectURL(result.file)
        urls.current.push(previewUrl)
        patch(item.id, { status: 'done', progress: 100, result, previewUrl })
        done.push(result)
      } catch (e) {
        if (signal.aborted) break
        patch(item.id, { status: 'error', error: e instanceof PicpressError ? e : new PicpressError('ENCODE_FAILED', String(e)) })
      }
    }
    return done
  }, [])

  const reset = useCallback(() => {
    controller.current?.abort()
    controller.current = null
    urls.current.forEach(URL.revokeObjectURL)
    urls.current = []
    setItems([])
  }, [])

  useEffect(() => () => {
    controller.current?.abort()
    urls.current.forEach(URL.revokeObjectURL)
  }, [])

  return {
    items,
    add,
    reset,
    pending: items.some((i) => i.status === 'pending'),
    files: items.filter((i) => i.result).map((i) => i.result!.file),
  }
}
