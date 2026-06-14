import { createContext } from 'react'
import type { ClientEventBus } from './clientEventBus'

export const ClientEventBusContext = createContext<ClientEventBus | null>(null)
