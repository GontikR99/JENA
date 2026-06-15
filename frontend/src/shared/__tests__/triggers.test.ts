import { describe, expect, it } from 'vitest'
import {
  createEmptyTrigger,
  withCanonicalTriggerId,
  type JenaTrigger,
} from '../triggers'

describe('withCanonicalTriggerId', () => {
  it('returns a copy with an id derived from trigger content', async () => {
    const trigger = createTestTrigger({
      id: 'temporary-id',
      name: 'Test Trigger',
    })

    const canonicalTrigger = withCanonicalTriggerId(trigger)

    expect(canonicalTrigger).not.toBe(trigger)
    expect(canonicalTrigger).toEqual({
      ...trigger,
      id: canonicalTrigger.id,
    })
    expect(canonicalTrigger.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
    expect(trigger.id).toBe('temporary-id')
  })

  it('ignores the existing id when deriving the canonical id', async () => {
    const first = withCanonicalTriggerId(
      createTestTrigger({
        id: 'first-id',
        name: 'Same Trigger',
      }),
    )
    const second = withCanonicalTriggerId(
      createTestTrigger({
        id: 'second-id',
        name: 'Same Trigger',
      }),
    )

    expect(second.id).toBe(first.id)
  })

  it('changes the canonical id when trigger content changes', async () => {
    const first = withCanonicalTriggerId(
      createTestTrigger({
        name: 'First Trigger',
      }),
    )
    const second = withCanonicalTriggerId(
      createTestTrigger({
        name: 'Second Trigger',
      }),
    )

    expect(second.id).not.toBe(first.id)
  })

  it('returns a deep canonical copy', () => {
    const trigger = createTestTrigger({
      actions: {
        clipboard: {
          enabled: true,
          text: 'Copy',
        },
        display: {
          enabled: true,
          text: 'Display',
        },
        speech: {
          enabled: true,
          interrupt: true,
          text: 'Speak',
        },
      },
      groupPath: ['Raid', 'Boss'],
      timer: {
        type: 'countdown',
        name: 'Timer',
        durationMs: 10_000,
        startBehavior: 'restart',
        warningSeconds: 5,
        warningAction: null,
        endedAction: null,
        earlyEnders: ['done'],
      },
    })

    const canonicalTrigger = withCanonicalTriggerId(trigger)

    canonicalTrigger.groupPath.push('Changed')
    canonicalTrigger.actions.display.text = 'Changed display'
    canonicalTrigger.timer?.earlyEnders.push('changed')

    expect(trigger.groupPath).toEqual(['Raid', 'Boss'])
    expect(trigger.actions.display.text).toBe('Display')
    expect(trigger.timer?.earlyEnders).toEqual(['done'])
  })

  it('does not depend on nested object property insertion order', () => {
    const first = withCanonicalTriggerId(
      createTestTrigger({
        actions: {
          speech: {
            text: 'Speak',
            interrupt: true,
            enabled: true,
          },
          clipboard: {
            text: 'Copy',
            enabled: true,
          },
          display: {
            text: 'Display',
            enabled: true,
          },
        },
        timer: {
          earlyEnders: ['done'],
          endedAction: {
            speech: {
              interrupt: false,
              text: 'Ended speech',
              enabled: true,
            },
            display: {
              text: 'Ended display',
              enabled: true,
            },
          },
          warningAction: {
            speech: {
              text: 'Warning speech',
              interrupt: true,
              enabled: true,
            },
            display: {
              enabled: true,
              text: 'Warning display',
            },
          },
          warningSeconds: 5,
          startBehavior: 'restart',
          durationMs: 10_000,
          name: 'Timer',
          type: 'countdown',
        },
      }),
    )
    const second = withCanonicalTriggerId(
      createTestTrigger({
        actions: {
          display: {
            enabled: true,
            text: 'Display',
          },
          speech: {
            enabled: true,
            text: 'Speak',
            interrupt: true,
          },
          clipboard: {
            enabled: true,
            text: 'Copy',
          },
        },
        timer: {
          type: 'countdown',
          name: 'Timer',
          durationMs: 10_000,
          startBehavior: 'restart',
          warningSeconds: 5,
          warningAction: {
            display: {
              enabled: true,
              text: 'Warning display',
            },
            speech: {
              enabled: true,
              text: 'Warning speech',
              interrupt: true,
            },
          },
          endedAction: {
            display: {
              enabled: true,
              text: 'Ended display',
            },
            speech: {
              enabled: true,
              text: 'Ended speech',
              interrupt: false,
            },
          },
          earlyEnders: ['done'],
        },
      }),
    )

    expect(second.id).toBe(first.id)
  })
})

function createTestTrigger(overrides: Partial<JenaTrigger> = {}): JenaTrigger {
  return {
    ...createEmptyTrigger(),
    match: '^test$',
    ...overrides,
  }
}
