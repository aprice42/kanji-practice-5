import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/* The set builder's write endpoint — `npm run dev` only.

   build-set.html is a second entry point Vite serves in dev. It is NOT listed
   in build.rollupOptions.input, so `npm run build` never emits it and nothing
   here reaches the phone: `apply: 'serve'` means this plugin does not even load
   during a build.

   The builder is a page, so it cannot write a file itself. This is the smallest
   thing that lets it: one POST, one directory, no reading back. */
function setBuilder() {
  const dir = join(process.cwd(), 'content/sets')
  const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

  return {
    name: 'kanji-set-builder',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__sets/write', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end('POST only')
        }
        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', () => {
          res.setHeader('Content-Type', 'application/json')
          try {
            const { slug, markdown, remove } = JSON.parse(body)
            // The slug becomes a filename, so it is checked rather than trusted
            // even though only this machine can reach the endpoint.
            if (!SLUG.test(slug ?? '')) throw new Error(`Bad set name: ${slug}`)
            const path = join(dir, `${slug}.md`)
            if (remove) {
              if (existsSync(path)) unlinkSync(path)
              return res.end(JSON.stringify({ ok: true, path: `content/sets/${slug}.md`, removed: true }))
            }
            mkdirSync(dir, { recursive: true })
            writeFileSync(path, markdown, 'utf8')
            res.end(JSON.stringify({ ok: true, path: `content/sets/${slug}.md` }))
          } catch (error) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, error: String(error.message ?? error) }))
          }
        })
      })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [
    setBuilder(),
    VitePWA({
      /* `prompt`, not `autoUpdate`: a new worker installs and waits rather than
         swapping itself in and reloading the page mid-round. src/update.js
         surfaces it as a button on the home screen. */
      registerType: 'prompt',
      // Registration is done by src/update.js, which needs the callbacks.
      injectRegister: null,
      includeAssets: ['icon-192.png', 'icon-512.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
      },
      manifest: {
        name: 'Kanji Practice',
        short_name: 'Kanji',
        description: 'Flashcards for review kanji practice',
        /* The default color scheme, Indigo, in its light theme: `--bg` for the
           browser and PWA chrome (main.js keeps this in step with the live token
           at runtime, so this is only the value before the app boots) and the
           same paper white behind the splash screen. */
        theme_color: '#faf7f1',
        background_color: '#faf7f1',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
