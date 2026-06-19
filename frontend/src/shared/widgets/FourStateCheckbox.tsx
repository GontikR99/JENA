import './FourStateCheckbox.css'

export type FourStateCheckboxState =
  | 'disabled'
  | 'enabled'
  | 'inherit'
  | 'mixed'

export interface FourStateCheckboxProps {
  ariaLabel: string
  className?: string
  disabled?: boolean
  onChange: (nextState: FourStateCheckboxState) => void
  state: FourStateCheckboxState
  title?: string
}

const cycleOrder: FourStateCheckboxState[] = [
  'inherit',
  'enabled',
  'disabled',
]

export function FourStateCheckbox({
  ariaLabel,
  className = '',
  disabled = false,
  onChange,
  state,
  title,
}: FourStateCheckboxProps) {
  const resolvedTitle = title ?? getStateTitle(state)

  return (
    <button
      aria-checked={getAriaChecked(state)}
      aria-label={ariaLabel}
      className={`four-state-checkbox ${className}`.trim()}
      data-state={state}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onChange(getNextState(state))
      }}
      onKeyDown={(event) => {
        if (event.key !== ' ' && event.key !== 'Enter') {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        onChange(getNextState(state))
      }}
      role="checkbox"
      title={resolvedTitle}
      type="button"
    >
      <span className="four-state-checkbox-mark" aria-hidden="true" />
    </button>
  )
}

function getNextState(state: FourStateCheckboxState): FourStateCheckboxState {
  if (state === 'mixed') {
    return 'inherit'
  }

  const index = cycleOrder.indexOf(state)
  return cycleOrder[(index + 1) % cycleOrder.length]
}

function getAriaChecked(state: FourStateCheckboxState) {
  if (state === 'mixed') {
    return 'mixed'
  }

  return state === 'enabled'
}

function getStateTitle(state: FourStateCheckboxState) {
  switch (state) {
    case 'disabled':
      return 'Always disabled'
    case 'enabled':
      return 'Always enabled'
    case 'inherit':
      return 'Use subscription default'
    case 'mixed':
      return 'Mixed'
  }
}
