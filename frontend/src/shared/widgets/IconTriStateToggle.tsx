import { Minus, type LucideIcon } from 'lucide-react'
import './IconTriStateToggle.css'

export type IconTriStateToggleState = 'checked' | 'mixed' | 'unchecked'

export interface IconTriStateToggleProps {
  checkedIcon: LucideIcon
  disabled?: boolean
  label: string
  mixedLabel?: string
  onToggle: (nextChecked: boolean) => void
  state: IconTriStateToggleState
  uncheckedIcon: LucideIcon
}

export function IconTriStateToggle({
  checkedIcon: CheckedIcon,
  disabled = false,
  label,
  mixedLabel,
  onToggle,
  state,
  uncheckedIcon: UncheckedIcon,
}: IconTriStateToggleProps) {
  const Icon = state === 'unchecked' ? UncheckedIcon : CheckedIcon
  const title = state === 'mixed' && mixedLabel ? mixedLabel : label

  return (
    <button
      aria-checked={state === 'mixed' ? 'mixed' : state === 'checked'}
      aria-label={title}
      className="icon-tri-state-toggle"
      data-state={state}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onToggle(state !== 'checked')
      }}
      role="checkbox"
      title={title}
      type="button"
    >
      <Icon aria-hidden="true" size={15} strokeWidth={2} />
      {state === 'mixed' ? (
        <span className="icon-tri-state-toggle-badge">
          <Minus aria-hidden="true" size={8} strokeWidth={3} />
        </span>
      ) : null}
    </button>
  )
}
