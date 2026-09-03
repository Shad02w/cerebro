import { Blocks, Settings, SquareTerminal, type LucideIcon } from 'lucide-react'
import type { SettingsSectionId } from '@/lib/app-route'

export type SettingsSection = {
  id: SettingsSectionId
  label: string
  description: string
  icon: LucideIcon
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: 'general',
    label: 'General',
    description: 'Configure where Cerebro clones new repositories.',
    icon: Settings
  },
  {
    id: 'terminal',
    label: 'Terminal',
    description: 'Configure the integrated terminal.',
    icon: SquareTerminal
  },
  {
    id: 'integrations',
    label: 'Integrations',
    description: 'Connect external services and tools.',
    icon: Blocks
  }
]
