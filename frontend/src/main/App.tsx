import { useState } from 'react'
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
import { AuthProvider } from './AuthContext'
import { AlertCoordinationService } from './triggers/AlertCoordinationService'
import { TriggerStoreProvider } from './triggers/TriggerStore'
import { UserTriggerManagerProvider } from './triggers/UserTriggerManager'

export function App() {
  const [serverBridgeStatus, setServerBridgeStatus] =
    useState<ServerBridgeStatus>('closed')

  return (
    <MessageBrokerProvider broker={messageBroker}>
      <AuthProvider>
        <ServerBridge onStatusChange={setServerBridgeStatus} />
        <WorkerBridge />
        <TriggerStoreProvider>
          <AlertCoordinationService />
          <UserTriggerManagerProvider>
            <NearbyCharactersProvider>
              <AppShell />
            </NearbyCharactersProvider>
          </UserTriggerManagerProvider>
        </TriggerStoreProvider>
        <ServerConnectionGlass status={serverBridgeStatus} />
        <Toaster position="top-right" />
      </AuthProvider>
    </MessageBrokerProvider>
  )
}
