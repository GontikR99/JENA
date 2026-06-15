import { describe, expect, it, vi } from 'vitest'
import {
  createEmptyTrigger,
  withCanonicalTriggerId,
  type JenaTrigger,
  type JenaTriggerId,
} from '../../shared/triggers'
import {
  InMemoryTriggerCache,
  WriteThroughTriggerStore,
} from '../triggers/TriggerStore'

describe('WriteThroughTriggerStore', () => {
  it('stores only novel triggers and returns results in input order', async () => {
    const firstTrigger = createTestTrigger('First Trigger')
    const secondTrigger = createTestTrigger('Second Trigger')
    const server = createServer()
    const store = new WriteThroughTriggerStore(server, new InMemoryTriggerCache())

    const firstResult = await store.storeTriggers([firstTrigger, secondTrigger])
    const secondResult = await store.storeTriggers([secondTrigger, firstTrigger])

    expect(firstResult).toEqual([firstTrigger, secondTrigger])
    expect(secondResult).toEqual([secondTrigger, firstTrigger])
    expect(server.storeTriggers).toHaveBeenCalledTimes(1)
    expect(server.storeTriggers).toHaveBeenCalledWith([
      firstTrigger,
      secondTrigger,
    ])
    expect(server.fetchTriggers).not.toHaveBeenCalled()
  })

  it('fetches only missing triggers and preserves requested order', async () => {
    const firstTrigger = createTestTrigger('First Trigger')
    const secondTrigger = createTestTrigger('Second Trigger')
    const server = createServer({
      triggers: [firstTrigger, secondTrigger],
    })
    const store = new WriteThroughTriggerStore(server, new InMemoryTriggerCache())

    await store.storeTriggers([firstTrigger])
    const result = await store.fetchTriggers([secondTrigger.id, firstTrigger.id])

    expect(result).toEqual([secondTrigger, firstTrigger])
    expect(server.fetchTriggers).toHaveBeenCalledTimes(1)
    expect(server.fetchTriggers).toHaveBeenCalledWith([secondTrigger.id])
  })

  it('does not call the server for empty store or fetch requests', async () => {
    const server = createServer()
    const store = new WriteThroughTriggerStore(server, new InMemoryTriggerCache())

    await expect(store.storeTriggers([])).resolves.toEqual([])
    await expect(store.fetchTriggers([])).resolves.toEqual([])

    expect(server.storeTriggers).not.toHaveBeenCalled()
    expect(server.fetchTriggers).not.toHaveBeenCalled()
  })

  it('throws when the server omits fetched trigger IDs', async () => {
    const server = createServer()
    const store = new WriteThroughTriggerStore(server, new InMemoryTriggerCache())

    await expect(store.fetchTriggers(['missing-trigger'])).rejects.toThrow(
      'Missing triggers: missing-trigger',
    )
  })

  it('coalesces concurrent fetches for the same missing trigger', async () => {
    const trigger = createTestTrigger('Concurrent Trigger')
    const server = createServer({
      triggers: [trigger],
    })
    const store = new WriteThroughTriggerStore(server, new InMemoryTriggerCache())

    const [firstResult, secondResult] = await Promise.all([
      store.fetchTriggers([trigger.id]),
      store.fetchTriggers([trigger.id]),
    ])

    expect(firstResult).toEqual([trigger])
    expect(secondResult).toEqual([trigger])
    expect(server.fetchTriggers).toHaveBeenCalledTimes(1)
  })

  it('uses persisted cache entries across store instances', async () => {
    const trigger = createTestTrigger('Persisted Trigger')
    const cache = new InMemoryTriggerCache()
    const firstServer = createServer()
    const firstStore = new WriteThroughTriggerStore(firstServer, cache)

    await firstStore.storeTriggers([trigger])

    const secondServer = createServer()
    const secondStore = new WriteThroughTriggerStore(secondServer, cache)

    await expect(secondStore.fetchTriggers([trigger.id])).resolves.toEqual([
      trigger,
    ])
    await expect(secondStore.storeTriggers([trigger])).resolves.toEqual([
      trigger,
    ])
    expect(secondServer.fetchTriggers).not.toHaveBeenCalled()
    expect(secondServer.storeTriggers).not.toHaveBeenCalled()
  })
})

function createServer({ triggers = [] }: { triggers?: JenaTrigger[] } = {}) {
  const triggersByID = new Map<JenaTriggerId, JenaTrigger>(
    triggers.map((trigger) => [trigger.id, trigger]),
  )

  return {
    fetchTriggers: vi.fn(async (ids: JenaTriggerId[]) => {
      return ids.flatMap((id) => {
        const trigger = triggersByID.get(id)

        return trigger ? [trigger] : []
      })
    }),
    storeTriggers: vi.fn(async (storedTriggers: JenaTrigger[]) => {
      storedTriggers.forEach((trigger) => {
        triggersByID.set(trigger.id, trigger)
      })

      return storedTriggers
    }),
  }
}

function createTestTrigger(name: string) {
  return withCanonicalTriggerId({
    ...createEmptyTrigger(),
    match: `^${name}$`,
    name,
  })
}
