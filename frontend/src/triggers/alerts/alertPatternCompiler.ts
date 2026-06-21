import type {
  AlertCaptureSnapshot,
  RegexMatchFoundMessage,
} from '../../shared/messages'
import type { JenaTriggerMatcher } from '../../shared/triggers'

export type AlertCompiledPatternKind = 'literal' | 'regex'

export const unknownZoneName = 'unknown zone'

export interface AlertCompiledPattern {
  captureBindings: AlertCaptureBinding[]
  characterCaptureNames: string[]
  kind: AlertCompiledPatternKind
  numberConstraintGroups: AlertNumberConstraintGroup[]
  pattern: string
  userPositionalCaptureIndexes: number[]
}

export interface AlertCaptureBinding {
  captureName: string
  key: string
}

export interface AlertNumberConstraint {
  op: AlertNumberConstraintOperator
  value: number
}

export type AlertNumberConstraintOperator = '<' | '<=' | '>' | '>=' | '=='

export interface AlertNumberConstraintGroup {
  alternatives: AlertNumberConstraint[][]
  captureName: string
}

export interface AlertMatchContext {
  capturesByKey: Record<string, string>
  lineText: string
  logTime: string
  namedCaptures: Record<string, string>
  positionalCaptures: string[]
  repeated?: number
  counter?: number
  timerWarnTimeValue?: number
}

interface TokenParseResult {
  capturePattern: string
  key: string
  numberConstraintAlternatives?: AlertNumberConstraint[][]
}

const characterPattern = '[A-Za-z]{2,}'
const stringPattern = '.+'
const numberPattern = '\\d+'
const timePattern = '(?:\\d+[dhms]?:?){1,4}'

export function createAlertPatternSessionId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  ).replace(/[^A-Za-z0-9_]/g, '_')
}

export function compileAlertMatcher(
  matcher: JenaTriggerMatcher,
  sessionId: string,
): AlertCompiledPattern {
  if (!matcher.isRegex) {
    return {
      captureBindings: [],
      characterCaptureNames: [],
      kind: 'literal',
      numberConstraintGroups: [],
      pattern: escapeRegExp(matcher.text),
      userPositionalCaptureIndexes: [],
    }
  }

  return compileRegexAlertPattern(matcher.text, sessionId)
}

export function createAlertMatchContext(
  compiledPattern: AlertCompiledPattern,
  match: RegexMatchFoundMessage,
  options: {
    counter?: number
    repeated?: number
    timerWarnTimeValue?: number
    zoneName?: string
  } = {},
): AlertMatchContext | null {
  if (!passesCharacterValidation(compiledPattern, match)) {
    return null
  }

  const capturesByKey = getGinaCaptures(compiledPattern, match)

  if (!passesNumberValidation(compiledPattern, match)) {
    return null
  }

  const positionalCaptures = compiledPattern.userPositionalCaptureIndexes.map(
    (index) => match.captures.positional[index - 1] ?? '',
  )

  return {
    capturesByKey: {
      ...capturesByKey,
      C: match.characterName,
      Z: options.zoneName ?? unknownZoneName,
    },
    counter: options.counter,
    lineText: match.text,
    logTime: getLogTime(match.timestamp),
    namedCaptures: removeInternalCaptures(compiledPattern, match.captures.named),
    positionalCaptures,
    repeated: options.repeated,
    timerWarnTimeValue: options.timerWarnTimeValue,
  }
}

export function createAlertCaptureSnapshot(
  compiledPattern: AlertCompiledPattern,
  context: AlertMatchContext,
): AlertCaptureSnapshot {
  const capturesByKey: Record<string, string> = {}

  compiledPattern.captureBindings.forEach((binding) => {
    const value = context.capturesByKey[binding.key]
    if (value !== undefined) {
      capturesByKey[binding.key] ??= value
    }
  })

  return {
    capturesByKey,
    namedCaptures: context.namedCaptures,
    positionalCaptures: context.positionalCaptures,
  }
}

export function createPreviewAlertMatchContext({
  characterName,
  matcher,
  timestamp = new Date().toISOString(),
}: {
  characterName: string
  matcher: JenaTriggerMatcher
  timestamp?: string
}): AlertMatchContext {
  const compiledPattern = compileAlertMatcher(
    matcher,
    createAlertPatternSessionId(),
  )
  const capturesByKey: Record<string, string> = {
    C: characterName,
    Z: unknownZoneName,
  }

  compiledPattern.captureBindings.forEach((binding) => {
    capturesByKey[binding.key] ??= getPreviewCaptureValue(
      binding.key,
      characterName,
    )
  })

  return {
    capturesByKey,
    lineText: matcher.text,
    logTime: getLogTime(timestamp),
    namedCaptures: {},
    positionalCaptures: getPreviewPositionalCaptures(compiledPattern),
  }
}

