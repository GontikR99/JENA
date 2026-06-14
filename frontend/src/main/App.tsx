import { Toaster } from 'react-hot-toast'
import { messageBroker } from '../shared/messageBroker'
import { MessageBrokerProvider } from '../shared/MessageBrokerProvider'
import { WorkerBridge } from './WorkerBridge'
import { AppShell } from './AppShell'

export function App() {
  return (
    <MessageBrokerProvider broker={messageBroker}>
      <WorkerBridge />
      <AppShell />
      <Toaster position="top-right" />
    </MessageBrokerProvider>
  )
}
