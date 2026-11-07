import type { ReactNode } from 'react'

import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

export interface AppProvidersProps {
  children: ReactNode
}

/** Application-wide providers. Mounted above the router so error and not-found screens share them. */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <TooltipProvider delayDuration={200}>
      {children}
      <Toaster position="top-right" richColors closeButton />
    </TooltipProvider>
  )
}
