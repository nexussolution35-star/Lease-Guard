import { isoToday } from '@leaseguard/domain'
import { useId, useState } from 'react'

import { SETTINGS_SECTIONS } from '@/components/forms'
import { PageHeader } from '@/components/layout/PageHeader'
import { setSidebarCollapsed, useSidebarCollapsed } from '@/components/layout/useSidebarCollapsed'
import { DateDisplay, StatusDot } from '@/components/shared'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { SettingsRow } from '@/features/company/components/SettingsRow'
import { canRememberBrowserPreferences } from '@/lib/browserStorage'
import { isThemePreference, setThemePreference, useSystemColorScheme, useThemePreference, type ThemePreference } from '@/lib/theme'
import { useMediaQuery } from '@/lib/useMediaQuery'

const THEME_LABELS: Record<ThemePreference, string> = { light: 'Light', dark: 'Dark', system: 'System' }
/** A read-only fact: a short label, then its value beside it from `sm`. */
const FACT_ROW = 'grid gap-x-6 gap-y-1 py-3 first:pt-0 sm:grid-cols-[8rem_minmax(0,1fr)]'
const THEME_ORDER: readonly ThemePreference[] = ['system', 'light', 'dark']

/**
 * Settings → Preferences: display preferences for this browser (theme, sidebar start state). Viewer conveniences,
 * not business data: they apply at once, are remembered in this browser only, and still apply for the session
 * when the browser will not store them. Motion and date format are not choices: they follow the system and en-ZA.
 */
export function PreferencesScreen() {
  const theme = useThemePreference()
  const systemScheme = useSystemColorScheme()
  const [collapsed] = useSidebarCollapsed()
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  // Checked once: whether storage works does not change while the page is open.
  const [remembered] = useState(canRememberBrowserPreferences)
  const [today] = useState(() => isoToday(new Date()))
  const themeId = useId()
  const sidebarId = useId()

  return (
    <section>
      <PageHeader
        title="Preferences"
        description="How LeaseGuard looks in this browser. These are saved in this browser only and do not follow you to another browser or device."
      />
      {remembered ? null : (
        <p role="status" className="mb-6 text-sm">
          <StatusDot tone="warning">This browser is not saving preferences, for example in private browsing.</StatusDot>{' '}
          <span className="text-muted-foreground">Your choices still apply until you close this tab.</span>
        </p>
      )}
      <div className={SETTINGS_SECTIONS}>
        <SettingsRow title="Theme" description="The same choice as Theme in the account menu. Changing either changes both.">
          <RadioGroup
            aria-label="Theme"
            value={theme}
            onValueChange={(value) => {
              if (isThemePreference(value)) setThemePreference(value)
            }}
          >
            {THEME_ORDER.map((option) => {
              const itemId = `${themeId}-${option}`
              return (
                <Label key={option} htmlFor={itemId} className="items-start gap-3 font-normal">
                  <RadioGroupItem id={itemId} value={option} aria-describedby={`${itemId}-hint`} className="mt-0.5" />
                  <span className="grid gap-1">
                    <span>{THEME_LABELS[option]}</span>
                    <span id={`${itemId}-hint`} className="text-xs text-muted-foreground">
                      {option === 'system'
                        ? `Follows this device's setting, currently ${systemScheme}.`
                        : option === 'light'
                          ? 'Light, whatever the device is set to.'
                          : 'Dark, whatever the device is set to.'}
                    </span>
                  </span>
                </Label>
              )
            })}
          </RadioGroup>
        </SettingsRow>

        <SettingsRow title="Sidebar" description="On wider screens. The button at the foot of the sidebar changes the same setting.">
          <div className="flex items-start justify-between gap-6">
            <div className="grid gap-1">
              <Label htmlFor={sidebarId} className="font-normal">
                Start with the sidebar retracted
              </Label>
              <p id={`${sidebarId}-hint`} className="text-xs text-muted-foreground">
                Icons only, with the page centred. It applies now and the next time you open LeaseGuard here.
              </p>
            </div>
            <Switch id={sidebarId} aria-describedby={`${sidebarId}-hint`} checked={collapsed} onCheckedChange={setSidebarCollapsed} />
          </div>
        </SettingsRow>

        <SettingsRow title="Set by the system" description="These are not choices in LeaseGuard.">
          <dl className="divide-y divide-border text-sm">
            <div className={FACT_ROW}>
              <dt className="font-medium text-foreground">Motion</dt>
              <dd className="text-foreground">
                {reducedMotion ? 'Reduced, as this device asks.' : 'Full. Turn on reduce motion on this device to calm animations.'}
              </dd>
            </div>
            <div className={FACT_ROW}>
              <dt className="font-medium text-foreground">Dates</dt>
              <dd className="text-foreground">
                South African format, for example <DateDisplay value={today} className="tabular-nums" />.
              </dd>
            </div>
          </dl>
        </SettingsRow>
      </div>
    </section>
  )
}
