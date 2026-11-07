import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { QueryClientProvider } from '@tanstack/react-query'
import { connectQueryEvents, queryClient } from './lib/query-client'

const disconnectQueryEvents = connectQueryEvents()
import.meta.hot?.dispose(disconnectQueryEvents)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
)
