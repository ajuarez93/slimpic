/// <reference lib="webworker" />
// Bundled by scripts/build-worker.mjs into src/generated/worker-source.ts (an inline string),
// so the library never fetches a worker from a CDN.
import { canUseOffscreen, offscreenEnv, runPipeline, type PipelineOptions } from './pipeline'

declare const self: DedicatedWorkerGlobalScope

interface Job {
  id: number
  blob: Blob
  options: PipelineOptions
}

self.onmessage = async (e: MessageEvent<Job | { probe: true }>) => {
  if ('probe' in e.data) {
    self.postMessage({ probe: canUseOffscreen() })
    return
  }
  const { id, blob, options } = e.data
  try {
    const result = await runPipeline(offscreenEnv(), blob, options, (pct) => self.postMessage({ id, progress: pct }))
    self.postMessage({ id, result })
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
