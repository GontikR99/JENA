/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { protocolVersion } from '../protocolVersion'

describe('protocolVersion', () => {
  it('matches the root protocol version file', () => {
    const rawVersion = readFileSync(
      new URL('../../../../protocol-version.txt', import.meta.url),
      'utf8',
    ).trim()
    const expectedVersion = Number(rawVersion)

    expect(Number.isSafeInteger(expectedVersion)).toBe(true)
    expect(expectedVersion).toBeGreaterThan(0)
    expect(protocolVersion).toBe(expectedVersion)
  })
})
