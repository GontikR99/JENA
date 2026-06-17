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
      compiledPattern: RE2JS.compile(translatedPattern),
      engine: 're2',
      ok: true,
      translatedPattern,
    }
  } catch (re2Error) {
    try {
      return {
        compiledPattern: new RegExp(pattern, 'g'),
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

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
