export function getSpeechSynthesis(): SpeechSynthesis | null {
  return globalThis.speechSynthesis ?? null
}

export function createSpeechUtterance(
  text: string,
): SpeechSynthesisUtterance | null {
  if (typeof globalThis.SpeechSynthesisUtterance !== 'function') {
    return null
  }

  return new globalThis.SpeechSynthesisUtterance(text)
}