export function substituteAlertTemplate(
  template: string,
  context: AlertMatchContext,
): string | undefined {
  if (isNullTemplate(template)) {
    return undefined
  }

  const braceSubstituted = template.replace(
    /\$?\{(?<name>[A-Za-z0-9_-]+)(?:\.(?<modifier>[A-Za-z0-9_]+)(?::(?<arg>[^}]*))?)?\}/g,
    (token: string, ...args: unknown[]) => {
      const groups = args.at(-1) as
        | {
            arg?: string
            modifier?: string
            name?: string
          }
        | undefined
      const name = groups?.name

      if (!name) {
        return token
      }

      const value = getReplacementValue(name, context)
      if (value === undefined) {
        return token
      }

      return applyModifier(value, groups?.modifier, groups?.arg)
    },
  )

  return braceSubstituted.replace(/\$(\$|\d{1,3})/g, (token, value) => {
    if (value === '$') {
      return '$'
    }

    const position = Number(value)
    if (!Number.isInteger(position) || position <= 0) {
      return token
    }

    return context.positionalCaptures[position - 1] ?? token
  })
}

function compileRegexAlertPattern(
  source: string,
  sessionId: string,
): AlertCompiledPattern {
  const capturePrefix = `jena_${sanitizeCapturePart(sessionId)}`
  const captureBindings: AlertCaptureBinding[] = []
  const characterCaptureNames: string[] = []
  const numberConstraintGroups: AlertNumberConstraintGroup[] = []
  const userPositionalCaptureIndexes: number[] = []
  let matcherCaptureIndex = 0
  let output = ''
  let inCharacterClass = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]

    if (char === '\\') {
      output += source.slice(index, index + 2)
      index += 1
      continue
    }

    if (char === '[') {
      inCharacterClass = true
      output += char
      continue
    }

    if (char === ']' && inCharacterClass) {
      inCharacterClass = false
      output += char
      continue
    }

    if (!inCharacterClass && char === '(') {
      if (isUserCapturingGroup(source, index)) {
        matcherCaptureIndex += 1
        userPositionalCaptureIndexes.push(matcherCaptureIndex)
      }

      output += char
      continue
    }

    if (!inCharacterClass && char === '{') {
      const closingIndex = source.indexOf('}', index + 1)
      if (closingIndex !== -1) {
        const token = parseGinaPatternToken(
          source.slice(index + 1, closingIndex),
        )

        if (token) {
          matcherCaptureIndex += 1
          const captureName = createCaptureName({
            capturePrefix,
            key: token.key,
            occurrence: matcherCaptureIndex,
          })

          captureBindings.push({
            captureName,
            key: token.key,
          })

          if (token.key === 'C') {
            characterCaptureNames.push(captureName)
          }

          if (token.numberConstraintAlternatives) {
            numberConstraintGroups.push({
              alternatives: token.numberConstraintAlternatives,
              captureName,
            })
          }

          output += `(?<${captureName}>${token.capturePattern})`
          index = closingIndex
          continue
        }
      }
    }

    output += char
  }

  return {
    captureBindings,
    characterCaptureNames,
    kind: 'regex',
    numberConstraintGroups,
    pattern: output,
    userPositionalCaptureIndexes,
  }
}

function parseGinaPatternToken(content: string): TokenParseResult | null {
  const normalized = content.trim()
  const simple = /^(?<key>[cs]\d?|ts)$/i.exec(normalized)

  if (simple?.groups?.key) {
    const key = normalizeCaptureKey(simple.groups.key)

    return {
      capturePattern: getCapturePattern(key),
      key,
    }
  }

  const numericToken = parseNumberToken(normalized)
  if (numericToken) {
    return numericToken
  }

  return null
}

function parseNumberToken(content: string): TokenParseResult | null {
  const alternatives = content.split('|').map((part) => part.trim())
  const parsedAlternatives: Array<{
    constraints: AlertNumberConstraint[]
    key: string
  }> = []

  for (const alternative of alternatives) {
    const parsed = parseNumberAlternative(alternative)
    if (!parsed) {
      return null
    }

    parsedAlternatives.push(parsed)
  }

  const key = parsedAlternatives[0]?.key
  if (!key || parsedAlternatives.some((alternative) => alternative.key !== key)) {
    return null
  }

  const constrainedAlternatives = parsedAlternatives
    .map((alternative) => alternative.constraints)
    .filter((constraints) => constraints.length > 0)

  return {
    capturePattern: numberPattern,
    key,
    ...(constrainedAlternatives.length > 0
      ? { numberConstraintAlternatives: constrainedAlternatives }
      : {}),
  }
}

