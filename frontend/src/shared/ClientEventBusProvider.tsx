import type { ReactNode } from 'react'
import type { ClientEventBus } from './clientEventBus'
import { ClientEventBusContext } from './clientEventBusContext'

interface ClientEventBusProviderProps {
  bus: ClientEventBus
  children: ReactNode
}

export function ClientEventBusProvider({
  bus,
  children,
}: ClientEventBusProviderProps) {
  return (
    <ClientEventBusContext.Provider value={bus}>
      {children}
    </ClientEventBusContext.Provider>
  )
}
