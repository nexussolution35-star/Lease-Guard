import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

export interface TabsNavigationTab {
  value: string
  label: string
  count?: number
  icon?: LucideIcon
  content: ReactNode
}

export interface TabsNavigationProps {
  tabs: TabsNavigationTab[]
  /** Controlled value. */
  value?: string
  /** Uncontrolled initial value. Defaults to the first tab. */
  defaultValue?: string
  onValueChange?: (value: string) => void
  className?: string
}

export function TabsNavigation({ tabs, value, defaultValue, onValueChange, className }: TabsNavigationProps) {
  const fallback = defaultValue ?? tabs[0]?.value
  return (
    <Tabs
      value={value}
      defaultValue={value === undefined ? fallback : undefined}
      onValueChange={onValueChange}
      className={cn('gap-4', className)}
    >
      <div className="-mx-1 overflow-x-auto border-b border-border px-1 pb-2">
        <TabsList variant="line" className="w-max justify-start">
          {tabs.map(({ value: tabValue, label, count, icon: Icon }) => (
            <TabsTrigger key={tabValue} value={tabValue} className="flex-none px-3">
              {Icon ? <Icon aria-hidden="true" /> : null}
              {label}
              {count !== undefined ? (
                <span className="rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">
                  <span className="sr-only">(</span>
                  {count}
                  <span className="sr-only">)</span>
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="focus-visible:outline-none">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}
