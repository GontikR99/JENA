import { Toaster } from 'react-hot-toast'
import { messageBroker } from '../shared/messageBroker'
import { MessageBrokerProvider } from '../shared/MessageBrokerProvider'
import { WorkerBridge } from './WorkerBridge'
import { StartupButton } from './StartupButton'

export function App() {
  return (
    <MessageBrokerProvider broker={messageBroker}>
      <WorkerBridge />
      <StartupButton onPipChange={() => undefined} />
      <Toaster position="top-right" />
    </MessageBrokerProvider>
  )
}
