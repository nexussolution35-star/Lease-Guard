import { DATE_DISPLAY_FORMATS, formatDisplayDate, isDateDisplayFormat, isoToday, type DateDisplayFormat } from '@leaseguard/domain'
import { useId, useState } from 'react'

import { SETTINGS_SECTIONS } from '@/components/forms'
import { PageHeader } from '@/components/layout/PageHeader'
import { setSidebarCollapsed, useSidebarCollapsed } from '@/components/layout/useSidebarCollapsed'
import { StatusDot } from '@/components/shared'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { SettingsRow } from '@/features/company/components/SettingsRow'
import { canRememberBrowserPreferences } from '@/lib/browserStorage'
import { setDateFormatPreference, useDateFormatPreference } from '@/lib/dateFormat'
import { isMotionPreference, MOTION_PREFERENCES, setMotionPreference, useMotionPreference, useSystemReducedMotion, type MotionPreference } from '@/lib/motion'
import { isThemePreference, setThemePreference, useSystemColorScheme, useThemePreference, type ThemePreference } from '@/lib/theme'

const THEME_LABELS: Record<ThemePreference, string> = { light: 'Light', dark: 'Dark', system: 'System' }
const THEME_ORDER: readonly ThemePreference[] = ['system', 'light', 'dark']
const DATE_FORMAT_HINTS: Record<DateDisplayFormat, string> = {
  'dd-mmm-yyyy': 'Day, short month, year. The South African default.',
  'd-mmmm-yyyy': 'Day, month in full, year.',
  'dd/mm/yyyy': 'Day, month and year in figures.',
  'yyyy/mm/dd': 'Year, month and day in figures.',
  'mmm-d-yyyy': 'Short month, day, year.',
  'yyyy-mm-dd': 'Year, month and day, ISO 8601.',
}
const MOTION_LABELS: Record<MotionPreference, string> = { system: 'System', reduce: 'Reduce motion', full: 'Full motion' }
/** One radio option: its label, then a muted hint the radio is described by. */
const OPTION_LABEL = 'items-start gap-3 font-normal'

/**
 * Settings → Preferences: display preferences for this browser (theme, sidebar start state, date format, motion).
 * Viewer conveniences, not business data: they apply at once, are remembered in this browser only, and still
 * apply for the session when the browser will not store them. The date format changes how dates read on screen
 * only: records, messages to tenants and audit text keep their dates as they are.
 */
export function PreferencesScreen() {
  const theme = useThemePreference()
  const systemScheme = useSystemColorScheme()
  const [collapsed] = useSidebarCollapsed()
  const dateFormat = useDateFormatPreference()
  const motion = useMotionPreference()
  const systemReducedMotion = useSystemReducedMotion()
  // Checked once: whether storage works does not change while the page is open.
  const [remembered] = useState(canRememberBrowserPreferences)
  const [today] = useState(() => isoToday(new Date()))
  const themeId = useId()
  const sidebarId = useId()
  const dateFormatId = useId()
  const motionId = useId()

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
                <Label key={option} htmlFor={itemId} className={OPTION_LABEL}>
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

        <SettingsRow
          title="Date format"
          description="How dates read on screen in this browser. Records keep their dates, and messages to tenants use the South African format."
        >
          <RadioGroup
            aria-label="Date format"
            value={dateFormat}
            onValueChange={(value) => {
              if (isDateDisplayFormat(value)) setDateFormatPreference(value)
            }}
          >
            {DATE_DISPLAY_FORMATS.map((option) => {
              const itemId = `${dateFormatId}-${option}`
              return (
                <Label key={option} htmlFor={itemId} className={OPTION_LABEL}>
                  <RadioGroupItem id={itemId} value={option} aria-describedby={`${itemId}-hint`} className="mt-0.5" />
                  <span className="grid gap-1">
                    <span className="tabular-nums">{formatDisplayDate(today, option)}</span>
                    <span id={`${itemId}-hint`} className="text-xs text-muted-foreground">
                      {DATE_FORMAT_HINTS[option]}
                    </span>
                  </span>
                </Label>
              )
            })}
          </RadioGroup>
        </SettingsRow>

        <SettingsRow title="Motion" description="Transitions and animations, such as the sidebar sliding open and menus fading in.">
          <RadioGroup
            aria-label="Motion"
            value={motion}
            onValueChange={(value) => {
              if (isMotionPreference(value)) setMotionPreference(value)
            }}
          >
            {MOTION_PREFERENCES.map((option) => {
              const itemId = `${motionId}-${option}`
              return (
                <Label key={option} htmlFor={itemId} className={OPTION_LABEL}>
                  <RadioGroupItem id={itemId} value={option} aria-describedby={`${itemId}-hint`} className="mt-0.5" />
                  <span className="grid gap-1">
                    <span>{MOTION_LABELS[option]}</span>
                    <span id={`${itemId}-hint`} className="text-xs text-muted-foreground">
                      {option === 'system'
                        ? `Follows this device's setting, currently ${systemReducedMotion ? 'reduced' : 'full'} motion.`
                        : option === 'reduce'
                          ? 'Turns off transitions and animations, the sidebar slide included.'
                          : 'Shows transitions and animations even when this device asks for less.'}
                    </span>
                  </span>
                </Label>
              )
            })}
          </RadioGroup>
        </SettingsRow>
      </div>
    </section>
  )
}
