import type { CerebroApi } from '../src/shared/types'

declare global {
  interface Window {
    cerebro: CerebroApi
  }
}

export {}
