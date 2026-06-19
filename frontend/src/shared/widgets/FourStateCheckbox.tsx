import './FourStateCheckbox.css'

export type FourStateCheckboxState =
  | 'disabled'
  | 'enabled'
  | 'inherit'
  | 'mixed'

export interface FourStateCheckboxMode {
  cycleOrder: readonly FourStateCheckboxState[]
  mixedNextState: FourStateCheckboxState
}

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

export interface FourStateCheckboxProps {
  ariaLabel?: string
  className?: string
  disabled?: boolean
  id?: string
  label?: string
  mode?: FourStateCheckboxMode
  onChange: (nextState: FourStateCheckboxState) => void
  state: FourStateCheckboxState
  stopPropagation?: boolean
  title?: string
}

export function FourStateCheckbox({
  ariaLabel,
  className = '',
  disabled = false,
  id,
  label,
  mode = QUATERNARY,
  onChange,
  state,
  stopPropagation = true,
  title,
}: FourStateCheckboxProps) {
  const resolvedTitle = title ?? getStateTitle(state)

  return (
    <button
      aria-checked={getAriaChecked(state)}
      aria-label={ariaLabel ?? label}
      className={`four-state-checkbox ${className}`.trim()}
      data-has-label={label ? 'true' : 'false'}
      data-state={state}
      disabled={disabled}
      id={id}
      onClick={(event) => {
        if (stopPropagation) {
          event.stopPropagation()
        }
        onChange(getNextState(state, mode))
      }}
      onKeyDown={(event) => {
        if (event.key !== ' ' && event.key !== 'Enter') {
          return
        }

        event.preventDefault()
        if (stopPropagation) {
          event.stopPropagation()
        }
        onChange(getNextState(state, mode))
      }}
      role="checkbox"
      title={resolvedTitle}
      type="button"
    >
      <span className="four-state-checkbox-mark" aria-hidden="true" />
      {label ? <span className="four-state-checkbox-label">{label}</span> : null}
    </button>
  )
}

function getNextState(
  state: FourStateCheckboxState,
  mode: FourStateCheckboxMode,
): FourStateCheckboxState {
  if (state === 'mixed') {
    return mode.mixedNextState
  }

  const index = mode.cycleOrder.indexOf(state)
  if (index < 0) {
    return mode.cycleOrder[0] ?? state
  }

  return mode.cycleOrder[(index + 1) % mode.cycleOrder.length]
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
