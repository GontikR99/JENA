import { Toaster } from 'react-hot-toast'
import { clientEventBus } from '../shared/clientEventBus'
import { ClientEventBusProvider } from '../shared/ClientEventBusProvider'
import { StartupButton } from './StartupButton'

export function App() {
  return (
    <ClientEventBusProvider bus={clientEventBus}>
      <StartupButton onPipChange={() => undefined} />
      <Toaster position="top-right" />
    </ClientEventBusProvider>
  )
}
