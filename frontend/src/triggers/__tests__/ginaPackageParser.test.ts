import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parseGinaPackageFile } from '../gina/ginaPackageParser'

describe('parseGinaPackageFile', () => {
  it('parses ShareData.xml from a GINA package into canonical triggers', async () => {
    const progressCalls: Array<{
      bytesProcessed: number
      bytesTotal: number
      elapsedMs: number
      estimatedMs: number
    }> = []
    const file = createGinaPackageFile(createShareDataXml())

    const triggers = await parseGinaPackageFile(file, {
      onProgress: (
        bytesProcessed,
        bytesTotal,
        elapsedMs,
        estimatedMs,
      ) => {
        progressCalls.push({
          bytesProcessed,
          bytesTotal,
          elapsedMs,
          estimatedMs,
        })
      },
    })

    expect(triggers).toHaveLength(2)
    expect(triggers[0]).toMatchObject({
      name: 'Literal Trigger',
      comments: 'Literal comments',
      category: 'Warnings',
      groupPath: ['Root Group', 'Raid Group'],
      match: {
        text: "A boss says, 'Run away.' {C}",
        isRegex: false,
      },
      actions: {
        display: {
          enabled: true,
          text: 'Run away!',
        },
        speech: {
          enabled: true,
          interrupt: true,
          text: 'Run away',
        },
        clipboard: {
          enabled: true,
          text: '/rs Running',
        },
      },
      timer: {
        type: 'countdown',
        name: 'Literal Timer',
        durationMs: 5000,
        startBehavior: 'restartMatchingTimerName',
        warningSeconds: 2,
        warningAction: {
          display: {
            enabled: true,
            text: 'Almost done',
          },
          speech: {
            enabled: true,
            interrupt: false,
            text: 'Almost done',
          },
        },
        endedAction: {
          display: {
            enabled: true,
            text: 'Done',
          },
          speech: {
            enabled: false,
            interrupt: false,
            text: '',
          },
        },
        earlyEnders: [
          { text: 'Timer done', isRegex: false },
          { text: 'done (?<target>.+)', isRegex: true },
        ],
      },
    })
    expect(triggers[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
    expect(triggers[1]).toMatchObject({
      name: 'Regex Trigger',
      category: 'Default',
      groupPath: ['Root Group'],
      match: {
        text: 'The (.+) shouts',
        isRegex: true,
      },
      timer: null,
    })
    expect(progressCalls.length).toBeGreaterThanOrEqual(2)
    expect(progressCalls.at(0)).toMatchObject({
      bytesProcessed: 0,
      bytesTotal: file.size,
    })
    expect(progressCalls.at(-1)).toMatchObject({
      bytesProcessed: file.size,
      bytesTotal: file.size,
      estimatedMs: 0,
    })
  })

  it('coalesces duplicate triggers with identical content', async () => {
    const xml = createShareDataXml().replace(
      '</Triggers>',
      `${literalTriggerXml()}</Triggers>`,
    )
    const file = createGinaPackageFile(xml)

    const triggers = await parseGinaPackageFile(file)

    expect(triggers).toHaveLength(2)
  })
})

function createGinaPackageFile(xml: string) {
  const zipped = zipSync({
    'ShareData.xml': strToU8(xml),
  })

  return new File([zipped], 'triggers.gtp', {
    type: 'application/zip',
  })
}

function createShareDataXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<SharedData>
  <TriggerGroups>
    <TriggerGroup>
      <Name>Root Group</Name>
      <Comments></Comments>
      <SelfCommented>False</SelfCommented>
      <GroupId>0</GroupId>
      <EnableByDefault>False</EnableByDefault>
      <TriggerGroups>
        <TriggerGroup>
          <Name>Raid Group</Name>
          <Comments></Comments>
          <SelfCommented>False</SelfCommented>
          <GroupId>0</GroupId>
          <EnableByDefault>False</EnableByDefault>
          <Triggers>
            ${literalTriggerXml()}
          </Triggers>
        </TriggerGroup>
      </TriggerGroups>
      <Triggers>
        <Trigger>
          <Name>Regex Trigger</Name>
          <TriggerText>The (.+) shouts</TriggerText>
          <Comments></Comments>
          <EnableRegex>True</EnableRegex>
          <UseText>False</UseText>
          <DisplayText></DisplayText>
          <CopyToClipboard>False</CopyToClipboard>
          <ClipboardText></ClipboardText>
          <UseTextToVoice>False</UseTextToVoice>
          <InterruptSpeech>False</InterruptSpeech>
          <TextToVoiceText></TextToVoiceText>
          <PlayMediaFile>False</PlayMediaFile>
          <TimerType>NoTimer</TimerType>
          <TimerName></TimerName>
          <RestartBasedOnTimerName>False</RestartBasedOnTimerName>
          <TimerMillisecondDuration>0</TimerMillisecondDuration>
          <TimerDuration>0</TimerDuration>
          <TimerStartBehavior>StartNewTimer</TimerStartBehavior>
          <TimerEndingTime>0</TimerEndingTime>
          <UseTimerEnding>False</UseTimerEnding>
          <UseTimerEnded>False</UseTimerEnded>
          <Category>Default</Category>
          <TimerEarlyEnders />
        </Trigger>
      </Triggers>
    </TriggerGroup>
  </TriggerGroups>
</SharedData>`
}

function literalTriggerXml() {
  return `<Trigger>
  <Name>Literal Trigger</Name>
  <TriggerText>A boss says, 'Run away.' {C}</TriggerText>
  <Comments>Literal comments</Comments>
  <EnableRegex>False</EnableRegex>
  <UseText>True</UseText>
  <DisplayText>Run away!</DisplayText>
  <CopyToClipboard>True</CopyToClipboard>
  <ClipboardText>/rs Running</ClipboardText>
  <UseTextToVoice>True</UseTextToVoice>
  <InterruptSpeech>True</InterruptSpeech>
  <TextToVoiceText>Run away</TextToVoiceText>
  <PlayMediaFile>True</PlayMediaFile>
  <TimerType>Timer</TimerType>
  <TimerName>Literal Timer</TimerName>
  <RestartBasedOnTimerName>True</RestartBasedOnTimerName>
  <TimerMillisecondDuration>5000</TimerMillisecondDuration>
  <TimerDuration>5</TimerDuration>
  <TimerStartBehavior>RestartTimer</TimerStartBehavior>
  <TimerEndingTime>2</TimerEndingTime>
  <UseTimerEnding>True</UseTimerEnding>
  <TimerEndingTrigger>
    <UseText>True</UseText>
    <DisplayText>Almost done</DisplayText>
    <UseTextToVoice>True</UseTextToVoice>
    <InterruptSpeech>False</InterruptSpeech>
    <TextToVoiceText>Almost done</TextToVoiceText>
    <PlayMediaFile>False</PlayMediaFile>
  </TimerEndingTrigger>
  <UseTimerEnded>True</UseTimerEnded>
  <TimerEndedTrigger>
    <UseText>True</UseText>
    <DisplayText>Done</DisplayText>
    <UseTextToVoice>False</UseTextToVoice>
    <InterruptSpeech>False</InterruptSpeech>
    <TextToVoiceText></TextToVoiceText>
    <PlayMediaFile>False</PlayMediaFile>
  </TimerEndedTrigger>
  <Category>Warnings</Category>
  <TimerEarlyEnders>
    <EarlyEnder>
      <EarlyEndText>Timer done</EarlyEndText>
      <EnableRegex>False</EnableRegex>
    </EarlyEnder>
    <EarlyEnder>
      <EarlyEndText>done (?&lt;target&gt;.+)</EarlyEndText>
      <EnableRegex>True</EnableRegex>
    </EarlyEnder>
  </TimerEarlyEnders>
</Trigger>`
}
