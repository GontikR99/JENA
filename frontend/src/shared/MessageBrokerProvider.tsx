import type { ReactNode } from 'react'
import type { MessageBroker } from './messageBroker'
import { MessageBrokerContext } from './messageBrokerContext'

interface MessageBrokerProviderProps {
  broker: MessageBroker
  children: ReactNode
}

export function MessageBrokerProvider({
  broker,
  children,
}: MessageBrokerProviderProps) {
  return (
    <MessageBrokerContext.Provider value={broker}>
      {children}
    </MessageBrokerContext.Provider>
  )
}
