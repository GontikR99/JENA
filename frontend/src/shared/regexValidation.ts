import { RE2JS } from 're2js'

export type RegexMatcherEngine = 're2' | 'javascript'

export type RegexValidationResult =
  | {
      compiledPattern: RE2JS
      engine: 're2'
      ok: true
      translatedPattern: string
    }
  | {
      compiledPattern: RegExp
      engine: 'javascript'
      ok: true
    }
  | {
      error: string
      javascriptError: string
      ok: false
      re2Error: string
    }

export function validateRegexPattern(pattern: string): RegexValidationResult {
  try {
    const translatedPattern = RE2JS.translateRegExp(pattern)

    return {
      compiledPattern: RE2JS.compile(translatedPattern, RE2JS.CASE_INSENSITIVE),
      engine: 're2',
      ok: true,
      translatedPattern,
    }
  } catch (re2Error) {
    try {
      return {
        compiledPattern: compileJavaScriptPattern(pattern, { global: true }),
        engine: 'javascript',
        ok: true,
      }
    } catch (javascriptError) {
      const re2Message = getErrorMessage(re2Error)
      const javascriptMessage = getErrorMessage(javascriptError)

      return {
        error: `RE2JS: ${re2Message}; JavaScript: ${javascriptMessage}`,
        javascriptError: javascriptMessage,
        ok: false,
        re2Error: re2Message,
      }
    }
  }
}

export function compileJavaScriptPattern(
  pattern: string,
  { global = false }: { global?: boolean } = {},
) {
  const flags = new Set(global ? 'gi' : 'i')
  let source = pattern

  // JavaScript uses constructor flags for leading RE2/.NET flag groups.
  // Leave scoped or non-leading groups intact for native syntax validation.
  while (true) {
    const modifier = /^\(\?([ims]*)(?:-([ims]+))?\)/.exec(source)
    if (!modifier || (!modifier[1] && !modifier[2])) {
      break
    }

    for (const flag of modifier[1]) {
      flags.add(flag)
    }
    for (const flag of modifier[2] ?? '') {
      flags.delete(flag)
    }
    source = source.slice(modifier[0].length)
  }

  return new RegExp(source, [...flags].join(''))
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
