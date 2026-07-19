import { describe, expect, it } from 'vitest'
import type { RegexMatchFoundMessage } from '../../shared/messages'
import { MatchWorkerEngine } from '../../worker/MatchWorkerEngine'
import {
  addRollCandidate,
  createHistoricalRollCandidate,
  createRollCandidate,
  parseRollText,
  pruneRollHistory,
  replaceRollHistoryRange,
  rollDeduplicationWindowMs,
  rollHistoryDurationMs,
  rollPattern,
} from '../rollModel'
import type { RollCandidate } from '../types'

describe('roll matching and history', () => {
  it('matches the EverQuest magic die format', () => {
    const regex = new RegExp(rollPattern)

    expect(
      regex.exec(
        '**A Magic Die is rolled by Darkpeaches. It could have been any number from 0 to 1000, but this time it turned up a 34.',
      )?.groups,
    ).toEqual({
      lowerBound: '0',
      roller: 'Darkpeaches',
      upperBound: '1000',
      value: '34',
    })
    expect(
      regex.exec(
        '**A Magic Die is rolled by Jephian. It could have been any number from 0 to 1000, but this time it turned up a 1.',
      )?.groups,
    ).toEqual({
      lowerBound: '0',
      roller: 'Jephian',
      upperBound: '1000',
      value: '1',
    })
  })

  it('matches with named captures through the production match engine', async () => {
    const engine = new MatchWorkerEngine('roll-test')
    engine.addPatterns('rolls', [{ pattern: rollPattern }])

    const matches = await engine.matchLines([
      {
        observedAtMs: 10_125.5,
        text: '**A Magic Die is rolled by Darkpeaches. It could have been any number from 0 to 1000, but this time it turned up a 34.',
        timestamp: 'Sat Jun 20 21:32:31 2026',
        timestampMs: 20_000,
      },
    ])

    expect(matches).toHaveLength(1)
    expect(matches[0].captures.named).toEqual({
      lowerBound: '0',
      roller: 'Darkpeaches',
      upperBound: '1000',
      value: '34',
    })
  })

  it('creates candidates from matcher timing and named captures', () => {
    expect(createRollCandidate(createMatch())).toEqual({
      characterName: 'Jephian',
      lowerBound: 0,
      observedAtMs: 10_125.5,
      roller: 'Darkpeaches',
      serverName: 'Fangbreaker',
      timestamp: 'Sat Jun 20 21:32:31 2026',
      timestampMs: 20_000,
      upperBound: 1000,
      value: 34,
    })
  })

  it('parses historical search text without matcher captures', () => {
    const text = createRollText()

    expect(parseRollText(text)).toEqual({
      lowerBound: 0,
      roller: 'Darkpeaches',
      upperBound: 1000,
      value: 34,
    })
    expect(createHistoricalRollCandidate({
      characterName: 'Jephian',
      index: 0,
      rawLine: `[Sat Jun 20 21:32:31 2026] ${text}`,
      searchId: 'roll-search',
      serverName: 'Fangbreaker',
      text,
      timestamp: 'Sat Jun 20 21:32:31 2026',
      timestampMs: 20_000,
    })).toEqual({
      characterName: 'Jephian',
      lowerBound: 0,
      observedAtMs: 20_000,
      roller: 'Darkpeaches',
      serverName: 'Fangbreaker',
      timestamp: 'Sat Jun 20 21:32:31 2026',
      timestampMs: 20_000,
      upperBound: 1000,
      value: 34,
    })
  })

  it('merges matching observations from different character logs within 500ms', () => {
    let nextId = 0
    const createId = () => `roll-${++nextId}`
    let rolls = addRollCandidate([], createCandidate(), createId)

    rolls = addRollCandidate(
      rolls,
      createCandidate({ characterName: 'Joram', observedAtMs: 10_500 }),
      createId,
    )

    expect(rolls).toHaveLength(1)
    expect(rolls[0].observations).toHaveLength(2)
    expect(rolls[0].firstObservedAtMs).toBe(10_000)
    expect(rolls[0].lastObservedAtMs).toBe(10_500)
  })

  it('does not merge observations more than 500ms apart', () => {
    let nextId = 0
    const createId = () => `roll-${++nextId}`
    let rolls = addRollCandidate([], createCandidate(), createId)

    rolls = addRollCandidate(
      rolls,
      createCandidate({
        characterName: 'Joram',
        observedAtMs: 10_000 + rollDeduplicationWindowMs + 1,
      }),
      createId,
    )

    expect(rolls).toHaveLength(2)
  })

  it('merges transitively when a third source bridges two clusters', () => {
    let nextId = 0
    const createId = () => `roll-${++nextId}`
    let rolls = addRollCandidate([], createCandidate(), createId)
    rolls = addRollCandidate(
      rolls,
      createCandidate({ characterName: 'Joram', observedAtMs: 10_800 }),
      createId,
    )

    rolls = addRollCandidate(
      rolls,
      createCandidate({ characterName: 'Jephine', observedAtMs: 10_400 }),
      createId,
    )

    expect(rolls).toHaveLength(1)
    expect(rolls[0].observations.map((entry) => entry.characterName)).toEqual([
      'Jephian',
      'Jephine',
      'Joram',
    ])
  })

  it('keeps repeated rolls from the same log source distinct', () => {
    let nextId = 0
    const createId = () => `roll-${++nextId}`
    let rolls = addRollCandidate([], createCandidate(), createId)

    rolls = addRollCandidate(
      rolls,
      createCandidate({ observedAtMs: 10_100 }),
      createId,
    )

    expect(rolls).toHaveLength(2)
  })

  it('does not merge otherwise identical rolls from different servers', () => {
    let nextId = 0
    const createId = () => `roll-${++nextId}`
    let rolls = addRollCandidate([], createCandidate(), createId)

    rolls = addRollCandidate(
      rolls,
      createCandidate({
        characterName: 'Anotherbox',
        observedAtMs: 10_100,
        serverName: 'Bristlebane',
      }),
      createId,
    )

    expect(rolls).toHaveLength(2)
  })

  it('prunes rolls based on their EverQuest event time', () => {
    let nextId = 0
    const createId = () => `roll-${++nextId}`
    const nowMs = 2 * rollHistoryDurationMs
    const rolls = [
      ...addRollCandidate(
        [],
        createCandidate({ timestampMs: nowMs - rollHistoryDurationMs - 1 }),
        createId,
      ),
      ...addRollCandidate(
        [],
        createCandidate({ timestampMs: nowMs - rollHistoryDurationMs }),
        createId,
      ),
    ]

    expect(pruneRollHistory(rolls, nowMs)).toHaveLength(1)
  })

  it('atomically replaces only the backfilled history range', () => {
    let nextId = 0
    const createId = () => `roll-${++nextId}`
    const currentRolls = [
      ...addRollCandidate(
        [],
        createCandidate({ timestampMs: 10_000 }),
        createId,
      ),
      ...addRollCandidate(
        [],
        createCandidate({ timestampMs: 30_000, value: 35 }),
        createId,
      ),
    ]
    const replacements = addRollCandidate(
      [],
      createCandidate({ timestampMs: 20_000, value: 99 }),
      createId,
    )

    expect(
      replaceRollHistoryRange(currentRolls, replacements, 0, 20_000, 30_000),
    ).toEqual([
      expect.objectContaining({ timestampMs: 20_000, value: 99 }),
      expect.objectContaining({ timestampMs: 30_000, value: 35 }),
    ])
  })
})

function createMatch(): RegexMatchFoundMessage {
  return {
    captures: {
      named: {
        lowerBound: '0',
        roller: 'Darkpeaches',
        upperBound: '1000',
        value: '34',
      },
      positional: ['Darkpeaches', '0', '1000', '34'],
    },
    characterName: 'Jephian',
    observedAtMs: 10_125.5,
    pattern: rollPattern,
    serverName: 'Fangbreaker',
    text: createRollText(),
    timestamp: 'Sat Jun 20 21:32:31 2026',
    timestampMs: 20_000,
  }
}

function createRollText() {
  return '**A Magic Die is rolled by Darkpeaches. It could have been any number from 0 to 1000, but this time it turned up a 34.'
}

function createCandidate(overrides: Partial<RollCandidate> = {}): RollCandidate {
  return {
    characterName: 'Jephian',
    lowerBound: 0,
    observedAtMs: 10_000,
    roller: 'Darkpeaches',
    serverName: 'Fangbreaker',
    timestamp: 'Sat Jun 20 21:32:31 2026',
    timestampMs: 20_000,
    upperBound: 1000,
    value: 34,
    ...overrides,
  }
}
