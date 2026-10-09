import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const rendererSrc = resolve('src/renderer/src')

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': rendererSrc,
      '@renderer': rendererSrc,
      '@shared': resolve('src/shared'),
      '@cerebro/core': resolve('../../packages/core/src/browser.ts')
    }
  },
  test: {
    environment: 'jsdom',
    include: ['src/renderer/**/*.integration.test.{ts,tsx}'],
    setupFiles: ['src/renderer/test/setup.ts'],
    restoreMocks: true
  }
})
