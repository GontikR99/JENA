import { useCallback, useState } from 'react'
import { Toaster } from 'react-hot-toast'
import { messageBroker } from '../shared/messageBroker'
import { MessageBrokerProvider } from '../shared/MessageBrokerProvider'
import { WorkerBridge } from './WorkerBridge'
import { AppShell } from './AppShell'
import {
  ServerBridge,
  ServerConnectionGlass,
  type ServerBridgeStatus,
} from './ServerBridge'
import { NearbyCharactersProvider } from './NearbyCharactersProvider'

export function App() {
  const [serverBridgeStatus, setServerBridgeStatus] =
    useState<ServerBridgeStatus>('closed')
  const getAuthToken = useCallback(() => null, [])

  return (
    <MessageBrokerProvider broker={messageBroker}>
      <ServerBridge
        getAuthToken={getAuthToken}
        onStatusChange={setServerBridgeStatus}
      />
      <WorkerBridge />
      <NearbyCharactersProvider>
        <AppShell />
      </NearbyCharactersProvider>
      <ServerConnectionGlass status={serverBridgeStatus} />
      <Toaster position="top-right" />
    </MessageBrokerProvider>
  )
}
