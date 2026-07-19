import { Dices } from 'lucide-react'
import type { RollRecord } from './types'
import { categorizeRolls } from './categorizedRollsModel'

const rollBoundFormatter = new Intl.NumberFormat()

export function CategorizedRolls({ rolls }: { rolls: RollRecord[] }) {
  const categories = categorizeRolls(rolls)

  if (categories.length === 0) {
    return <div className="rolls-empty">No rolls in the selected time range.</div>
  }

  return (
    <div className="roll-category-list">
      {categories.map((category) => {
        const repeatedRollers = getRepeatedRollers(category.rolls)

        return (
          <section className="roll-category-card" key={category.key}>
            <header className="roll-category-header">
              <h2 className="roll-category-title" title="Possible roll range">
                <Dices aria-hidden="true" size={17} />
                <span>
                  {formatRollBound(category.lowerBound)}–
                  {formatRollBound(category.upperBound)}
                </span>
              </h2>
              <span>
                {category.rolls.length}{' '}
                {category.rolls.length === 1 ? 'roll' : 'rolls'}
              </span>
            </header>
            <table className="roll-category-table">
              <colgroup>
                <col className="roll-category-value-column" />
                <col />
                <col className="roll-category-time-column" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Roll</th>
                  <th scope="col">Roller</th>
                  <th scope="col">Time</th>
                </tr>
              </thead>
              <tbody>
                {category.rolls.map((roll) => (
                  <tr key={roll.id}>
                    <td>
                      <span className="roll-value-pill">{roll.value}</span>
                    </td>
                    <td
                      className={
                        repeatedRollers.has(normalizeRoller(roll.roller))
                          ? 'roll-category-roller roll-category-roller-repeated'
                          : 'roll-category-roller'
                      }
                    >
                      {roll.roller}
                    </td>
                    <td title={getRollTimestampTitle(roll)}>
                      {formatRollTime(roll.timestampMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )
      })}
    </div>
  )
}

function formatRollBound(value: number) {
  return rollBoundFormatter.format(value)
}

function getRepeatedRollers(rolls: RollRecord[]) {
  const counts = new Map<string, number>()

  rolls.forEach((roll) => {
    const roller = normalizeRoller(roll.roller)
    counts.set(roller, (counts.get(roller) ?? 0) + 1)
  })

  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([roller]) => roller),
  )
}

function normalizeRoller(roller: string) {
  return roller.trim().toLocaleLowerCase()
}

function getRollTimestampTitle(roll: RollRecord) {
  const sources = roll.observations
    .map(
      (observation) =>
        `${observation.characterName} (${observation.serverName})`,
    )
    .join(', ')

  return `${roll.timestamp}\nObserved by ${sources}`
}

function formatRollTime(timestampMs: number) {
  const date = new Date(timestampMs)
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')
}
