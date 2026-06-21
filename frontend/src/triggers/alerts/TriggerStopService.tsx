import { useEffect } from 'react'
import type {
  RegexMatchFoundMessage,
  TriggerStopRequestedMessage,
} from '../../shared/messages'
import { useListen, useRpc, useSender } from '../../shared/messageBrokerHooks'

export const triggerStopPattern = '(?i)\\{(?:JENA|GINA):STOP\\}'

export function TriggerStopService() {
  const call = useRpc('trigger-stop-service')
  const send = useSender('trigger-stop-service')

  useEffect(() => {
    void call('worker.matcher-service', 'add-patterns', {
      namespace: 'stop',
      patterns: [{ pattern: triggerStopPattern }],
    }).catch((error: unknown) => {
      console.warn('[TriggerStopService] stop pattern registration failed', {
        error,
      })
    })
  }, [call])

  useListen('matcher.match-found', (message) => {
    const match = message.payload as RegexMatchFoundMessage
    if (match.pattern !== triggerStopPattern) {
      return
    }

    send('alert.stop-requested', createStopRequestedPayload(match))
  })

  return null
}

function createStopRequestedPayload(
  match: RegexMatchFoundMessage,
): TriggerStopRequestedMessage {
  const command = getStopCommand(match.text)

  return {
    characterName: match.characterName,
    command,
    serverName: match.serverName,
    text: match.text,
    timestamp: match.timestamp,
  }
}

function getStopCommand(text: string): TriggerStopRequestedMessage['command'] {
  const match = /\{(JENA|GINA):STOP\}/i.exec(text)

  return match?.[1].toLocaleUpperCase() === 'GINA'
    ? '{GINA:STOP}'
    : '{JENA:STOP}'
}
