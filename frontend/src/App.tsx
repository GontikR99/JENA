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
import { AuthProvider } from './auth/AuthProvider'
import { useAuth } from './auth/authContext'
import { AuthScreen } from './auth/AuthScreen'
import { TriggerShareCoordinator } from './sharing/TriggerShareCoordinator'
import { SettingsProvider } from './settings/SettingsProvider'
import { SpeechVoiceProvider } from './settings/SpeechVoiceProvider'
import {
  TriggerRuntimePortal,
  TriggerRuntimeProvider,
} from './runtime/TriggerRuntime'
import { AlertCoordinationService } from './triggers/alerts/AlertCoordinationService'
import { AlertEventCoordinatorProvider } from './triggers/alerts/AlertEventCoordinator'
import { BroadcastReflector } from './triggers/alerts/BroadcastReflector'
import { TriggerSpeechService } from './triggers/alerts/TriggerSpeechService'
import { TriggerStopService } from './triggers/alerts/TriggerStopService'
import { TriggerStoreProvider } from './triggers/model/TriggerStore'
import { SubscribedTriggerManagerProvider } from './triggers/model/SubscribedTriggerManager'
import { UserTriggerManagerProvider } from './triggers/model/UserTriggerManager'

export function App() {
  const [serverBridgeStatus, setServerBridgeStatus] =
    useState<ServerBridgeStatus>('closed')

  return (
    <MessageBrokerProvider broker={messageBroker}>
      <AuthProvider>
        <SpeechVoiceProvider>
          <SettingsProvider>
            <ServerBridge onStatusChange={setServerBridgeStatus} />
            <AuthenticatedApp />
            <ServerConnectionGlass status={serverBridgeStatus} />
            <Toaster position="top-right" />
          </SettingsProvider>
        </SpeechVoiceProvider>
      </AuthProvider>
    </MessageBrokerProvider>
  )
}

function AuthenticatedApp() {
  const { status } = useAuth()

  if (status === 'checking') {
    return <AuthScreen />
  }

  return (
    <>
      <WorkerBridge />
      <TriggerStoreProvider>
        <AlertCoordinationService />
        <TriggerStopService />
        <SubscribedTriggerManagerProvider>
          <UserTriggerManagerProvider>
            <LocalCharactersProvider>
              <TriggerRuntimeProvider>
                <AlertEventCoordinatorProvider>
                  <BroadcastReflector />
                  <TriggerSpeechService />
                  <TriggerShareCoordinator>
                    <AppShell />
                  </TriggerShareCoordinator>
                  <TriggerRuntimePortal />
                </AlertEventCoordinatorProvider>
              </TriggerRuntimeProvider>
            </LocalCharactersProvider>
          </UserTriggerManagerProvider>
        </SubscribedTriggerManagerProvider>
      </TriggerStoreProvider>
    </>
  )
}