function parseNumberAlternative(
  alternative: string,
): { constraints: AlertNumberConstraint[]; key: string } | null {
  const bareMatch = /^(?<key>n\d?)$/i.exec(alternative)
  if (bareMatch?.groups?.key) {
    return {
      constraints: [],
      key: normalizeCaptureKey(bareMatch.groups.key),
    }
  }

  const rightBoundMatch =
    /^(?<key>n\d?)\s*(?<op><=|>=|>|<|==|=)\s*(?<value>\d+)$/i.exec(
      alternative,
    )
  if (rightBoundMatch?.groups) {
    return {
      constraints: [
        {
          op: normalizeOperator(rightBoundMatch.groups.op),
          value: Number(rightBoundMatch.groups.value),
        },
      ],
      key: normalizeCaptureKey(rightBoundMatch.groups.key),
    }
  }

  const chainedMatch =
    /^(?<leftValue>\d+)\s*(?<leftOp><=|>=|>|<|==|=)\s*(?<key>n\d?)\s*(?<rightOp><=|>=|>|<|==|=)\s*(?<rightValue>\d+)$/i.exec(
      alternative,
    )
  if (chainedMatch?.groups) {
    return {
      constraints: [
        {
          op: flipOperator(chainedMatch.groups.leftOp),
          value: Number(chainedMatch.groups.leftValue),
        },
        {
          op: normalizeOperator(chainedMatch.groups.rightOp),
          value: Number(chainedMatch.groups.rightValue),
        },
      ],
      key: normalizeCaptureKey(chainedMatch.groups.key),
    }
  }

  return null
}

function isUserCapturingGroup(source: string, index: number) {
  if (source[index + 1] !== '?') {
    return true
  }

  return source[index + 2] === '<' && source[index + 3] !== '=' && source[index + 3] !== '!'
}

function passesCharacterValidation(
  compiledPattern: AlertCompiledPattern,
  match: RegexMatchFoundMessage,
) {
  return compiledPattern.characterCaptureNames.every((captureName) => {
    const capturedCharacter = match.captures.named[captureName]

    return (
      typeof capturedCharacter === 'string' &&
      capturedCharacter.localeCompare(match.characterName, undefined, {
        sensitivity: 'base',
      }) === 0
    )
  })
}

function passesNumberValidation(
  compiledPattern: AlertCompiledPattern,
  match: RegexMatchFoundMessage,
) {
  return compiledPattern.numberConstraintGroups.every((constraintGroup) => {
    const rawValue = match.captures.named[constraintGroup.captureName]
    if (typeof rawValue !== 'string') {
      return false
    }

    const value = Number(rawValue)
    if (!Number.isInteger(value)) {
      return false
    }

    return constraintGroup.alternatives.some((constraints) => {
      return constraints.every((constraint) =>
        compareNumber(value, constraint.op, constraint.value),
      )
    })
  })
}

function getGinaCaptures(
  compiledPattern: AlertCompiledPattern,
  match: RegexMatchFoundMessage,
) {
  const captures: Record<string, string> = {}

  compiledPattern.captureBindings.forEach((binding) => {
    if (captures[binding.key] !== undefined) {
      return
    }

    const value = match.captures.named[binding.captureName]
    if (typeof value === 'string') {
      captures[binding.key] = value
    }
  })

  return captures
}

function removeInternalCaptures(
  compiledPattern: AlertCompiledPattern,
  namedCaptures: Record<string, string | null>,
) {
  const filteredCaptures: Record<string, string> = {}
  const internalCaptureNames = new Set(
    compiledPattern.captureBindings.map((binding) => binding.captureName),
  )

  Object.entries(namedCaptures).forEach(([name, value]) => {
    if (internalCaptureNames.has(name) || value === null) {
      return
    }

    filteredCaptures[name] = value
  })

  return filteredCaptures
}

