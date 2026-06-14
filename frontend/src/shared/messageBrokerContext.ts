import { createContext } from 'react'
import type { MessageBroker } from './messageBroker'

export const MessageBrokerContext = createContext<MessageBroker | null>(null)
