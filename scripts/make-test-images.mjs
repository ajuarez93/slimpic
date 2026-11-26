// Test images that reproduce browser-image-compression's top issues (not committed).
import sharp from 'sharp'
const out = 'demo/public/samples'
const noisy = (w, h) => {
  const px = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      const n = (Math.random() * 40) | 0
      px[i] = ((x / w) * 200 + n) | 0
      px[i + 1] = ((y / h) * 200 + n) | 0
      px[i + 2] = (120 + n) | 0
    }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } })
}
// 24 MP photo stored sideways (EXIF orientation 6), like a phone in portrait.
await noisy(6000, 4000).jpeg({ quality: 92 }).withMetadata({ orientation: 6, exif: { IFD0: { Make: 'TestCam', Model: 'Portrait' } } }).toFile(`${out}/test-rotated-24mp.jpg`)
// PNG with transparency.
await sharp({ create: { width: 1600, height: 1200, channels: 4, background: { r: 255, g: 90, b: 54, alpha: 0.4 } } })
  .composite([{ input: await noisy(800, 600).png().toBuffer(), left: 400, top: 300 }])
  .png().toFile(`${out}/test-alpha.png`)
// Animated GIF.
const frame = (c) => sharp({ create: { width: 120, height: 120, channels: 3, background: c } }).png().toBuffer()
await sharp([await frame('#ff5a36'), await frame('#36a3ff'), await frame('#2ecc71')], { join: { animated: true } }).gif({ delay: 300 }).toFile(`${out}/test-animated.gif`)
// Very large PNG (would be > iOS canvas limit).
await noisy(5000, 4000).png({ compressionLevel: 3 }).toFile(`${out}/test-huge.png`)
console.log('ok')
