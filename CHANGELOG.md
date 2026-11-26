# Changelog

## 0.1.0 — 2026-11-25

First release.

- `compress()` / `compressAll()`: resize, convert (JPEG, WebP, AVIF, PNG) and hit an exact `maxSize`.
- Inline Web Worker (OffscreenCanvas) with main-thread fallback; no network requests.
- EXIF orientation applied; EXIF stripped by default, `keepExif` for JPEG.
- iOS-safe canvas size cap, animated GIF/APNG/WebP passthrough, never-larger-than-original.
- Typed errors (`SlimpicError` with `code`), `AbortSignal`, progress.
- `slimpic/compat`: drop-in replacement for browser-image-compression.
- `slimpic/heic`: HEIC decoder plug-in (optional `heic-to`).
- React `useCompress` hook and Vue `useCompress` composable.
