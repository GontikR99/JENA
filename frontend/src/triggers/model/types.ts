import type { JenaTriggerId } from '../../shared/triggers'

export interface TriggerLogRecord {
  characterName: string
  id: string
  logLine: string
  serverName: string
  timestamp: string
  triggerId: JenaTriggerId
  triggerName: string
}
