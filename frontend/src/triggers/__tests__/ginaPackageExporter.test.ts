import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  createClipboardAction,
  createEmptyTrigger,
  createSpeechAction,
  createTextAction,
  withCanonicalTriggerId,
  type JenaTrigger,
} from '../../shared/triggers'
import { exportGinaPackageFile } from '../gina/ginaPackageExporter'
import { parseGinaPackageFile } from '../gina/ginaPackageParser'

describe('exportGinaPackageFile', () => {
  it('exports JENA triggers as a GINA package and round-trips through import', async () => {
    const triggers = createExportTriggers()
    const progressCalls: Array<{
      bytesProcessed: number
      bytesTotal: number
      elapsedMs: number
      estimatedMs: number
    }> = []

    const packageBytes = await exportGinaPackageFile(triggers, {
      modifiedAt: new Date(2026, 4, 16, 17, 46, 11),
      onProgress: (
        bytesProcessed,
        bytesTotal,
        elapsedMs,
        estimatedMs,
      ) => {
        progressCalls.push({
          bytesProcessed,
          bytesTotal,
          elapsedMs,
          estimatedMs,
        })
      },
    })
    const files = unzipSync(packageBytes)
    const fileNames = Object.keys(files)

    expect(fileNames).toEqual(['ShareData.xml'])

    const xml = new TextDecoder().decode(files['ShareData.xml'])
    expect(xml).toContain('<TimerVisibleDuration>0</TimerVisibleDuration>')
    expect(xml).toContain('<UseCounterResetTimer>False</UseCounterResetTimer>')
    expect(xml).toContain('<Modified>2026-05-16T17:46:11</Modified>')
    expect(xml).toContain('<UseFastCheck>True</UseFastCheck>')
    expect(xml).toContain('<TriggerText>A boss says, \'Run away.\' {C}</TriggerText>')
    expect(xml).toContain('<EnableRegex>False</EnableRegex>')
    expect(xml).toContain('<TriggerText>The (.+) shouts</TriggerText>')
    expect(xml).toContain('<EnableRegex>True</EnableRegex>')
    expect(xml).toContain('<EarlyEndText>done (?&lt;target&gt;.+)</EarlyEndText>')

    const importedTriggers = await parseGinaPackageFile(
      new File([toArrayBuffer(packageBytes)], 'exported.gtp', {
        type: 'application/zip',
      }),
    )

    expect(importedTriggers).toHaveLength(2)
    expect(importedTriggers[0]).toMatchObject({
      name: 'Literal Trigger',
      comments: 'Literal comments',
      category: 'Warnings',
      groupPath: ['Root Group', 'Raid Group'],
      match: {
        text: "A boss says, 'Run away.' {C}",
        isRegex: false,
      },
      timer: {
        type: 'countdown',
        name: 'Literal Timer',
        durationMs: 5000,
        startBehavior: 'restartMatchingTimerName',
        warningSeconds: 2,
        earlyEnders: [
          { text: 'Timer done', isRegex: false },
          { text: 'done (?<target>.+)', isRegex: true },
        ],
      },
    })
    expect(importedTriggers[1]).toMatchObject({
      name: 'Regex Trigger',
      category: 'Default',
      groupPath: ['Root Group'],
      match: {
        text: 'The (.+) shouts',
        isRegex: true,
      },
      timer: null,
    })
    expect(progressCalls.length).toBeGreaterThanOrEqual(2)
    expect(progressCalls.at(0)).toMatchObject({
      bytesProcessed: 0,
    })
    expect(progressCalls.at(-1)).toMatchObject({
      bytesProcessed: progressCalls.at(-1)?.bytesTotal,
      estimatedMs: 0,
    })
  })
})

function createExportTriggers() {
  return [
    withCanonicalTriggerId({
      ...createEmptyTrigger(),
      name: 'Literal Trigger',
      comments: 'Literal comments',
      category: 'Warnings',
      groupPath: ['Root Group', 'Raid Group'],
      match: {
        text: "A boss says, 'Run away.' {C}",
        isRegex: false,
      },
      actions: {
        display: {
          enabled: true,
          text: 'Run away!',
        },
        speech: {
          enabled: true,
          interrupt: true,
          text: 'Run away',
        },
        clipboard: {
          enabled: true,
          text: '/rs Running',
        },
      },
      timer: {
        type: 'countdown',
        name: 'Literal Timer',
        durationMs: 5000,
        startBehavior: 'restartMatchingTimerName',
        warningSeconds: 2,
        warningAction: {
          display: {
            enabled: true,
            text: 'Almost done',
          },
          speech: {
            enabled: true,
            interrupt: false,
            text: 'Almost done',
          },
        },
        endedAction: {
          display: {
            enabled: true,
            text: 'Done',
          },
          speech: createSpeechAction(),
        },
        earlyEnders: [
          { text: 'Timer done', isRegex: false },
          { text: 'done (?<target>.+)', isRegex: true },
        ],
      },
    } satisfies JenaTrigger),
    withCanonicalTriggerId({
      ...createEmptyTrigger(),
      actions: {
        clipboard: createClipboardAction(),
        display: createTextAction(),
        speech: createSpeechAction(),
      },
      name: 'Regex Trigger',
      category: 'Default',
      groupPath: ['Root Group'],
      match: {
        text: 'The (.+) shouts',
        isRegex: true,
      },
      timer: null,
    } satisfies JenaTrigger),
  ]
}

function toArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}
