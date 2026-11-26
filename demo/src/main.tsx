import './demo.css'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { formatBytes, useCompress, type CompressOptions, type OutputType } from 'slimpic/react'
import { heicDecoder } from 'slimpic/heic'
import legacy from 'browser-image-compression'

const SAMPLE = './samples/sintel.jpg'

interface LegacyRun { size?: number; ms?: number; error?: string }

function App() {
  const [maxKB, setMaxKB] = useState(300)
  const [maxSide, setMaxSide] = useState(2048)
  const [type, setType] = useState<OutputType | 'auto'>('image/webp')
  const [keepExif, setKeepExif] = useState(false)
  const [worker, setWorker] = useState(true)
  const [compare, setCompare] = useState(false)
  const [legacyRuns, setLegacyRuns] = useState<Record<string, LegacyRun>>({})
  const [over, setOver] = useState(false)

  const options: CompressOptions = {
    maxSize: maxKB ? maxKB * 1024 : undefined,
    maxWidth: maxSide || undefined,
    maxHeight: maxSide || undefined,
    type,
    keepExif,
    worker,
    decoders: [heicDecoder()],
  }
  const { items, add, reset } = useCompress(options)

  const run = async (files: File[]) => {
    await add(files)
    if (!compare) return
    for (const f of files) {
      const key = f.name + f.size
      const t0 = performance.now()
      try {
        const out = await legacy(f, { maxSizeMB: maxKB ? maxKB / 1024 : undefined, maxWidthOrHeight: maxSide || undefined, fileType: type === 'auto' ? undefined : type, useWebWorker: worker })
        setLegacyRuns((r) => ({ ...r, [key]: { size: out.size, ms: performance.now() - t0 } }))
      } catch (e) {
        setLegacyRuns((r) => ({ ...r, [key]: { error: e instanceof Error ? e.message : String(e) } }))
      }
    }
  }

  const loadSample = async () => {
    const blob = await (await fetch(SAMPLE)).blob()
    await run([new File([blob], 'sintel.jpg', { type: blob.type })])
  }

  return (
    <>
      <header>
        <h1>slimpic</h1>
        <p>Compress, resize and convert images in the browser before upload — in a Web Worker, to an exact size, iOS-safe.</p>
      </header>

      <div className="opts">
        <label>Max size (KB) <input type="number" min={0} value={maxKB} onChange={(e) => setMaxKB(Number(e.target.value))} /></label>
        <label>Max side (px) <input type="number" min={0} value={maxSide} onChange={(e) => setMaxSide(Number(e.target.value))} /></label>
        <label>Type
          <select value={type} onChange={(e) => setType(e.target.value as OutputType | 'auto')}>
            <option value="auto">auto (keep)</option>
            <option value="image/webp">WebP</option>
            <option value="image/avif">AVIF</option>
            <option value="image/jpeg">JPEG</option>
            <option value="image/png">PNG</option>
          </select>
        </label>
        <label><input type="checkbox" checked={keepExif} onChange={(e) => setKeepExif(e.target.checked)} /> keep EXIF (JPEG)</label>
        <label><input type="checkbox" checked={worker} onChange={(e) => setWorker(e.target.checked)} /> Web Worker</label>
        <label><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> compare with browser-image-compression</label>
      </div>

      <label
        className={`drop${over ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void run(Array.from(e.dataTransfer.files)) }}
      >
        <span>
          Drop photos here (JPEG, PNG, WebP, AVIF, HEIC, GIF) or{' '}
          <input type="file" multiple accept="image/*,.heic,.heif" onChange={(e) => void run(Array.from(e.target.files ?? []))} />
          <br />
          <button className="chip" type="button" onClick={(e) => { e.preventDefault(); void loadSample() }}>Try a sample photo</button>{' '}
          {items.length > 0 && <button className="chip" type="button" onClick={(e) => { e.preventDefault(); reset(); setLegacyRuns({}) }}>Clear</button>}
        </span>
      </label>

      {items.length > 0 && (
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th></th><th>File</th><th>Original</th><th>slimpic</th><th>Saved</th><th>Size</th><th>Type</th><th>Time</th>{compare && <th>browser-image-compression</th>}</tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const r = it.result
                const lg = legacyRuns[it.original.name + it.original.size]
                return (
                  <tr key={it.id} data-testid="row">
                    <td>{it.previewUrl ? <img src={it.previewUrl} alt="" /> : null}</td>
                    <td>{it.original.name}{it.status === 'pending' && <div className="bar" style={{ width: `${it.progress}%` }} />}</td>
                    <td className="num">{formatBytes(it.original.size)}</td>
                    <td className="num">
                      {it.status === 'error' ? <span className="warn">{it.error?.message}</span> : r ? formatBytes(r.size) : '…'}
                      {r?.skipped && <div className="warn">kept original ({r.skipped})</div>}
                      {r && !r.targetMet && <div className="warn">target not reachable</div>}
                    </td>
                    <td className="num good">{r && !r.skipped ? `−${Math.round((1 - r.size / r.originalSize) * 100)}%` : ''}</td>
                    <td className="num">{r?.width ? `${r.width}×${r.height}` : ''}</td>
                    <td className="num">{r?.type.replace('image/', '')}{r?.typeFallback && <span className="warn"> (fallback)</span>}</td>
                    <td className="num">{r ? `${Math.round(r.durationMs)} ms${r.offThread ? ' · worker' : ''}` : ''}</td>
                    {compare && <td className="num">{lg ? (lg.error ? <span className="warn">{lg.error}</span> : `${formatBytes(lg.size!)} · ${Math.round(lg.ms!)} ms`) : '…'}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

createRoot(document.getElementById('app')!).render(<App />)
