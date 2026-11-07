import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'

import { AppProviders } from '@/app/providers/AppProviders'
import { router } from '@/app/router/router'
import { initTheme } from '@/lib/theme'
import '@/styles/globals.css'

initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
)
