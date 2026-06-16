import { useState } from 'react'
import { Toaster } from 'react-hot-toast'
import { messageBroker } from './shared/messageBroker'
import { MessageBrokerProvider } from './shared/MessageBrokerProvider'
import { WorkerBridge } from './bridges/worker/WorkerBridge'
import { AppShell } from './AppShell'
import {
  ServerBridge,
  ServerConnectionGlass,
  type ServerBridgeStatus,
} from './bridges/server/ServerBridge'
import { LocalCharactersProvider } from './characters/LocalCharactersProvider'
import { NearbyCharactersProvider } from './characters/NearbyCharactersProvider'
import { AuthProvider } from './auth/AuthContext'
import {
  TriggerRuntimePortal,
  TriggerRuntimeProvider,
} from './runtime/TriggerRuntime'
import { AlertCoordinationService } from './triggers/alerts/AlertCoordinationService'
import { TriggerSpeechService } from './triggers/alerts/TriggerSpeechService'
import { TriggerStoreProvider } from './triggers/model/TriggerStore'
import { UserTriggerManagerProvider } from './triggers/model/UserTriggerManager'

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
              <LocalCharactersProvider>
                <TriggerRuntimeProvider>
                  <TriggerSpeechService />
                  <AppShell />
                  <TriggerRuntimePortal />
                </TriggerRuntimeProvider>
              </LocalCharactersProvider>
            </NearbyCharactersProvider>
          </UserTriggerManagerProvider>
        </TriggerStoreProvider>
        <ServerConnectionGlass status={serverBridgeStatus} />
        <Toaster position="top-right" />
      </AuthProvider>
    </MessageBrokerProvider>
  )
}
