import { useEffect, useRef } from 'react'

export type TriStateCheckboxState = 'checked' | 'mixed' | 'unchecked'

export interface TriStateCheckboxProps {
  ariaLabel: string
  className?: string
  disabled?: boolean
  onChange: (nextChecked: boolean) => void
  state: TriStateCheckboxState
}

export function TriStateCheckbox({
  ariaLabel,
  className,
  disabled = false,
  onChange,
  state,
}: TriStateCheckboxProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = state === 'mixed'
    }
  }, [state])

  return (
    <input
      aria-checked={state === 'mixed' ? 'mixed' : state === 'checked'}
      aria-label={ariaLabel}
      checked={state === 'checked'}
      className={className}
      disabled={disabled}
      onChange={() => onChange(state !== 'checked')}
      onClick={(event) => event.stopPropagation()}
      ref={inputRef}
      type="checkbox"
    />
  )
}
