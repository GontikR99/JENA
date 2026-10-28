import { describe, expect, it } from 'vitest'
import { compileJavaScriptPattern, validateRegexPattern } from '../regexValidation'

describe('regex validation and compilation', () => {
  it.each([
    ['^Boss (?<spell>Fireball)$', 're2'],
    ['^(?=Boss)Boss (?<spell>Fireball)$', 'javascript'],
  ])('compiles %s case-insensitively using %s', (pattern, engine) => {
    const result = validateRegexPattern(pattern)
    expect(result).toMatchObject({ engine, ok: true })
    if (!result.ok) throw new Error(result.error)

    const match = result.engine === 'javascript'
      ? result.compiledPattern.exec('boss fIREBALL')
      : result.compiledPattern.matchAll('boss fIREBALL').next().value
    expect(match).toMatchObject({ groups: { spell: 'fIREBALL' } })
  })

  it.each([
    ['(?-i)^Boss$', 'boss', false],
    ['(?-i)^Boss$', 'Boss', true],
    ['(?-i)(?i)^Boss$', 'boss', true],
    ['(?im-s)^Boss$', 'first\nBOSS\nlast', true],
    ['(?s-i)^Boss.*Sword$', 'Boss\nSword', true],
    ['(?s-i)^Boss.*Sword$', 'boss\nSword', false],
    ['(?i)(?-i)^Boss$', 'boss', false],
  ])('honors leading flags in JavaScript: %s against %s', (pattern, text, expected) => {
    expect(compileJavaScriptPattern(pattern).test(text)).toBe(expected)
  })

  it('retains the global flag when handling an explicit case override', () => {
    const regex = compileJavaScriptPattern('(?-i)Boss', { global: true })
    expect([...('Boss boss Boss').matchAll(regex)].map((match) => match.index)).toEqual([0, 10])
  })

  it('does not rewrite escaped flag text', () => {
    const regex = compileJavaScriptPattern('\\(\\?-i\\)Boss')
    expect(regex.test('(?-i)boss')).toBe(true)
  })

  it('reports invalid patterns through both engines', () => {
    expect(validateRegexPattern('(?-i)(?<broken>')).toMatchObject({
      ok: false,
      error: expect.stringContaining('JavaScript:'),
      re2Error: expect.any(String),
      javascriptError: expect.any(String),
    })
  })
})
