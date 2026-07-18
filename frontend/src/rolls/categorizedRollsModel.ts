import type { RollRecord } from './types'

export interface RollCategory {
  key: string
  lowerBound: number
  rolls: RollRecord[]
  upperBound: number
}

export function categorizeRolls(rolls: RollRecord[]) {
  const categoriesByKey = new Map<string, RollCategory>()

  rolls.forEach((roll) => {
    const key = `${roll.lowerBound}\0${roll.upperBound}`
    const category = categoriesByKey.get(key) ?? {
      key,
      lowerBound: roll.lowerBound,
      rolls: [],
      upperBound: roll.upperBound,
    }

    category.rolls.push(roll)
    categoriesByKey.set(key, category)
  })

  return [...categoriesByKey.values()]
    .map((category) => ({
      ...category,
      rolls: category.rolls.sort(compareRollsWithinCategory),
    }))
    .sort((left, right) => {
      return (
        left.upperBound - right.upperBound ||
        left.lowerBound - right.lowerBound
      )
    })
}

function compareRollsWithinCategory(left: RollRecord, right: RollRecord) {
  return (
    right.value - left.value ||
    left.firstObservedAtMs - right.firstObservedAtMs ||
    left.roller.localeCompare(right.roller, undefined, { sensitivity: 'base' }) ||
    left.id.localeCompare(right.id)
  )
}
