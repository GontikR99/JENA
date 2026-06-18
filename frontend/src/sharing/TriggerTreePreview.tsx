import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { JenaTrigger } from '../shared/triggers'
import './TriggerTreePreview.css'

interface TriggerTreeNode {
  children: Map<string, TriggerTreeNode>
  id: string
  name: string
  path: string[]
  triggers: JenaTrigger[]
}

interface VisibleTreeRow {
  depth: number
  id: string
  label: string
  triggerCount?: number
  type: 'group' | 'trigger'
}

export function TriggerTreePreview({ triggers }: { triggers: JenaTrigger[] }) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const root = useMemo(() => buildTriggerTree(triggers), [triggers])
  const rows = useMemo(
    () => getVisibleRows(root, expandedGroups),
    [expandedGroups, root],
  )

  return (
    <div className="trigger-tree-preview" role="tree">
      {rows.length === 0 ? (
        <div className="trigger-tree-preview-empty">No triggers</div>
      ) : null}
      {rows.map((row) => {
        if (row.type === 'trigger') {
          return (
            <div
              className="trigger-tree-preview-row trigger-tree-preview-trigger"
              key={row.id}
              role="treeitem"
              style={{ paddingLeft: `${row.depth * 1.25 + 0.5}rem` }}
            >
              {row.label}
            </div>
          )
        }

        const expanded = expandedGroups.has(row.id)

        return (
          <button
            aria-expanded={expanded}
            className="trigger-tree-preview-row trigger-tree-preview-group"
            key={row.id}
            onClick={() => {
              setExpandedGroups((current) => {
                const next = new Set(current)
                if (next.has(row.id)) {
                  next.delete(row.id)
                } else {
                  next.add(row.id)
                }

                return next
              })
            }}
            role="treeitem"
            style={{ paddingLeft: `${row.depth * 1.25 + 0.25}rem` }}
            type="button"
          >
            <ChevronRight
              aria-hidden="true"
              className={
                expanded
                  ? 'trigger-tree-preview-chevron trigger-tree-preview-chevron-expanded'
                  : 'trigger-tree-preview-chevron'
              }
              size={14}
            />
            <span>{row.label}</span>
            <span className="trigger-tree-preview-count">{row.triggerCount}</span>
          </button>
        )
      })}
    </div>
  )
}

function buildTriggerTree(triggers: JenaTrigger[]) {
  const root: TriggerTreeNode = {
    children: new Map(),
    id: '',
    name: '',
    path: [],
    triggers: [],
  }

  triggers
    .slice()
    .sort(compareTriggersByPath)
    .forEach((trigger) => {
      let node = root
      trigger.groupPath.forEach((groupName, index) => {
        const path = trigger.groupPath.slice(0, index + 1)
        const id = getGroupId(path)
        let child = node.children.get(groupName)
        if (!child) {
          child = {
            children: new Map(),
            id,
            name: groupName,
            path,
            triggers: [],
          }
          node.children.set(groupName, child)
        }

        node = child
      })

      node.triggers.push(trigger)
    })

  return root
}

function getVisibleRows(
  node: TriggerTreeNode,
  expandedGroups: Set<string>,
  depth = 0,
) {
  const rows: VisibleTreeRow[] = []
  const childGroups = [...node.children.values()].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }),
  )

  childGroups.forEach((child) => {
    rows.push({
      depth,
      id: child.id,
      label: child.name,
      triggerCount: countTriggers(child),
      type: 'group',
    })

    if (expandedGroups.has(child.id)) {
      rows.push(...getVisibleRows(child, expandedGroups, depth + 1))
    }
  })

  node.triggers
    .slice()
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }),
    )
    .forEach((trigger) => {
      rows.push({
        depth,
        id: trigger.id,
        label: trigger.name,
        type: 'trigger',
      })
    })

  return rows
}

function countTriggers(node: TriggerTreeNode): number {
  let count = node.triggers.length
  node.children.forEach((child) => {
    count += countTriggers(child)
  })

  return count
}

function compareTriggersByPath(left: JenaTrigger, right: JenaTrigger) {
  const pathComparison = left.groupPath
    .join('\0')
    .localeCompare(right.groupPath.join('\0'), undefined, {
      sensitivity: 'base',
    })
  if (pathComparison !== 0) {
    return pathComparison
  }

  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
}

function getGroupId(path: string[]) {
  return path.join('\u001f')
}
