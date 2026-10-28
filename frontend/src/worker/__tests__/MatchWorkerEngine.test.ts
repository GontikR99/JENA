import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { compileAlertMatcher, compileTimerEarlyEnderMatcher } from '../../triggers/alerts/alertPatternCompiler'
import { parseGinaPackageFile } from '../../triggers/gina/ginaPackageParser'
import { MatchWorkerEngine } from '../MatchWorkerEngine'

describe('MatchWorkerEngine case handling', () => {
  it('matches the imported Master trigger and its literal early ender regardless of case', async () => {
    const xml = `<SharedData><Triggers><Trigger>
      <Name>The Master Raises His Sword</Name>
      <TriggerText>The Master Raises His Sword</TriggerText>
      <EnableRegex>False</EnableRegex>
      <TimerType>Timer</TimerType><TimerDuration>8</TimerDuration>
      <TimerEarlyEnders><EarlyEnder>
        <EarlyEndText>end timer</EarlyEndText><EnableRegex>False</EnableRegex>
      </EarlyEnder></TimerEarlyEnders>
    </Trigger></Triggers></SharedData>`
    const file = new File([zipSync({ 'ShareData.xml': strToU8(xml) })], 'master.gtp')
    const [trigger] = await parseGinaPackageFile(file)
    const main = compileAlertMatcher(trigger.match, 'test')
    const early = compileTimerEarlyEnderMatcher({
      earlyEnder: trigger.timer!.earlyEnders[0],
      sessionId: 'test',
      triggerMatcher: trigger.match,
    })
    const engine = new MatchWorkerEngine('import-test')
    engine.addPatterns('alerts', [main, early])

    const matches = await engine.matchLines([
      record('The Master raises his sword, preparing to slash anyone standing nearby.'),
      record('END TIMER'),
      record('The Master lowers his sword.'),
    ])

    expect(trigger.match).toEqual({ text: 'The Master Raises His Sword', isRegex: false })
    expect(matches.map(({ pattern, lineIndex }) => ({ pattern, lineIndex }))).toEqual([
      { pattern: main.pattern, lineIndex: 0 },
      { pattern: early.pattern, lineIndex: 1 },
    ])
  })

  it.each([
    ['^Boss (?<spell>Fireball)$', [0, 1, 2, 3]],
    ['^(?=Boss)Boss (?<spell>Fireball)$', [0, 1, 2, 3]],
    ['(?-i)^Boss (?<spell>Fireball)$', [1]],
    ['(?-i)^(?=Boss)Boss (?<spell>Fireball)$', [1]],
    ['^Boss (?-i:(?<spell>Fireball))$', [1, 2]],
    ['(?-i)^Boss (?i:(?<spell>Fireball))$', [1, 3]],
  ] as const)('matches triggers and early enders with overrides: %s', async (text, expectedLines) => {
    const matcher = { isRegex: true, text }
    const main = compileAlertMatcher(matcher, 'test')
    const early = compileTimerEarlyEnderMatcher({
      earlyEnder: matcher,
      sessionId: 'test',
      triggerMatcher: { isRegex: true, text: '^Start Timer$' },
    })
    const records = ['boss fireball', 'Boss Fireball', 'bOSS Fireball', 'Boss FIREBALL'].map(record)

    for (const compiled of [main, early]) {
      const engine = new MatchWorkerEngine('override-test')
      engine.replacePatterns('alerts', [compiled])
      const matches = await engine.matchLines(records)
      expect(matches.map((match) => match.lineIndex)).toEqual(expectedLines)
      for (const match of matches) {
        expect(match.pattern).toBe(compiled.pattern)
        expect(match.captures.named.spell).toBe(records[match.lineIndex].text.slice(5))
        expect(match.captures.positional).toEqual([records[match.lineIndex].text.slice(5)])
      }
    }
  })

  it('keeps literal regex syntax literal while ignoring case', async () => {
    const compiled = compileAlertMatcher({ isRegex: false, text: 'Boss (?i) {C}.' }, 'test')
    const engine = new MatchWorkerEngine('literal-test')
    engine.addPatterns('alerts', [compiled])

    const matches = await engine.matchLines([
      record('boss (?I) {c}.'),
      record('boss Alice!'),
    ])
    expect(matches.map((match) => match.lineIndex)).toEqual([0])
  })
})

function record(text: string) {
  return { text, timestamp: 'Wed Oct 28 10:00:00 2026', timestampMs: 1, observedAtMs: 1 }
}
