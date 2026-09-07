import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve('src/shared')
const rendererSrc = resolve('src/renderer/src')
const coreSrc = resolve('../../packages/core/src/index.ts')

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': shared,
        '@cerebro/core': coreSrc
      }
    },
    build: {
      // Don't externalize the workspace package; the alias points at source.
      externalizeDeps: { exclude: ['@cerebro/core'] },
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
        '@shared': shared
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
