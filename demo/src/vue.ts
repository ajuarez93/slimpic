import './demo.css'
import { createApp, h } from 'vue'
import { formatBytes, useCompress } from 'picpress/vue'

// In an app (SFC):
//   const { items, add } = useCompress({ maxSize: 300_000, type: 'image/webp' })
//   <input type="file" multiple accept="image/*" @change="add($event.target.files)" />
createApp({
  setup() {
    const { items, add, reset } = useCompress({ maxSize: 300 * 1024, maxWidth: 2048, maxHeight: 2048, type: 'image/webp' })
    return () => [
      h('header', [h('h1', 'picpress'), h('p', ['Vue 3 — ', h('code', 'useCompress()'), ', max 300 KB, WebP.'])]),
      h('label', { class: 'drop' }, [
        h('span', ['Choose photos: ', h('input', { type: 'file', multiple: true, accept: 'image/*', onChange: (e: Event) => add((e.target as HTMLInputElement).files) })]),
      ]),
      items.value.length
        ? h('table', [
            h('thead', h('tr', ['', 'File', 'Original', 'Result', 'Size'].map((t) => h('th', t)))),
            h('tbody', items.value.map((it) =>
              h('tr', { key: it.id }, [
                h('td', it.previewUrl ? [h('img', { src: it.previewUrl })] : []),
                h('td', it.original.name),
                h('td', { class: 'num' }, formatBytes(it.original.size)),
                h('td', { class: 'num' }, it.result ? `${formatBytes(it.result.size)} (${it.result.type.replace('image/', '')})` : it.error ? it.error.message : `${it.progress}%`),
                h('td', { class: 'num' }, it.result ? `${it.result.width}×${it.result.height}` : ''),
              ]),
            )),
          ])
        : null,
      items.value.length ? h('button', { class: 'chip', onClick: reset }, 'Clear') : null,
    ]
  },
}).mount('#app')
