import { useSender } from '../../shared/messageBrokerHooks'
import { useOnTriggerMatch } from './useTriggerAlerts'

export function TriggerClipboardService() {
  const send = useSender('trigger-clipboard-service')

  useOnTriggerMatch((event) => {
    const clipboardText = event.alert.clipboardText
    if (!clipboardText || clipboardText.trim().length === 0) {
      return
    }

    send('companion.clipboard.write-text', {
      text: clipboardText,
    })
  })

  return null
}
