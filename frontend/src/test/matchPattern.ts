import { validateRegexPattern } from '../shared/regexValidation'

export function matchPattern(pattern: string, text: string): RegExpMatchArray | null {
  const validation = validateRegexPattern(pattern)
  if (!validation.ok) {
    throw new Error(validation.error)
  }

  if (validation.engine === 'javascript') {
    return validation.compiledPattern.exec(text)
  }

  return (validation.compiledPattern.matchAll(text).next().value as
    RegExpMatchArray | undefined) ?? null
}
