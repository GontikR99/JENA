import type { JenaTriggerId } from '../../shared/triggers'

export type TriggerRevealRequest =
  | {
      id: number
      target: 'user'
      triggerId: JenaTriggerId
    }
  | {
      id: number
      subscriptionId: string
      target: 'subscription'
      triggerId: JenaTriggerId
    }

export interface TriggerLogRecord {
  characterName: string
  id: string
  logLine: string
  serverName: string
  subscriptionId?: string
  timestamp: string
  triggerId: JenaTriggerId
  triggerName: string
}
