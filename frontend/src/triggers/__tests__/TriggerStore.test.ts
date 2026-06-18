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
} from '../model/TriggerStore'

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

  it('retries partial fetch responses for remaining trigger IDs', async () => {
    const firstTrigger = createTestTrigger('First Trigger')
    const secondTrigger = createTestTrigger('Second Trigger')
    const thirdTrigger = createTestTrigger('Third Trigger')
    const server = createServer({
      partialFetchSize: 1,
      triggers: [firstTrigger, secondTrigger, thirdTrigger],
    })
    const store = new WriteThroughTriggerStore(server, new InMemoryTriggerCache())

    const result = await store.fetchTriggers([
      firstTrigger.id,
      secondTrigger.id,
      thirdTrigger.id,
    ])

    expect(result).toEqual([firstTrigger, secondTrigger, thirdTrigger])
    expect(server.fetchTriggers).toHaveBeenCalledTimes(3)
    expect(server.fetchTriggers).toHaveBeenNthCalledWith(1, [
      firstTrigger.id,
      secondTrigger.id,
      thirdTrigger.id,
    ])
    expect(server.fetchTriggers).toHaveBeenNthCalledWith(2, [
      secondTrigger.id,
      thirdTrigger.id,
    ])
    expect(server.fetchTriggers).toHaveBeenNthCalledWith(3, [thirdTrigger.id])
  })

  it('reports progress only while resolving partial fetch responses', async () => {
    const firstTrigger = createTestTrigger('First Trigger')
    const secondTrigger = createTestTrigger('Second Trigger')
    const thirdTrigger = createTestTrigger('Third Trigger')
    const server = createServer({
      partialFetchSize: 1,
      triggers: [firstTrigger, secondTrigger, thirdTrigger],
    })
    const reportFetchProgress = vi.fn()
    const store = new WriteThroughTriggerStore(
      server,
      new InMemoryTriggerCache(),
      undefined,
      reportFetchProgress,
    )

    await store.fetchTriggers([
      firstTrigger.id,
      secondTrigger.id,
      thirdTrigger.id,
    ])

    expect(reportFetchProgress).toHaveBeenCalledTimes(4)
    expect(reportFetchProgress).toHaveBeenNthCalledWith(1, {
      fetchedCount: 1,
      totalCount: 3,
    })
    expect(reportFetchProgress).toHaveBeenNthCalledWith(2, {
      fetchedCount: 2,
      totalCount: 3,
    })
    expect(reportFetchProgress).toHaveBeenNthCalledWith(3, {
      fetchedCount: 3,
      totalCount: 3,
    })
    expect(reportFetchProgress).toHaveBeenNthCalledWith(4, null)
  })

  it('does not report progress for fetch responses completed in one batch', async () => {
    const firstTrigger = createTestTrigger('First Trigger')
    const secondTrigger = createTestTrigger('Second Trigger')
    const server = createServer({
      triggers: [firstTrigger, secondTrigger],
    })
    const reportFetchProgress = vi.fn()
    const store = new WriteThroughTriggerStore(
      server,
      new InMemoryTriggerCache(),
      undefined,
      reportFetchProgress,
    )

    await store.fetchTriggers([firstTrigger.id, secondTrigger.id])

    expect(reportFetchProgress).not.toHaveBeenCalled()
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

  it('notifies once for newly stored triggers', async () => {
    const firstTrigger = createTestTrigger('First Trigger')
    const secondTrigger = createTestTrigger('Second Trigger')
    const server = createServer()
    const publishSeenTriggers = vi.fn()
    const store = new WriteThroughTriggerStore(
      server,
      new InMemoryTriggerCache(),
      publishSeenTriggers,
    )

    await store.storeTriggers([firstTrigger, secondTrigger])
    await store.storeTriggers([secondTrigger, firstTrigger])

    expect(publishSeenTriggers).toHaveBeenCalledTimes(1)
    expect(publishSeenTriggers).toHaveBeenCalledWith([
      firstTrigger,
      secondTrigger,
    ])
  })

  it('notifies for fetched triggers from the server', async () => {
    const trigger = createTestTrigger('Fetched Trigger')
    const server = createServer({
      triggers: [trigger],
    })
    const publishSeenTriggers = vi.fn()
    const store = new WriteThroughTriggerStore(
      server,
      new InMemoryTriggerCache(),
      publishSeenTriggers,
    )

    await store.fetchTriggers([trigger.id])

    expect(publishSeenTriggers).toHaveBeenCalledTimes(1)
    expect(publishSeenTriggers).toHaveBeenCalledWith([trigger])
  })
})

function createServer({
  partialFetchSize = Number.POSITIVE_INFINITY,
  triggers = [],
}: {
  partialFetchSize?: number
  triggers?: JenaTrigger[]
} = {}) {
  const triggersByID = new Map<JenaTriggerId, JenaTrigger>(
    triggers.map((trigger) => [trigger.id, trigger]),
  )

  return {
    fetchTriggers: vi.fn(async (ids: JenaTriggerId[]) => {
      const matchingTriggers = ids.flatMap((id) => {
        const trigger = triggersByID.get(id)

        return trigger ? [trigger] : []
      })
      const returnedTriggers = matchingTriggers.slice(0, partialFetchSize)

      return {
        partial: returnedTriggers.length < matchingTriggers.length,
        triggers: returnedTriggers,
      }
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
    match: {
      text: `^${name}$`,
      isRegex: true,
    },
    name,
  })
}
