# picpress

Compress, resize and convert images **in the browser, before upload**. Runs in a Web Worker, hits an
exact file size, handles phone photos (EXIF rotation, HEIC, iOS canvas limits), keeps animated GIFs
intact, and never makes a file bigger. A drop-in replacement for `browser-image-compression`.

[![npm](https://img.shields.io/npm/v/picpress.svg)](https://www.npmjs.com/package/picpress)
[![license](https://img.shields.io/npm/l/picpress.svg)](./LICENSE)

**[Live demo →](https://ajuarez93.github.io/picpress/)** — drop your own photos and compare side by side with browser-image-compression. Nothing is uploaded.

![picpress demo: four files compressed in the browser, compared with browser-image-compression](https://raw.githubusercontent.com/ajuarez93/picpress/main/.github/assets/demo.jpg)

```js
import { compress } from 'picpress'

const { file, size, width, height } = await compress(input.files[0], {
  maxSize: 500_000,      // bytes: lowers quality first, then dimensions
  maxWidth: 2048,
  maxHeight: 2048,
  type: 'image/webp',
})
```

## Why

`browser-image-compression` gets ~2.3 M downloads a week but has had no release since March 2023.
picpress was written against its most-discussed open issues:

| browser-image-compression issue | picpress |
|---|---|
| #24 animated GIFs lose their animation | animated GIF / APNG / WebP are returned untouched (`skipped: 'animated'`) |
| #222, #205, #163 black images on iPad/iPhone with big photos | canvas area capped at iOS Safari's 16.7 MP limit |
| #148, #189 wrong orientation | decoded with `imageOrientation: 'from-image'`; pixels come out upright |
| #215 slow | OffscreenCanvas in a Worker, step-down resize, quality search that converges in 2–4 encodes |
| #176, #226 `maxSizeMB` not respected | quality search, then proportional downscaling; `targetMet` tells you the outcome |
| #154 only lower quality | `keepResolution: true` |
| #225, #188 request to `cdn.jsdelivr.net` | the worker is bundled inline: zero network requests |
| #241 `fileType` silently ignored | unsupported encoders fall back (AVIF → WebP → JPEG) and set `typeFallback: true` |
| #79 HEIC | `picpress/heic` plug-in (lazy-loads libheif only when needed) |
| #191 canvas memory leak | every canvas is shrunk to 0×0 and every bitmap closed |
| #211 a `ProgressEvent` is thrown instead of an error | always a `PicpressError` with a `code` |

Measured in Chrome on the [demo](https://ajuarez93.github.io/picpress/) with synthetic noisy images
(your numbers will vary with content and hardware):

| Same input and options | browser-image-compression 2.0.2 | picpress |
|---|---|---|
| 24 MP JPEG → WebP ≤ 300 KB | 18.3 s | 3.4 s |
| 20 MP PNG (50 MB) → WebP ≤ 1 MB | 10.7 s | 5.0 s |
| 24 MP JPEG → JPEG ≤ 500 KB, max side 2048 | shrank to 1231×1847 | kept 1365×2048 |
| PNG with alpha → JPEG ≤ 100 KB | shrank to 1371×1028 | kept 1600×1200 |
| animated GIF → WebP | first frame only | kept animated |
| HEIC in Chrome | throws `[object Event]` | works with `picpress/heic` |

## Install

```bash
npm install picpress
npm install heic-to   # optional, only for HEIC outside Safari
```

## Migrating from browser-image-compression

```diff
- import imageCompression from 'browser-image-compression'
+ import imageCompression from 'picpress/compat'
```

Same options, same `File` result. `libURL` is ignored (nothing is loaded from a CDN).

## Options

| Option | Default | |
|---|---|---|
| `maxSize` | — | target size in **bytes** |
| `maxWidth` / `maxHeight` | — | bounding box; never upscales |
| `type` | `'auto'` | `'image/webp' \| 'image/avif' \| 'image/jpeg' \| 'image/png'`; `auto` keeps JPEG/PNG/WebP/AVIF, turns HEIC/BMP/GIF into JPEG |
| `quality` | `0.82` | starting and maximum quality |
| `minQuality` | `0.4` | lowest quality the size search may use |
| `keepResolution` | `false` | reach `maxSize` with quality only |
| `keepExif` | `false` | copy EXIF into JPEG output (orientation reset). Off by default: EXIF can contain **GPS location** |
| `background` | `'#fff'` | fill for transparency when the output is JPEG |
| `maxPixels` | `16_777_216` | canvas area cap (iOS) |
| `skipIfLarger` | `true` | return the original if the result would be bigger at the same size and type |
| `allowAnimated` | `false` | compress animations anyway (first frame only) |
| `worker` | `true` | use the inline Web Worker when available |
| `decoders` | — | e.g. `[heicDecoder()]` |
| `signal`, `onProgress` | — | `AbortSignal`, `0–100` callback |

Result: `{ file, size, originalSize, width, height, type, quality, targetMet, skipped?, typeFallback, durationMs, offThread }`.
Errors: `PicpressError` with `code`: `DECODE_FAILED`, `ENCODE_FAILED`, `ABORTED`, `INVALID_INPUT`.

`compressAll(files, { concurrency: 2, ...options })` handles several files and keeps their order.

## React

```jsx
import { useCompress, formatBytes } from 'picpress/react'

function Upload() {
  const { items, add, files, pending } = useCompress({ maxSize: 500_000, type: 'image/webp' })
  return (
    <>
      <input type="file" multiple accept="image/*" onChange={(e) => add(e.target.files)} />
      {items.map((it) => (
        <div key={it.id}>
          {it.original.name}: {it.result ? formatBytes(it.result.size) : `${it.progress}%`}
        </div>
      ))}
    </>
  )
}
```

## Vue 3

```vue
<script setup>
import { useCompress } from 'picpress/vue'
const { items, add, files } = useCompress({ maxSize: 500_000, type: 'image/webp' })
</script>

<template>
  <input type="file" multiple accept="image/*" @change="add($event.target.files)" />
</template>
```

## HEIC (iPhone photos)

```js
import { compress } from 'picpress'
import { heicDecoder } from 'picpress/heic'

await compress(file, { decoders: [heicDecoder()] })
```

Safari decodes HEIC natively, so the WebAssembly decoder (`heic-to`) is only downloaded in other browsers.

## Browser support

Any browser with `createImageBitmap` and canvas `toBlob`. The Worker path needs 2D `OffscreenCanvas`
(Chrome 69+, Firefox 105+, Safari 16.4+); elsewhere picpress runs on the main thread automatically.
AVIF output depends on the browser's encoder; when it is missing you get WebP and `typeFallback: true`.

## Development

```bash
npm install
npm run demo    # Vite dev server
npm test        # vitest: format sniffing, animation detection, EXIF, sizing, quality search
npm run build
node scripts/make-test-images.mjs   # 24 MP rotated JPEG, alpha PNG, animated GIF, 50 MB PNG for manual testing
```

## Credits

Demo sample photo: a frame from the [Sintel](https://durian.blender.org/) trailer, © Blender Foundation,
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Not part of the npm package.

## License

MIT © [Jose Alfonso Guerrero Juarez](https://www.ajuarez93.com)
