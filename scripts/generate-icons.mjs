// Rasterizes the brand SVG into the PNG sizes the PWA manifest needs.
// Run with: npm run icons   (requires the `sharp` dev dependency)
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = join(here, '..', 'public')

const svg = readFileSync(join(publicDir, 'icon.svg'))

// A maskable icon needs safe padding so the mark is not clipped by the
// platform's icon mask. We composite the logo (scaled to ~62%) onto a
// solid brand-green background.
async function maskable(size) {
  const inner = Math.round(size * 0.62)
  const logo = await sharp(svg).resize(inner, inner).png().toBuffer()
  const pad = Math.round((size - inner) / 2)
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0x1f, g: 0x3d, b: 0x34, alpha: 1 },
    },
  })
    .composite([{ input: logo, top: pad, left: pad }])
    .png()
    .toBuffer()
}

async function main() {
  await sharp(svg).resize(192, 192).png().toFile(join(publicDir, 'icon-192.png'))
  await sharp(svg).resize(512, 512).png().toFile(join(publicDir, 'icon-512.png'))
  await sharp(svg).resize(180, 180).png().toFile(join(publicDir, 'apple-touch-icon.png'))
  writeFileSync(join(publicDir, 'icon-512-maskable.png'), await maskable(512))
  console.log('✓ Generated PWA icons in public/')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
