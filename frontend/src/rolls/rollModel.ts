import type {
  LogSearchMatchMessage,
  RegexMatchFoundMessage,
} from '../shared/messages'
import type { RollCandidate, RollObservation, RollRecord } from './types'

export const rollPattern =
  '^\\*\\*A Magic Die is rolled by (?<roller>.+?)[.] It could have been any number from (?<lowerBound>-?\\d+) to (?<upperBound>-?\\d+), but this time it turned up a (?<value>-?\\d+)[.]$'

export const rollHistoryDurationMs = 60 * 60 * 1000
export const rollDeduplicationWindowMs = 500

const rollRegex = new RegExp(rollPattern)

export interface ParsedRollText {
  lowerBound: number
  roller: string
  upperBound: number
  value: number
}

export function createRollCandidate(
  match: RegexMatchFoundMessage,
): RollCandidate | null {
  if (
    match.pattern !== rollPattern ||
    !Number.isFinite(match.observedAtMs) ||
    !Number.isFinite(match.timestampMs)
  ) {
    return null
  }

  const parsedRoll = parseRollText(match.text)
  if (!parsedRoll) {
    return null
  }

  return {
    characterName: match.characterName,
    lowerBound: parsedRoll.lowerBound,
    observedAtMs: match.observedAtMs as number,
    roller: parsedRoll.roller,
    serverName: match.serverName,
    timestamp: match.timestamp,
    timestampMs: match.timestampMs as number,
    upperBound: parsedRoll.upperBound,
    value: parsedRoll.value,
  }
}

export function createHistoricalRollCandidate(
  match: LogSearchMatchMessage,
): RollCandidate | null {
  if (!Number.isFinite(match.timestampMs)) {
    return null
  }

  const parsedRoll = parseRollText(match.text)
  if (!parsedRoll) {
    return null
  }

  return {
    characterName: match.characterName,
    lowerBound: parsedRoll.lowerBound,
    observedAtMs: match.timestampMs,
    roller: parsedRoll.roller,
    serverName: match.serverName,
    timestamp: match.timestamp,
    timestampMs: match.timestampMs,
    upperBound: parsedRoll.upperBound,
    value: parsedRoll.value,
  }
}

export function parseRollText(text: string): ParsedRollText | null {
  const match = rollRegex.exec(text)
  const roller = match?.groups?.roller?.trim()
  const lowerBound = parseSafeInteger(match?.groups?.lowerBound)
  const upperBound = parseSafeInteger(match?.groups?.upperBound)
  const value = parseSafeInteger(match?.groups?.value)

  if (
    !roller ||
    lowerBound === null ||
    upperBound === null ||
    value === null
  ) {
    return null
  }

  return { lowerBound, roller, upperBound, value }
}

export function addRollCandidate(
  rolls: RollRecord[],
  candidate: RollCandidate,
  createId: () => string,
) {
  const candidateSource = getObservationSourceKey(candidate)
  const connectableRolls = rolls
    .filter((roll) => {
      return (
        isSameRollIdentity(roll, candidate) &&
        !roll.observations.some(
          (observation) =>
            getObservationSourceKey(observation) === candidateSource,
        ) &&
        isWithinDeduplicationWindow(roll, candidate.observedAtMs)
      )
    })
    .sort((left, right) => {
      const distanceComparison =
        getDistanceFromRoll(left, candidate.observedAtMs) -
        getDistanceFromRoll(right, candidate.observedAtMs)

      return distanceComparison || left.firstObservedAtMs - right.firstObservedAtMs
    })

  if (connectableRolls.length === 0) {
    return sortRolls([...rolls, createRollRecord(candidate, createId())])
  }

  const rollsToMerge: RollRecord[] = []
  const mergedSourceKeys = new Set([candidateSource])

  connectableRolls.forEach((roll) => {
    const sourceKeys = roll.observations.map(getObservationSourceKey)
    if (sourceKeys.some((sourceKey) => mergedSourceKeys.has(sourceKey))) {
      return
    }

    rollsToMerge.push(roll)
    sourceKeys.forEach((sourceKey) => mergedSourceKeys.add(sourceKey))
  })

  const mergedRoll = mergeRolls(rollsToMerge, candidate)
  const mergedIds = new Set(rollsToMerge.map((roll) => roll.id))

  return sortRolls([
    ...rolls.filter((roll) => !mergedIds.has(roll.id)),
    mergedRoll,
  ])
}

