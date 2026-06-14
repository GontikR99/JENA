import type {
  CharacterPresence,
  FileWatcherCharactersMessage,
  RegexMatchFoundMessage,
  RegexPatternRegistration,
} from '../shared/messages'
import { createContentHashUuid } from '../shared/hashIds'
import { getDependency, type Deps } from './di'
import { MessageBroker } from './MessageBroker'

const zoneEnteredRegularExpression = '^You have entered (?<zone>.*)[.]$'
const whoZoneRegularExpression =
  '^\\[[^\\]]+\\]\\s+(?<characterName>\\S+)\\s+(?:\\([^)]*\\)\\s+)?(?:<[^>]*>\\s+)?ZONE:\\s+(?<zone>.+?)\\s+\\([^)]+\\)\\s*$'
const serverPresenceIntervalMs = 30_000

interface CharacterIdentity {
  characterName: string
  serverName: string
}

export class CharacterPresenceService {
  private readonly broker: MessageBroker
  private readonly charactersByKey = new Map<string, CharacterPresence>()
  private readonly unregister: Array<() => void>
  private lastServerCharactersSignature = ''
  private readonly serverPresenceIntervalId: ReturnType<
    typeof globalThis.setInterval
  >
  private whoZonePatternId: string | null = null
  private zoneEnteredPatternId: string | null = null

  constructor(deps: Deps) {
    this.broker = getDependency(deps, MessageBroker)

    this.unregister = [
      this.broker.register('character-presence', {
        getCharacters: this.getCharacters,
      }),
      this.broker.listen('file-watcher.characters', (message) => {
        this.handleFileWatcherCharacters(
          message.payload as FileWatcherCharactersMessage,
        )
      }),
      this.broker.listen('client.matcher.match-found', (message) => {
        this.handleMatchFound(message.payload as RegexMatchFoundMessage)
      }),
    ]

    this.serverPresenceIntervalId = globalThis.setInterval(() => {
      this.sendServerCharacters(true)
    }, serverPresenceIntervalMs)

    void this.registerPresencePatterns()
  }

  dispose() {
    globalThis.clearInterval(this.serverPresenceIntervalId)

    this.unregister.forEach((unregister) => {
      unregister()
    })
  }

  private readonly getCharacters = () => {
    return {
      characters: this.getCharactersSnapshot(),
    }
  }

  private handleFileWatcherCharacters(message: FileWatcherCharactersMessage) {
    const nextKeys = new Set<string>()

    message.characters.forEach((character) => {
      const key = getCharacterKey(character)
      const existingCharacter = this.charactersByKey.get(key)

      nextKeys.add(key)
      this.charactersByKey.set(key, {
        active: character.active,
        characterName: character.characterName,
        serverName: character.serverName,
        zone: existingCharacter?.zone ?? '',
      })
    })

    this.charactersByKey.forEach((_character, key) => {
      if (!nextKeys.has(key)) {
        this.charactersByKey.delete(key)
      }
    })

    this.broadcastCharacters()
  }

  private handleMatchFound(message: RegexMatchFoundMessage) {
    if (message.patternId === this.zoneEnteredPatternId) {
      this.handleZoneEnteredMatch(message)
      return
    }

    if (message.patternId === this.whoZonePatternId) {
      this.handleWhoZoneMatch(message)
    }
  }

  private handleZoneEnteredMatch(message: RegexMatchFoundMessage) {
    const zone = message.captures.named.zone
    if (!zone) {
      return
    }

    const key = getCharacterKey(message)
    const existingCharacter = this.charactersByKey.get(key)

    this.charactersByKey.set(key, {
      active: existingCharacter?.active ?? true,
      characterName: message.characterName,
      serverName: message.serverName,
      zone,
    })

    this.broadcastCharacters()
  }

  private handleWhoZoneMatch(message: RegexMatchFoundMessage) {
    const capturedCharacterName = message.captures.named.characterName
    const zone = message.captures.named.zone

    if (!capturedCharacterName || !zone) {
      return
    }

    if (
      normalizeCharacterName(capturedCharacterName) !==
      normalizeCharacterName(message.characterName)
    ) {
      return
    }

    const key = getCharacterKey(message)
    const existingCharacter = this.charactersByKey.get(key)

    this.charactersByKey.set(key, {
      active: existingCharacter?.active ?? true,
      characterName: existingCharacter?.characterName ?? message.characterName,
      serverName: existingCharacter?.serverName ?? message.serverName,
      zone,
    })

    this.broadcastCharacters()
  }

  private async registerPresencePatterns() {
    const zoneEnteredPattern = await createZoneEnteredPatternRegistration()
    const whoZonePattern = await createWhoZonePatternRegistration()

    this.zoneEnteredPatternId = zoneEnteredPattern.id
    this.whoZonePatternId = whoZonePattern.id

    await this.broker.call(
      'character-presence',
      'matcher-service',
      'add-patterns',
      {
        patterns: [zoneEnteredPattern, whoZonePattern],
      },
    )
  }

  private broadcastCharacters() {
    const characters = this.getCharactersSnapshot()

    this.broker.send('character-presence', 'client.character-presence.characters', {
      characters,
    })
    this.sendServerCharacters(false, characters)
  }

  private sendServerCharacters(
    force: boolean,
    characters = this.getCharactersSnapshot(),
  ) {
    const signature = getCharactersSignature(characters)

    if (!force && signature === this.lastServerCharactersSignature) {
      return
    }

    this.lastServerCharactersSignature = signature

    this.broker.send('character-presence', 'server.character-presence.characters', {
      characters,
    })
  }

  private getCharactersSnapshot() {
    return [...this.charactersByKey.values()].sort(compareCharacters)
  }
}

export async function createZoneEnteredPatternRegistration(): Promise<RegexPatternRegistration> {
  return {
    id: await createContentHashUuid({
      regularExpression: zoneEnteredRegularExpression,
      source: 'character-presence',
      type: 'regex-pattern',
    }),
    regularExpression: zoneEnteredRegularExpression,
  }
}

export async function createWhoZonePatternRegistration(): Promise<RegexPatternRegistration> {
  return {
    id: await createContentHashUuid({
      regularExpression: whoZoneRegularExpression,
      source: 'character-presence',
      type: 'regex-pattern',
    }),
    regularExpression: whoZoneRegularExpression,
  }
}

function getCharacterKey(character: CharacterIdentity) {
  return `${character.serverName.toLocaleLowerCase()}\0${normalizeCharacterName(character.characterName)}`
}

function normalizeCharacterName(characterName: string) {
  return characterName.trim().toLocaleLowerCase()
}

function compareCharacters(left: CharacterPresence, right: CharacterPresence) {
  const characterComparison = compareStrings(
    left.characterName,
    right.characterName,
  )

  if (characterComparison !== 0) {
    return characterComparison
  }

  return compareStrings(left.serverName, right.serverName)
}

function compareStrings(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: 'base' })
}

function getCharactersSignature(characters: CharacterPresence[]) {
  return JSON.stringify(characters)
}
