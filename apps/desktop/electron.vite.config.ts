import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve('src/shared')
const rendererSrc = resolve('src/renderer/src')

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': shared
      }
    },
    build: {
      rollupOptions: {
        external: ['node:sqlite']
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
