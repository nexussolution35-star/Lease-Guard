import { Monitor, Moon, Sun } from 'lucide-react'

import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { setThemePreference, useThemePreference, type ThemePreference } from '@/lib/theme'

const THEME_OPTIONS: readonly { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

function isThemePreference(value: string): value is ThemePreference {
  return THEME_OPTIONS.some((o) => o.value === value)
}

/** Light / dark / system theme choice, for account menus. */
export function ThemeSubMenu() {
  const theme = useThemePreference()
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        {theme === 'dark' ? <Moon aria-hidden="true" /> : theme === 'light' ? <Sun aria-hidden="true" /> : <Monitor aria-hidden="true" />}
        Theme
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            if (isThemePreference(value)) setThemePreference(value)
          }}
        >
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon aria-hidden="true" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
