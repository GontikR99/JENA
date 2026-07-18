import { createContext } from 'react'
import type { RollRecord } from './types'

export interface RollsContextValue {
  rolls: RollRecord[]
}

export const RollsContext = createContext<RollsContextValue | null>(null)
