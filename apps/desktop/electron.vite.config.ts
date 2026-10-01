import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cliBuildPlugin } from './scripts/cli-build'

const shared = resolve('src/shared')
const rendererSrc = resolve('src/renderer/src')
const coreSrc = resolve('../../packages/core/src/index.ts')
const coreBrowserSrc = resolve('../../packages/core/src/browser.ts')

export default defineConfig({
  main: {
    plugins: [cliBuildPlugin()],
    resolve: {
      alias: {
        '@shared': shared,
        '@cerebro/core': coreSrc,
        '@cerebro/mux': resolve('../../packages/mux/src/client.ts')
      }
    },
    build: {
      // Bundle workspace core into main. It is not a runtime Node dependency.
      externalizeDeps: { exclude: ['@cerebro/core', '@cerebro/mux'] },
      rollupOptions: {
        external: ['node:sqlite', 'node-pty']
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': shared
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': rendererSrc,
        '@renderer': rendererSrc,
        '@shared': shared,
        // Bundle browser-safe core source; the CommonJS build cannot expose named re-exports here.
        '@cerebro/core': coreBrowserSrc
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