function getReplacementValue(
  name: string,
  context: AlertMatchContext,
) {
  if (/^\d+$/.test(name)) {
    const position = Number(name)

    return position > 0 ? context.positionalCaptures[position - 1] : undefined
  }

  const upperName = name.toLocaleUpperCase()

  if (upperName === 'L') {
    return context.lineText
  }

  if (upperName === 'LOGTIME') {
    return context.logTime
  }

  if (upperName === 'COUNTER') {
    return context.counter?.toString()
  }

  if (upperName === 'REPEATED') {
    return context.repeated?.toString()
  }

  if (upperName === 'TIMER-WARN-TIME-VALUE') {
    return context.timerWarnTimeValue?.toString()
  }

  if (upperName === 'NULL') {
    return ''
  }

  if (context.capturesByKey[upperName] !== undefined) {
    return context.capturesByKey[upperName]
  }

  if (context.namedCaptures[name] !== undefined) {
    return context.namedCaptures[name]
  }

  const caseInsensitiveNamedCapture = Object.entries(context.namedCaptures).find(
    ([captureName]) => captureName.localeCompare(name, undefined, {
      sensitivity: 'base',
    }) === 0,
  )

  return caseInsensitiveNamedCapture?.[1]
}

function getPreviewCaptureValue(key: string, characterName: string) {
  if (key === 'C') {
    return characterName
  }

  if (key === 'TS') {
    return '00:00:01'
  }

  if (key.startsWith('N')) {
    return '1'
  }

  return 'test'
}

function getPreviewPositionalCaptures(compiledPattern: AlertCompiledPattern) {
  const captureCount = Math.max(
    0,
    ...compiledPattern.userPositionalCaptureIndexes,
  )

  return Array.from({ length: captureCount }, () => 'test')
}

function applyModifier(value: string, modifier?: string, arg?: string) {
  if (!modifier) {
    return value
  }

  switch (modifier.toLocaleLowerCase()) {
    case 'capitalize':
      return value.length === 0
        ? value
        : `${value[0]?.toLocaleUpperCase() ?? ''}${value.slice(1)}`
    case 'center':
      return padCenter(value, getPadWidth(arg))
    case 'lower':
      return value.toLocaleLowerCase()
    case 'number':
      return formatNumber(value)
    case 'padleft':
      return value.padStart(getPadWidth(arg), ' ')
    case 'padright':
      return value.padEnd(getPadWidth(arg), ' ')
    case 'upper':
      return value.toLocaleUpperCase()
    default:
      return value
  }
}

function padCenter(value: string, width: number) {
  if (value.length >= width) {
    return value
  }

  const padding = width - value.length
  const leftPadding = Math.floor(padding / 2)
  const rightPadding = padding - leftPadding

  return `${' '.repeat(leftPadding)}${value}${' '.repeat(rightPadding)}`
}

function getPadWidth(value: string | undefined) {
  const width = Number(value)

  return Number.isInteger(width) && width > 0 ? width : 0
}

function formatNumber(value: string) {
  const parsed = Number(value)

  return Number.isFinite(parsed)
    ? new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 0,
      }).format(parsed)
    : value
}

function getLogTime(timestamp: string) {
  return /\b\d{1,2}:\d{2}:\d{2}\b/.exec(timestamp)?.[0] ?? ''
}

function isNullTemplate(template: string) {
  return /^\$?\{null}$/i.test(template.trim())
}

function compareNumber(
  value: number,
  operator: AlertNumberConstraintOperator,
  expected: number,
) {
  switch (operator) {
    case '<':
      return value < expected
    case '<=':
      return value <= expected
    case '>':
      return value > expected
    case '>=':
      return value >= expected
    case '==':
      return value === expected
  }
}

function getCapturePattern(key: string) {
  if (key === 'C') {
    return characterPattern
  }

  if (key === 'TS') {
    return timePattern
  }

  if (key.startsWith('S')) {
    return stringPattern
  }

  return numberPattern
}

function createCaptureName({
  capturePrefix,
  key,
  occurrence,
}: {
  capturePrefix: string
  key: string
  occurrence: number
}) {
  return `${capturePrefix}_${key.toLocaleLowerCase()}_${occurrence}`
}

function normalizeCaptureKey(key: string) {
  return key.toLocaleUpperCase()
}

function sanitizeCapturePart(value: string) {
  const sanitized = value.replace(/[^A-Za-z0-9_]/g, '_')

  return sanitized.length > 0 ? sanitized : 'session'
}

function normalizeOperator(operator: string): AlertNumberConstraintOperator {
  return operator === '=' ? '==' : (operator as AlertNumberConstraintOperator)
}

function flipOperator(operator: string): AlertNumberConstraintOperator {
  switch (operator) {
    case '<':
      return '>'
    case '<=':
      return '>='
    case '>':
      return '<'
    case '>=':
      return '<='
    case '=':
    case '==':
      return '=='
    default:
      return '=='
  }
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
