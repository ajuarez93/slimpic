import { computed, onBeforeUnmount, ref, unref, type MaybeRef } from 'vue'
import { compress, PicpressError, type CompressOptions, type CompressResult } from '../core/compress'

export * from '../core/index'

export interface CompressItem {
  id: number
  original: File
  status: 'pending' | 'done' | 'error'
  progress: number
  result?: CompressResult
  error?: PicpressError
  previewUrl?: string
}

/**
 * Composable for an upload field.
 *
 *   const { items, add, reset, pending } = useCompress({ maxSize: 500_000, type: 'image/webp' })
 *   <input type="file" multiple accept="image/*" @change="add($event.target.files)" />
 */
export function useCompress(options: MaybeRef<CompressOptions> = {}) {
  const items = ref<CompressItem[]>([])
  let nextId = 0
  let urls: string[] = []
  let controller: AbortController | null = null

  const patch = (id: number, p: Partial<CompressItem>) => {
    const it = items.value.find((i) => i.id === id)
    if (it) Object.assign(it, p)
  }

  async function add(files: FileList | File[] | null | undefined): Promise<CompressResult[]> {
    const list = Array.from(files ?? [])
    if (!list.length) return []
    controller ??= new AbortController()
    const signal = controller.signal
    const created = list.map((original) => ({ id: nextId++, original, status: 'pending' as const, progress: 0 }))
    items.value.push(...created)
    const done: CompressResult[] = []
    for (const item of created) {
      try {
        const result = await compress(item.original, { ...unref(options), signal, onProgress: (p) => patch(item.id, { progress: p }) })
        const previewUrl = URL.createObjectURL(result.file)
        urls.push(previewUrl)
        patch(item.id, { status: 'done', progress: 100, result, previewUrl })
        done.push(result)
      } catch (e) {
        if (signal.aborted) break
        patch(item.id, { status: 'error', error: e instanceof PicpressError ? e : new PicpressError('ENCODE_FAILED', String(e)) })
      }
    }
    return done
  }

  function reset() {
    controller?.abort()
    controller = null
    urls.forEach(URL.revokeObjectURL)
    urls = []
    items.value = []
  }

  onBeforeUnmount(() => {
    controller?.abort()
    urls.forEach(URL.revokeObjectURL)
  })

  return {
    items,
    add,
    reset,
    pending: computed(() => items.value.some((i) => i.status === 'pending')),
    files: computed(() => items.value.filter((i) => i.result).map((i) => i.result!.file)),
  }
}
