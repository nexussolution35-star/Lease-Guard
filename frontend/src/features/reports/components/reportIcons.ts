import {
  Activity,
  Building2,
  CalendarCheck,
  CalendarClock,
  DoorOpen,
  FileText,
  Handshake,
  MessageSquare,
  ShieldCheck,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

/** The Lucide icon each catalogue entry names (packages/domain REPORT_CATALOGUE `icon`). */
const REPORT_ICONS: Readonly<Record<string, LucideIcon>> = {
  activity: Activity,
  'building-2': Building2,
  'calendar-check': CalendarCheck,
  'calendar-clock': CalendarClock,
  'door-open': DoorOpen,
  'file-text': FileText,
  handshake: Handshake,
  'message-square': MessageSquare,
  'shield-check': ShieldCheck,
  'trending-up': TrendingUp,
  wallet: Wallet,
}

export function reportIcon(name: string): LucideIcon {
  return REPORT_ICONS[name] ?? FileText
}
