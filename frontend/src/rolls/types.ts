export interface RollObservation {
  characterName: string
  observedAtMs: number
  serverName: string
  timestamp: string
  timestampMs: number
}

export interface RollRecord {
  firstObservedAtMs: number
  id: string
  lastObservedAtMs: number
  lowerBound: number
  observations: RollObservation[]
  roller: string
  serverName: string
  timestamp: string
  timestampMs: number
  upperBound: number
  value: number
}

export interface RollTimeRange {
  beginMs: number | null
  endMs: number | null
}

export interface RollCandidate extends RollObservation {
  lowerBound: number
  roller: string
  upperBound: number
  value: number
}
