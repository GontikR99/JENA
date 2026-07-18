import { useContext } from 'react'
import { RollsContext } from './rollsContext'

export function useRolls() {
  const context = useContext(RollsContext)
  if (!context) {
    throw new Error('useRolls must be used within RollsProvider.')
  }

  return context
}
