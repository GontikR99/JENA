import { describe, expect, it } from 'vitest'
import type { RegexMatchFoundMessage } from '../../shared/messages'
import {
  compileAlertMatcher,
  createAlertMatchContext,
  substituteAlertTemplate,
  type AlertCompiledPattern,
} from '../alerts/alertPatternCompiler'

describe('alert pattern compiler', () => {
  it('treats non-regex matchers as literal text', () => {
    const compiled = compileAlertMatcher(
      {
        isRegex: false,
        text: 'Boss points at {C}.',
      },
      'test-session',
    )

    expect(compiled.pattern).toBe('Boss points at \\{C\\}\\.')
    expect(compiled.captureBindings).toEqual([])
  })

  it('expands GINA regex captures and substitutes C#-style output references', () => {
    const compiled = compileAlertMatcher(
      {
        isRegex: true,
        text: '^Boss points at {C} and casts (?<spell>.+) for {N>=50}$',
      },
      'test-session',
    )
    const match = runPattern(
      compiled,
      'Boss points at suuloti and casts Fireball for 75',
      'Suuloti',
    )
    const context = createAlertMatchContext(compiled, match, {
      counter: 2,
      repeated: 2,
    })

    expect(context).not.toBeNull()
    expect(
      substituteAlertTemplate(
        '{C}: {spell.upper} ${N} $1 $$ {COUNTER} $S',
        context!,
      ),
    ).toBe('Suuloti: FIREBALL 75 Fireball $ 2 $S')
  })

  it('rejects character captures that do not match the log character', () => {
    const compiled = compileAlertMatcher(
      {
        isRegex: true,
        text: '^Boss points at {C}$',
      },
      'test-session',
    )
    const match = runPattern(compiled, 'Boss points at Mesozoic', 'Suuloti')

    expect(createAlertMatchContext(compiled, match)).toBeNull()
  })

  it('substitutes the output-only zone variable', () => {
    const compiled = compileAlertMatcher(
      {
        isRegex: true,
        text: '^Boss points at {C}$',
      },
      'test-session',
    )
    const match = runPattern(compiled, 'Boss points at Suuloti', 'Suuloti')
    const context = createAlertMatchContext(compiled, match, {
      zoneName: 'Guild Lobby',
    })

    expect(substituteAlertTemplate('{C} in {Z}', context!)).toBe(
      'Suuloti in Guild Lobby',
    )
  })

  it('uses an unknown-zone placeholder when the zone is not available', () => {
    const compiled = compileAlertMatcher(
      {
        isRegex: true,
        text: '^Boss points at {C}$',
      },
      'test-session',
    )
    const match = runPattern(compiled, 'Boss points at Suuloti', 'Suuloti')
    const context = createAlertMatchContext(compiled, match)

    expect(substituteAlertTemplate('{C} in {Z}', context!)).toBe(
      'Suuloti in unknown zone',
    )
  })

  it('validates numeric bounds after matching', () => {
    const compiled = compileAlertMatcher(
      {
        isRegex: true,
        text: '^Damage: {100<=N<200}$',
      },
      'test-session',
    )

    expect(
      createAlertMatchContext(
        compiled,
        runPattern(compiled, 'Damage: 150', 'Suuloti'),
      ),
    ).not.toBeNull()
    expect(
      createAlertMatchContext(
        compiled,
        runPattern(compiled, 'Damage: 250', 'Suuloti'),
      ),
    ).toBeNull()
  })

  it('supports alternate numeric bounds separated by pipes', () => {
    const compiled = compileAlertMatcher(
      {
        isRegex: true,
        text: '^Damage: {N==0|N>=100}$',
      },
      'test-session',
    )

    expect(
      createAlertMatchContext(
        compiled,
        runPattern(compiled, 'Damage: 0', 'Suuloti'),
      ),
    ).not.toBeNull()
    expect(
      createAlertMatchContext(
        compiled,
        runPattern(compiled, 'Damage: 50', 'Suuloti'),
      ),
    ).toBeNull()
  })

  it('supports C#-style dollar-braced positional replacements', () => {
    const compiled = compileAlertMatcher(
      {
        isRegex: true,
        text: "^Boss says 'I grant to (?=(\\w{4}))\\w+, and (?=(\\w{4}))\\w+'",
      },
      'test-session',
    )
    const context = createAlertMatchContext(
      compiled,
      runPattern(
        compiled,
        "Boss says 'I grant to Suuloti, and Mesozoic'",
        'Suuloti',
      ),
    )

    expect(
      substituteAlertTemplate(
        'No heals: ${1}, ${2}; plain {1}; named {target}',
        context!,
      ),
    ).toBe('No heals: Suul, Meso; plain Suul; named {target}')
  })

  it('suppresses output for null templates', () => {
    const compiled = compileAlertMatcher(
      {
        isRegex: true,
        text: '^Hello (?<target>.+)$',
      },
      'test-session',
    )
    const context = createAlertMatchContext(
      compiled,
      runPattern(compiled, 'Hello Suuloti', 'Suuloti'),
    )

    expect(substituteAlertTemplate('{NULL}', context!)).toBeUndefined()
  })
})

function runPattern(
  compiled: AlertCompiledPattern,
  text: string,
  characterName: string,
): RegexMatchFoundMessage {
  const regex = new RegExp(compiled.pattern, 'i')
  const match = regex.exec(text)

  if (!match) {
    throw new Error(`Pattern did not match: ${compiled.pattern}`)
  }

  return {
    captures: {
      named: Object.fromEntries(
        Object.entries(match.groups ?? {}).map(([name, value]) => [
          name,
          value ?? null,
        ]),
      ),
      positional: match.slice(1).map((value) => value ?? null),
    },
    characterName,
    pattern: compiled.pattern,
    serverName: 'bertox',
    text,
    timestamp: 'Fri Oct 24 13:33:11 2025',
  }
}
