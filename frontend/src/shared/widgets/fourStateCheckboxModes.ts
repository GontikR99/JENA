import type { FourStateCheckboxMode } from './FourStateCheckbox'

export const BINARY = {
  cycleOrder: ['disabled', 'enabled'],
  mixedNextState: 'enabled',
} satisfies FourStateCheckboxMode

export const TERNARY = {
  cycleOrder: ['disabled', 'enabled'],
  mixedNextState: 'enabled',
} satisfies FourStateCheckboxMode

export const QUATERNARY = {
  cycleOrder: ['inherit', 'enabled', 'disabled'],
  mixedNextState: 'inherit',
} satisfies FourStateCheckboxMode
