import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
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
        name: 'Japanese Kanji Practice',
        // Home-screen labels get truncated around 12 characters on both
        // platforms, so this is the half of the name that identifies it. The
        // long name leads with "Japanese", which under an icon on a Japanese
        // practice app is the half that says nothing.
        short_name: 'Kanji Practice',
        description: 'Kanji and kana practice for the Japanese Dual Language Immersion program',
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