export function pruneRollHistory(rolls: RollRecord[], nowMs: number) {
  const cutoffMs = nowMs - rollHistoryDurationMs
  const nextRolls = rolls.filter((roll) => roll.timestampMs >= cutoffMs)

  return nextRolls.length === rolls.length ? rolls : nextRolls
}

export function replaceRollHistoryRange(
  rolls: RollRecord[],
  replacements: RollRecord[],
  startMs: number,
  endMs: number,
  nowMs: number,
) {
  return pruneRollHistory(
    sortRolls([
      ...rolls.filter(
        (roll) => roll.timestampMs < startMs || roll.timestampMs > endMs,
      ),
      ...replacements,
    ]),
    nowMs,
  )
}

function createRollRecord(candidate: RollCandidate, id: string): RollRecord {
  return {
    firstObservedAtMs: candidate.observedAtMs,
    id,
    lastObservedAtMs: candidate.observedAtMs,
    lowerBound: candidate.lowerBound,
    observations: [createObservation(candidate)],
    roller: candidate.roller,
    serverName: candidate.serverName,
    timestamp: candidate.timestamp,
    timestampMs: candidate.timestampMs,
    upperBound: candidate.upperBound,
    value: candidate.value,
  }
}

function mergeRolls(rolls: RollRecord[], candidate: RollCandidate) {
  const oldestRoll = [...rolls].sort(
    (left, right) => left.firstObservedAtMs - right.firstObservedAtMs,
  )[0]
  const observations = [
    ...rolls.flatMap((roll) => roll.observations),
    createObservation(candidate),
  ].sort((left, right) => left.observedAtMs - right.observedAtMs)
  const earliestTimestampObservation = [...observations].sort(
    (left, right) =>
      left.timestampMs - right.timestampMs ||
      left.observedAtMs - right.observedAtMs,
  )[0]

  return {
    firstObservedAtMs: observations[0].observedAtMs,
    id: oldestRoll.id,
    lastObservedAtMs: observations.at(-1)?.observedAtMs ?? candidate.observedAtMs,
    lowerBound: candidate.lowerBound,
    observations,
    roller: candidate.roller,
    serverName: candidate.serverName,
    timestamp: earliestTimestampObservation.timestamp,
    timestampMs: earliestTimestampObservation.timestampMs,
    upperBound: candidate.upperBound,
    value: candidate.value,
  } satisfies RollRecord
}

function createObservation(candidate: RollCandidate): RollObservation {
  return {
    characterName: candidate.characterName,
    observedAtMs: candidate.observedAtMs,
    serverName: candidate.serverName,
    timestamp: candidate.timestamp,
    timestampMs: candidate.timestampMs,
  }
}

function isSameRollIdentity(roll: RollRecord, candidate: RollCandidate) {
  return (
    normalizeText(roll.serverName) === normalizeText(candidate.serverName) &&
    normalizeText(roll.roller) === normalizeText(candidate.roller) &&
    roll.lowerBound === candidate.lowerBound &&
    roll.upperBound === candidate.upperBound &&
    roll.value === candidate.value
  )
}

function isWithinDeduplicationWindow(
  roll: RollRecord,
  observedAtMs: number,
) {
  return (
    observedAtMs >= roll.firstObservedAtMs - rollDeduplicationWindowMs &&
    observedAtMs <= roll.lastObservedAtMs + rollDeduplicationWindowMs
  )
}

function getDistanceFromRoll(roll: RollRecord, observedAtMs: number) {
  if (observedAtMs < roll.firstObservedAtMs) {
    return roll.firstObservedAtMs - observedAtMs
  }

  if (observedAtMs > roll.lastObservedAtMs) {
    return observedAtMs - roll.lastObservedAtMs
  }

  return 0
}

function getObservationSourceKey(
  observation: Pick<RollObservation, 'characterName' | 'serverName'>,
) {
  return `${normalizeText(observation.serverName)}\0${normalizeText(observation.characterName)}`
}

function normalizeText(value: string) {
  return value.trim().toLocaleLowerCase()
}

function parseSafeInteger(value: string | null | undefined) {
  if (!value || !/^-?\d+$/.test(value)) {
    return null
  }

  const parsedValue = Number(value)
  return Number.isSafeInteger(parsedValue) ? parsedValue : null
}

function sortRolls(rolls: RollRecord[]) {
  return rolls.sort((left, right) => {
    return (
      left.timestampMs - right.timestampMs ||
      left.firstObservedAtMs - right.firstObservedAtMs ||
      left.id.localeCompare(right.id)
    )
  })
}
