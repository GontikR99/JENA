import { Toaster } from 'react-hot-toast'
import { StartupButton } from './StartupButton'

export function App() {
  return (
    <>
      <StartupButton onPipChange={() => undefined} />
      <Toaster position="top-right" />
    </>
  )
}
