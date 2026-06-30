import type {
  AlertCaptureSnapshot,
  RegexMatchFoundMessage,
} from '../../shared/messages'
import type { JenaTriggerMatcher } from '../../shared/triggers'

export type AlertCompiledPatternKind = 'literal' | 'regex'

export const unknownZoneName = 'unknown zone'

export interface AlertCompiledPattern {
  captureBindings: AlertCaptureBinding[]
  captureAliases: AlertCaptureAlias[]
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

export type AlertCaptureAlias =
  | {
      captureName: string
      kind: 'named'
      name: string
    }
  | {
      captureName: string
      index: number
      kind: 'positional'
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
  positionalCaptureIndexes?: number[]
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

interface OriginalCapturePatterns {
  namedCaptures: Map<string, string>
  positionalCaptures: string[]
}

type OriginalCaptureReference =
  | {
      index: number
      kind: 'positional'
      pattern: string
    }
  | {
      kind: 'named'
      name: string
      pattern: string
    }

interface CompileRegexAlertPatternOptions {
  originalCapturePatterns?: OriginalCapturePatterns
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
      captureAliases: [],
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

export function compileTimerEarlyEnderMatcher({
  earlyEnder,
  sessionId,
  triggerMatcher,
}: {
  earlyEnder: JenaTriggerMatcher
  sessionId: string
  triggerMatcher: JenaTriggerMatcher
}): AlertCompiledPattern {
  if (!earlyEnder.isRegex) {
    return compileAlertMatcher(earlyEnder, sessionId)
  }

  return compileRegexAlertPattern(earlyEnder.text, sessionId, {
    originalCapturePatterns: getOriginalCapturePatterns(triggerMatcher),
  })
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

  const positionalCaptureConstraints = getPositionalCaptureConstraints(
    compiledPattern,
    match,
  )
  const namedCaptures = {
    ...removeInternalCaptures(compiledPattern, match.captures.named),
    ...getNamedCaptureAliases(compiledPattern, match),
  }

  return {
    capturesByKey: {
      ...capturesByKey,
      C: match.characterName,
      Z: options.zoneName ?? unknownZoneName,
    },
    counter: options.counter,
    lineText: match.text,
    logTime: getLogTime(match.timestamp),
    namedCaptures,
    ...(positionalCaptureConstraints.indexes
      ? { positionalCaptureIndexes: positionalCaptureConstraints.indexes }
      : {}),
    positionalCaptures: positionalCaptureConstraints.values,
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
    ...(context.positionalCaptureIndexes
      ? { positionalCaptureIndexes: context.positionalCaptureIndexes }
      : {}),
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
  options: CompileRegexAlertPatternOptions = {},
): AlertCompiledPattern {
  const capturePrefix = `jena_${sanitizeCapturePart(sessionId)}`
  const captureAliases: AlertCaptureAlias[] = []
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

    if (!inCharacterClass && char === '$' && source[index + 1] === '{') {
      const closingIndex = source.indexOf('}', index + 2)
      if (closingIndex !== -1) {
        const tokenContent = source.slice(index + 2, closingIndex)
        const handledToken = appendBraceToken({
          captureAliases,
          captureBindings,
          capturePrefix,
          characterCaptureNames,
          matcherCaptureIndex,
          numberConstraintGroups,
          options,
          output,
          tokenContent,
        })

        if (handledToken) {
          matcherCaptureIndex = handledToken.matcherCaptureIndex
          output = handledToken.output
          index = closingIndex
          continue
        }

        if (looksLikeOriginalCaptureReference(tokenContent)) {
          throw new Error(
            `Unknown trigger capture reference "${tokenContent.trim()}".`,
          )
        }
      }
    }

    if (!inCharacterClass && char === '{') {
      const closingIndex = source.indexOf('}', index + 1)
      if (closingIndex !== -1) {
        const tokenContent = source.slice(index + 1, closingIndex)
        const handledToken = appendBraceToken({
          captureAliases,
          captureBindings,
          capturePrefix,
          characterCaptureNames,
          matcherCaptureIndex,
          numberConstraintGroups,
          options,
          output,
          tokenContent,
        })

        if (handledToken) {
          matcherCaptureIndex = handledToken.matcherCaptureIndex
          output = handledToken.output
          index = closingIndex
          continue
        }

        if (
          options.originalCapturePatterns &&
          looksLikeOriginalCaptureReference(tokenContent)
        ) {
          throw new Error(
            `Unknown trigger capture reference "${tokenContent.trim()}".`,
          )
        }
      }
    }

    output += char
  }

  return {
    captureAliases,
    captureBindings,
    characterCaptureNames,
    kind: 'regex',
    numberConstraintGroups,
    pattern: output,
    userPositionalCaptureIndexes,
  }
}

function appendBraceToken({
  captureAliases,
  captureBindings,
  capturePrefix,
  characterCaptureNames,
  matcherCaptureIndex,
  numberConstraintGroups,
  options,
  output,
  tokenContent,
}: {
  captureAliases: AlertCaptureAlias[]
  captureBindings: AlertCaptureBinding[]
  capturePrefix: string
  characterCaptureNames: string[]
  matcherCaptureIndex: number
  numberConstraintGroups: AlertNumberConstraintGroup[]
  options: CompileRegexAlertPatternOptions
  output: string
  tokenContent: string
}) {
  const token = parseGinaPatternToken(tokenContent)

  if (token) {
    const nextCaptureIndex = matcherCaptureIndex + 1
    const captureName = createCaptureName({
      capturePrefix,
      key: token.key,
      occurrence: nextCaptureIndex,
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

    return {
      matcherCaptureIndex: nextCaptureIndex,
      output: `${output}(?<${captureName}>${token.capturePattern})`,
    }
  }

  const originalReference = resolveOriginalCaptureReference(
    tokenContent,
    options.originalCapturePatterns,
  )

  if (!originalReference) {
    return null
  }

  const nextCaptureIndex = matcherCaptureIndex + 1
  const captureName = createOriginalCaptureName({
    capturePrefix,
    occurrence: nextCaptureIndex,
    reference: originalReference,
  })

  captureAliases.push(
    originalReference.kind === 'named'
      ? {
          captureName,
          kind: 'named',
          name: originalReference.name,
        }
      : {
          captureName,
          index: originalReference.index,
          kind: 'positional',
        },
  )

  return {
    matcherCaptureIndex: nextCaptureIndex,
    output: `${output}(?<${captureName}>${originalReference.pattern})`,
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

function resolveOriginalCaptureReference(
  content: string,
  originalCapturePatterns: OriginalCapturePatterns | undefined,
): OriginalCaptureReference | null {
  if (!originalCapturePatterns) {
    return null
  }

  const normalized = content.trim()
  const positionalMatch = /^\d+$/.exec(normalized)

  if (positionalMatch) {
    const index = Number(normalized)
    const pattern = originalCapturePatterns.positionalCaptures[index - 1]

    return pattern
      ? {
          index,
          kind: 'positional',
          pattern,
        }
      : null
  }

  if (!isCaptureReferenceName(normalized)) {
    return null
  }

  const pattern = getCaseInsensitiveMapValue(
    originalCapturePatterns.namedCaptures,
    normalized,
  )

  return pattern
    ? {
        kind: 'named',
        name: normalized,
        pattern,
      }
    : null
}

function looksLikeOriginalCaptureReference(content: string) {
  const normalized = content.trim()
  return /^\d+$/.test(normalized) || isCaptureReferenceName(normalized)
}

function isCaptureReferenceName(value: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
}

function getCaseInsensitiveMapValue(map: Map<string, string>, key: string) {
  const direct = map.get(key)
  if (direct !== undefined) {
    return direct
  }

  return [...map.entries()].find(([candidateKey]) => {
    return candidateKey.localeCompare(key, undefined, {
      sensitivity: 'base',
    }) === 0
  })?.[1]
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
  const internalCaptureNames = getInternalCaptureNames(compiledPattern)

  Object.entries(namedCaptures).forEach(([name, value]) => {
    if (internalCaptureNames.has(name)) {
      return
    }

    filteredCaptures[name] = value ?? ''
  })

  return filteredCaptures
}

function getInternalCaptureNames(compiledPattern: AlertCompiledPattern) {
  return new Set([
    ...compiledPattern.captureBindings.map((binding) => binding.captureName),
    ...compiledPattern.captureAliases.map((alias) => alias.captureName),
  ])
}

function getNamedCaptureAliases(
  compiledPattern: AlertCompiledPattern,
  match: RegexMatchFoundMessage,
) {
  const namedCaptures: Record<string, string> = {}

  compiledPattern.captureAliases.forEach((alias) => {
    if (alias.kind !== 'named') {
      return
    }

    const value = match.captures.named[alias.captureName]
    if (typeof value === 'string') {
      namedCaptures[alias.name] = value
    }
  })

  return namedCaptures
}

function getPositionalCaptureConstraints(
  compiledPattern: AlertCompiledPattern,
  match: RegexMatchFoundMessage,
) {
  const values = compiledPattern.userPositionalCaptureIndexes.map(
    (index) => match.captures.positional[index - 1] ?? '',
  )
  const indexes = values.map((_value, index) => index + 1)

  compiledPattern.captureAliases.forEach((alias) => {
    if (alias.kind !== 'positional') {
      return
    }

    const value = match.captures.named[alias.captureName]
    if (typeof value !== 'string') {
      return
    }

    values.push(value)
    indexes.push(alias.index)
  })

  return {
    ...(isSequentialOneBased(indexes) ? {} : { indexes }),
    values,
  }
}

function isSequentialOneBased(indexes: number[]) {
  return indexes.every((index, arrayIndex) => index === arrayIndex + 1)
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

function createOriginalCaptureName({
  capturePrefix,
  occurrence,
  reference,
}: {
  capturePrefix: string
  occurrence: number
  reference: OriginalCaptureReference
}) {
  const referencePart =
    reference.kind === 'named' ? reference.name : `pos_${reference.index}`

  return `${capturePrefix}_original_${sanitizeCapturePart(referencePart)}_${occurrence}`
}

function getOriginalCapturePatterns(
  matcher: JenaTriggerMatcher,
): OriginalCapturePatterns {
  if (!matcher.isRegex) {
    return {
      namedCaptures: new Map(),
      positionalCaptures: [],
    }
  }

  return extractOriginalCapturePatterns(matcher.text)
}

function extractOriginalCapturePatterns(source: string): OriginalCapturePatterns {
  const namedCaptures = new Map<string, string>()
  const positionalCaptures: string[] = []
  let inCharacterClass = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]

    if (char === '\\') {
      index += 1
      continue
    }

    if (char === '[') {
      inCharacterClass = true
      continue
    }

    if (char === ']' && inCharacterClass) {
      inCharacterClass = false
      continue
    }

    if (inCharacterClass || char !== '(') {
      continue
    }

    const group = getCaptureGroupAt(source, index)
    if (!group) {
      continue
    }

    const closingIndex = findClosingGroupIndex(source, index)
    if (closingIndex === null) {
      continue
    }

    const pattern = source.slice(group.contentStartIndex, closingIndex)

    positionalCaptures.push(pattern)
    if (group.name && !namedCaptures.has(group.name)) {
      namedCaptures.set(group.name, pattern)
    }
  }

  return {
    namedCaptures,
    positionalCaptures,
  }
}

function getCaptureGroupAt(source: string, openIndex: number) {
  if (source[openIndex + 1] !== '?') {
    return {
      contentStartIndex: openIndex + 1,
      name: null,
    }
  }

  if (
    source[openIndex + 2] === '<' &&
    source[openIndex + 3] !== '=' &&
    source[openIndex + 3] !== '!'
  ) {
    const nameEndIndex = source.indexOf('>', openIndex + 3)
    if (nameEndIndex === -1) {
      return null
    }

    const name = source.slice(openIndex + 3, nameEndIndex)
    if (!isCaptureReferenceName(name)) {
      return null
    }

    return {
      contentStartIndex: nameEndIndex + 1,
      name,
    }
  }

  return null
}

function findClosingGroupIndex(source: string, openIndex: number) {
  let depth = 0
  let inCharacterClass = false

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index]

    if (char === '\\') {
      index += 1
      continue
    }

    if (char === '[') {
      inCharacterClass = true
      continue
    }

    if (char === ']' && inCharacterClass) {
      inCharacterClass = false
      continue
    }

    if (inCharacterClass) {
      continue
    }

    if (char === '(') {
      depth += 1
      continue
    }

    if (char !== ')') {
      continue
    }

    depth -= 1
    if (depth === 0) {
      return index
    }
  }

  return null
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
