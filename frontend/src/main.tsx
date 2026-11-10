import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { ConfigErrorScreen } from '@/app/ConfigErrorScreen'
import { initTheme } from '@/lib/theme'
import { appConfigResult } from '@/services/api/config'
import '@/styles/globals.css'

initTheme()

const container = document.getElementById('root')
if (!container) throw new Error('index.html is missing the #root element')
const root = createRoot(container)

if (!appConfigResult.ok) {
  // Nothing else is loaded: no store, no API or Supabase client.
  root.render(<ConfigErrorScreen issues={appConfigResult.issues} />)
} else {
  void import('@/app/App').then(({ App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
}
