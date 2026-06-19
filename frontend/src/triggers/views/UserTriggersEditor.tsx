import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, MouseEvent } from 'react'
import { ControlledMenu, MenuDivider, MenuItem, useMenuState } from '@szhsin/react-menu'
import { FolderPlus, Globe, GlobeOff, ListPlus, Radio, RadioOff } from 'lucide-react'
import '@szhsin/react-menu/dist/index.css'
import Alert from 'react-bootstrap/Alert'
import Button from 'react-bootstrap/Button'
import ButtonGroup from 'react-bootstrap/ButtonGroup'
import Dropdown from 'react-bootstrap/Dropdown'
import Modal from 'react-bootstrap/Modal'
import ProgressBar from 'react-bootstrap/ProgressBar'
import toast from 'react-hot-toast'
import { useAuth } from '../../auth/authContext'
import type { CharacterPresence } from '../../shared/messages'
import { useRpc } from '../../shared/messageBrokerHooks'
import {
  createEmptyTrigger,
  getJenaCharacterServerKey,
  withCanonicalTriggerId,
  type JenaBroadcastMode,
  type JenaCharacterServer,
  type JenaResolvedTrigger,
  type JenaTrigger,
  type JenaTriggerId,
  type JenaTriggerUpsert,
} from '../../shared/triggers'
import {
  FourStateCheckbox,
  TERNARY,
  type FourStateCheckboxState,
} from '../../shared/widgets/FourStateCheckbox'
import { IconTriStateToggle } from '../../shared/widgets/IconTriStateToggle'
import type { IconTriStateToggleState } from '../../shared/widgets/IconTriStateToggle'
import { TriggerEditorDialog } from '../editor/TriggerEditorDialog'
import { exportGinaPackageFile } from '../gina/ginaPackageExporter'
import { parseGinaPackageFile } from '../gina/ginaPackageParser'
import { useTriggerStore } from '../model/TriggerStore'
import { useTriggerManager } from '../model/UserTriggerManager'
import './UserTriggersEditor.css'

const databaseName = 'jena'
const databaseVersion = 4
const handlesStoreName = 'handles'
const triggerCacheStoreName = 'trigger-cache'
const userTriggerCacheStoreName = 'user-trigger-cache'
const settingsStoreName = 'settings'
const emptyGroupsCacheKey = 'user-trigger-editor-empty-groups'
const triggerMutationChunkSize = 100

interface UserTriggersEditorProps {
  selectedCharacter: CharacterPresence | null
}

type TreeItem = TreeGroupItem | TreeTriggerItem

interface TreeGroupItem {
  childCount: number
  id: string
  name: string
  path: string[]
  triggerCount: number
  type: 'group'
}

interface TreeTriggerItem {
  id: JenaTriggerId
  path: string[]
  resolved: JenaResolvedTrigger
  type: 'trigger'
}

interface MenuTarget {
  item: TreeItem | null
}

interface EditorSession {
  original: JenaResolvedTrigger | null
  trigger: JenaTrigger
}

type ImportPhase = 'reading' | 'saving' | 'complete' | 'error'
type OperationPhase = 'complete' | 'error' | 'running'
type ExportPhase = 'complete' | 'error' | 'writing'
type BroadcastModeState = JenaBroadcastMode | 'mixed'
type UserTriggerCheckboxState = Exclude<FourStateCheckboxState, 'inherit'>

interface ImportSession {
  elapsedMs: number
  error: string
  fileName: string
  importedCount: number
  phase: ImportPhase
  processedBytes: number
  estimatedMs: number
  savedBatches: number
  savedCount: number
  totalBytes: number
  totalBatches: number
  totalSaveCount: number
}

interface OperationSession {
  error: string
  phase: OperationPhase
  processedBatches: number
  processedCount: number
  title: string
  totalBatches: number
  totalCount: number
}

interface ExportSession {
  elapsedMs: number
  error: string
  estimatedMs: number
  fileName: string
  phase: ExportPhase
  processedBytes: number
  title: string
  totalBytes: number
  triggerCount: number
}

interface TriggerReplacement {
  newTrigger: JenaTrigger
  oldTriggerId: JenaTriggerId
  upsert: JenaTriggerUpsert
}

type TreeSelection =
  | { type: 'none' }
  | { type: 'group'; path: string[] }
  | {
      anchorId: JenaTriggerId | null
      ids: Set<JenaTriggerId>
      type: 'triggers'
    }

export function UserTriggersEditor({
  selectedCharacter,
}: UserTriggersEditorProps) {
  const {
    collapsedGroupIds,
    deleteTriggers,
    reconcileKnownGroupIds,
    setTriggerFlags,
    setGroupCollapsed,
    toggleGroupCollapsed,
    toggleTriggers,
    triggers,
    upsertTrigger,
    upsertTriggers,
  } = useTriggerManager()
  const call = useRpc('user-triggers-editor')
  const triggerStore = useTriggerStore()
  const { isAuthenticated } = useAuth()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [emptyGroups, setEmptyGroups] = useState<string[][]>([])
  const [emptyGroupsLoaded, setEmptyGroupsLoaded] = useState(false)
  const [selection, setSelection] = useState<TreeSelection>({ type: 'none' })
  const [editorSession, setEditorSession] = useState<EditorSession | null>(null)
  const [importSession, setImportSession] = useState<ImportSession | null>(null)
  const [exportSession, setExportSession] = useState<ExportSession | null>(null)
  const [operationSession, setOperationSession] =
    useState<OperationSession | null>(null)
  const [menuTarget, setMenuTarget] = useState<MenuTarget>({ item: null })
  const [anchorPoint, setAnchorPoint] = useState({ x: 0, y: 0 })
  const [{ state: menuState, endTransition }, setMenuOpen] = useMenuState()
  const selectedCharacterKey = selectedCharacter
    ? getJenaCharacterServerKey(selectedCharacter)
    : null
  const selectedCharacterRecord = selectedCharacter
    ? toCharacterServer(selectedCharacter)
    : null
  const treeItems = useMemo(
    () => buildVisibleTreeItems(triggers, emptyGroups, collapsedGroupIds),
    [collapsedGroupIds, emptyGroups, triggers],
  )
  const groupIds = useMemo(
    () => getGroupIds(triggers, emptyGroups),
    [emptyGroups, triggers],
  )
  const triggerOrder = useMemo(
    () =>
      treeItems.flatMap((item) => {
        return item.type === 'trigger' ? [item.id] : []
      }),
    [treeItems],
  )
  const triggersById = useMemo(
    () =>
      new Map(triggers.map((resolved) => [resolved.trigger.id, resolved])),
    [triggers],
  )
  const groupStatesById = useMemo(
    () => getGroupStatesById(triggers, selectedCharacterKey),
    [selectedCharacterKey, triggers],
  )
  const selectedTriggerIds =
    selection.type === 'triggers'
      ? selection.ids
      : new Set<JenaTriggerId>()
  const selectedGroupPath =
    selection.type === 'group' ? selection.path : null
  const showEnableColumn = !!selectedCharacterRecord

  useEffect(() => {
    let cancelled = false

    void readEmptyGroups()
      .then((groups) => {
        if (!cancelled) {
          setEmptyGroups(groups)
          setEmptyGroupsLoaded(true)
        }
      })
      .catch((error: unknown) => {
        console.warn('[UserTriggersEditor] unable to load groups', error)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!emptyGroupsLoaded) {
      return
    }

    void writeEmptyGroups(emptyGroups).catch((error: unknown) => {
      console.warn('[UserTriggersEditor] unable to persist groups', error)
    })
  }, [emptyGroups, emptyGroupsLoaded])

  useEffect(() => {
    reconcileKnownGroupIds(groupIds)
  }, [groupIds, reconcileKnownGroupIds])

  function openContextMenu(
    event: MouseEvent,
    item: TreeItem | null,
  ) {
    event.preventDefault()
    event.stopPropagation()
    setMenuTarget({ item })
    setAnchorPoint({ x: event.clientX, y: event.clientY })

    if (item?.type === 'trigger' && !selectedTriggerIds.has(item.id)) {
      setSelection({
        anchorId: item.id,
        ids: new Set([item.id]),
        type: 'triggers',
      })
    } else if (item?.type === 'group') {
      setSelection((current) => {
        if (current.type === 'triggers' && current.ids.size > 0) {
          return current
        }
        if (
          current.type === 'group' &&
          !areStringArraysEqual(current.path, item.path)
        ) {
          return current
        }
        return { path: item.path, type: 'group' }
      })
    } else if (!item) {
      setSelection({ type: 'none' })
    }

    setMenuOpen(true)
  }

  function handleGroupClick(event: MouseEvent, item: TreeGroupItem) {
    event.preventDefault()
    setSelection({ path: item.path, type: 'group' })
  }

  function handleTriggerClick(event: MouseEvent, item: TreeTriggerItem) {
    event.preventDefault()
    const anchorId = selection.type === 'triggers' ? selection.anchorId : null

    if (event.shiftKey && anchorId) {
      setSelection({
        anchorId,
        ids: selectTriggerRange(triggerOrder, anchorId, item.id),
        type: 'triggers',
      })
      return
    }

    if (event.ctrlKey || event.metaKey) {
      setSelection((previous) => {
        const nextSelection = new Set(
          previous.type === 'triggers' ? previous.ids : [],
        )

        if (nextSelection.has(item.id)) {
          nextSelection.delete(item.id)
        } else {
          nextSelection.add(item.id)
        }

        return nextSelection.size > 0
          ? {
              anchorId: item.id,
              ids: nextSelection,
              type: 'triggers',
            }
          : { type: 'none' }
      })
      return
    }

    setSelection({
      anchorId: item.id,
      ids: new Set([item.id]),
      type: 'triggers',
    })
  }

  function toggleGroup(item: TreeGroupItem) {
    toggleGroupCollapsed(item.id)
  }

  async function handleToggleTrigger(item: TreeTriggerItem, enabled: boolean) {
    if (!selectedCharacterRecord) {
      toast.error('Select a character before changing enablement.')
      return
    }

    await toggleTriggers([
      {
        character: selectedCharacterRecord,
        enabled,
        triggerId: item.id,
      },
    ])
  }

  async function handleToggleGroup(group: TreeGroupItem, enabled: boolean) {
    if (!selectedCharacterRecord) {
      toast.error('Select a character before changing enablement.')
      return
    }

    const triggerIds = getTriggerIdsUnderPath(triggers, group.path)
    if (triggerIds.length === 0) {
      return
    }

    await toggleTriggers(
      triggerIds.map((triggerId) => ({
        character: selectedCharacterRecord,
        enabled,
        triggerId,
      })),
    )
  }

  async function handleToggleTriggerPublish(
    item: TreeTriggerItem,
    publish: boolean,
  ) {
    if (!isAuthenticated) {
      toast.error('Log in to publish triggers.')
      return
    }

    await setTriggerFlags([
      {
        publish,
        triggerId: item.id,
      },
    ])
  }

  async function handleToggleTriggerBroadcastMode(
    item: TreeTriggerItem,
    broadcastMode: JenaBroadcastMode,
  ) {
    await setTriggerFlags([
      {
        broadcastMode,
        triggerId: item.id,
      },
    ])
  }

  async function handleToggleGroupPublish(
    group: TreeGroupItem,
    publish: boolean,
  ) {
    if (!isAuthenticated) {
      toast.error('Log in to publish triggers.')
      return
    }

    const triggerIds = getTriggerIdsUnderPath(triggers, group.path)
    if (triggerIds.length === 0) {
      return
    }

    await setTriggerFlags(
      triggerIds.map((triggerId) => ({
        publish,
        triggerId,
      })),
    )
  }

  async function handleToggleGroupBroadcastMode(
    group: TreeGroupItem,
    broadcastMode: JenaBroadcastMode,
  ) {
    const triggerIds = getTriggerIdsUnderPath(triggers, group.path)
    if (triggerIds.length === 0) {
      return
    }

    await setTriggerFlags(
      triggerIds.map((triggerId) => ({
        broadcastMode,
        triggerId,
      })),
    )
  }

  function handleAddRootGroup() {
    addGroup([])
  }

  function handleAddGroup(parentPath: string[]) {
    addGroup(parentPath)
  }

  function addGroup(parentPath: string[]) {
    const name = prompt('Group name')
    const normalizedName = name?.trim()

    if (!normalizedName) {
      return
    }

    const groupPath = [...parentPath, normalizedName]
    setEmptyGroups((previous) => mergeGroupPaths([...previous, groupPath]))
    setGroupCollapsed(getGroupId(parentPath), false)
  }

  function handleAddTrigger(groupPath: string[]) {
    setEditorSession({
      original: null,
      trigger: {
        ...createEmptyTrigger(),
        groupPath,
      },
    })
  }

  function handleEditTrigger(triggerId: JenaTriggerId) {
    const resolved = triggersById.get(triggerId)

    if (!resolved) {
      return
    }

    setEditorSession({
      original: resolved,
      trigger: cloneTrigger(resolved.trigger),
    })
  }

  async function handleRenameTrigger(triggerId: JenaTriggerId) {
    const resolved = triggersById.get(triggerId)

    if (!resolved) {
      return
    }

    const name = prompt('Trigger name', resolved.trigger.name)
    const normalizedName = name?.trim()

    if (!normalizedName || normalizedName === resolved.trigger.name) {
      return
    }

    const renamedTrigger = withCanonicalTriggerId({
      ...cloneTrigger(resolved.trigger),
      name: normalizedName,
    })

    await upsertTrigger(renamedTrigger, {
      deleteTriggerIds: [resolved.trigger.id],
      enabledFor: resolved.enabledFor,
    })
    setSelection({
      anchorId: renamedTrigger.id,
      ids: new Set([renamedTrigger.id]),
      type: 'triggers',
    })
  }

  async function handleSaveEditor(trigger: JenaTrigger) {
    const original = editorSession?.original ?? null
    const canonicalTrigger = withCanonicalTriggerId(trigger)
    const deleteTriggerIds =
      original && original.trigger.id !== canonicalTrigger.id
        ? [original.trigger.id]
        : undefined
    const enabledFor =
      original?.enabledFor ??
      (selectedCharacterRecord ? [selectedCharacterRecord] : [])

    await upsertTrigger(canonicalTrigger, {
      deleteTriggerIds,
      enabledFor,
    })
    setEditorSession(null)
    setSelection({
      anchorId: canonicalTrigger.id,
      ids: new Set([canonicalTrigger.id]),
      type: 'triggers',
    })
  }

  async function handleDeleteTriggerIds(triggerIds: JenaTriggerId[]) {
    if (triggerIds.length === 0) {
      return
    }

    const confirmed =
      triggerIds.length === 1 ||
      confirm(`Delete ${triggerIds.length} selected triggers?`)

    if (!confirmed) {
      return
    }

    await deleteTriggers(triggerIds)
    setSelection((previous) => {
      if (previous.type !== 'triggers') {
        return previous
      }

      const next = new Set(previous.ids)
      triggerIds.forEach((triggerId) => next.delete(triggerId))
      return next.size > 0
        ? {
            anchorId: getSelectionAnchor(next, previous.anchorId),
            ids: next,
            type: 'triggers',
          }
        : { type: 'none' }
    })
  }

  async function handleDeleteGroup(group: TreeGroupItem) {
    const affectedTriggerIds = getTriggerIdsUnderPath(triggers, group.path)
    const confirmed =
      affectedTriggerIds.length === 0 ||
      confirm(
        `Delete group "${group.name}" and ${affectedTriggerIds.length} triggers inside it?`,
      )

    if (!confirmed) {
      return
    }

    if (affectedTriggerIds.length > 0) {
      await deleteTriggers(affectedTriggerIds)
    }

    setEmptyGroups((previous) =>
      previous.filter((path) => !isSameOrChildPath(path, group.path)),
    )
    setSelection((previous) => {
      if (
        previous.type === 'group' &&
        isSameOrChildPath(previous.path, group.path)
      ) {
        return { type: 'none' }
      }

      if (previous.type !== 'triggers') {
        return previous
      }

      const next = new Set(previous.ids)
      affectedTriggerIds.forEach((triggerId) => next.delete(triggerId))
      return next.size > 0
        ? {
            anchorId: getSelectionAnchor(next, previous.anchorId),
            ids: next,
            type: 'triggers',
          }
        : { type: 'none' }
    })
  }

  async function handleRenameGroup(group: TreeGroupItem) {
    const name = prompt('Group name', group.name)
    const normalizedName = name?.trim()

    if (!normalizedName || normalizedName === group.name) {
      return
    }

    const renamedPath = [
      ...group.path.slice(0, group.path.length - 1),
      normalizedName,
    ]
    const affectedTriggers = getResolvedTriggersUnderPath(triggers, group.path)

    if (affectedTriggers.length === 0) {
      setEmptyGroups((previous) =>
        mergeGroupPaths(
          previous.map((path) => renamePathPrefix(path, group.path, renamedPath)),
        ),
      )
      setSelection({ path: renamedPath, type: 'group' })
      return
    }

    const replacements = affectedTriggers.map((resolved) =>
      createTriggerReplacement(resolved, {
        ...cloneTrigger(resolved.trigger),
        groupPath: renamePathPrefix(
          resolved.trigger.groupPath,
          group.path,
          renamedPath,
        ),
      }),
    )

    await performChunkedReplacements(
      `Rename ${group.name}`,
      replacements,
    )
    setEmptyGroups((previous) =>
      mergeGroupPaths(
        previous.map((path) => renamePathPrefix(path, group.path, renamedPath)),
      ),
    )
    setSelection({ path: renamedPath, type: 'group' })
  }

  async function handleMoveSelectedTriggers(targetPath: string[]) {
    if (selection.type !== 'triggers') {
      return
    }

    const triggerIds = [...selection.ids]
    const movingTriggers = triggerIds.flatMap((triggerId) => {
      const resolved = triggersById.get(triggerId)
      return resolved ? [resolved] : []
    })

    if (movingTriggers.length === 0) {
      return
    }

    const replacements = movingTriggers.map((resolved) =>
      createTriggerReplacement(resolved, {
        ...cloneTrigger(resolved.trigger),
        groupPath: targetPath,
      }),
    )

    const completedReplacements = await performChunkedReplacements(
      'Move selected triggers',
      replacements,
    )
    const movedTriggerIds = new Set(
      completedReplacements.map((replacement) => replacement.newTrigger.id),
    )
    setSelection({
      anchorId: getSelectionAnchor(movedTriggerIds, null),
      ids: movedTriggerIds,
      type: 'triggers',
    })
  }

  async function handleMoveSelectedGroup(targetParentPath: string[]) {
    if (selection.type !== 'group') {
      return
    }

    const sourcePath = selection.path
    const sourceName = sourcePath[sourcePath.length - 1]

    if (!sourceName || !canMoveGroup(sourcePath, targetParentPath)) {
      return
    }

    const movedPath = [
      ...targetParentPath,
      sourceName,
    ]
    const movingTriggers = getResolvedTriggersUnderPath(triggers, sourcePath)

    if (movingTriggers.length > 0) {
      const replacements = movingTriggers.map((resolved) =>
        createTriggerReplacement(resolved, {
          ...cloneTrigger(resolved.trigger),
          groupPath: renamePathPrefix(
            resolved.trigger.groupPath,
            sourcePath,
            movedPath,
          ),
        }),
      )

      await performChunkedReplacements(
        `Move ${sourceName}`,
        replacements,
      )
    }

    setEmptyGroups((previous) =>
      mergeGroupPaths(
        previous.map((path) => renamePathPrefix(path, sourcePath, movedPath)),
      ),
    )
    setGroupCollapsed(getGroupId(targetParentPath), false)
    setGroupCollapsed(getGroupId(movedPath), false)
    setSelection({ path: movedPath, type: 'group' })
  }

  async function performChunkedReplacements(
    title: string,
    replacements: TriggerReplacement[],
  ) {
    const chunks = chunkArray(replacements, triggerMutationChunkSize)

    setOperationSession({
      error: '',
      phase: 'running',
      processedBatches: 0,
      processedCount: 0,
      title,
      totalBatches: chunks.length,
      totalCount: replacements.length,
    })

    try {
      let processedCount = 0

      for (const [index, chunk] of chunks.entries()) {
        await upsertTriggers(chunk.map((replacement) => replacement.upsert))
        await deleteTriggers(chunk.map((replacement) => replacement.oldTriggerId))

        processedCount += chunk.length
        setOperationSession((current) =>
          current
            ? {
                ...current,
                processedBatches: index + 1,
                processedCount,
              }
            : current,
        )
        await yieldToEventLoop()
      }

      setOperationSession((current) =>
        current
          ? {
              ...current,
              phase: 'complete',
              processedBatches: chunks.length,
              processedCount: replacements.length,
            }
          : current,
      )
      setTimeout(() => setOperationSession(null), 500)

      return replacements
    } catch (error) {
      setOperationSession((current) =>
        current
          ? {
              ...current,
              error: getErrorMessage(error),
              phase: 'error',
            }
          : current,
      )
      throw error
    }
  }

  function handleImportClick() {
    fileInputRef.current?.click()
  }

  async function handleImportChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''

    if (!file) {
      return
    }

    try {
      setImportSession({
        elapsedMs: 0,
        error: '',
        estimatedMs: 0,
        fileName: file.name,
        importedCount: 0,
        phase: 'reading',
        processedBytes: 0,
        savedBatches: 0,
        savedCount: 0,
        totalBytes: file.size,
        totalBatches: 0,
        totalSaveCount: 0,
      })
      const importedTriggers = await parseGinaPackageFile(file, {
        onProgress: (processedBytes, totalBytes, elapsedMs, estimatedMs) => {
          setImportSession((current) =>
            current
              ? {
                  ...current,
                  elapsedMs,
                  estimatedMs,
                  processedBytes,
                  totalBytes,
                }
              : current,
          )
        },
      })
      const upserts = importedTriggers.map<JenaTriggerUpsert>((trigger) => ({
        enabledFor: selectedCharacterRecord ? [selectedCharacterRecord] : [],
        trigger,
      }))
      const upsertChunks = chunkArray(upserts, triggerMutationChunkSize)

      setImportSession((current) =>
        current
          ? {
              ...current,
              importedCount: importedTriggers.length,
              phase: 'saving',
              processedBytes: current.totalBytes,
              savedBatches: 0,
              savedCount: 0,
              totalBatches: upsertChunks.length,
              totalSaveCount: importedTriggers.length,
            }
          : current,
      )

      for (const [index, chunk] of upsertChunks.entries()) {
        await upsertTriggers(chunk)
        setImportSession((current) =>
          current
            ? {
                ...current,
                savedBatches: index + 1,
                savedCount: Math.min(
                  current.totalSaveCount,
                  current.savedCount + chunk.length,
                ),
              }
            : current,
        )
        await yieldToEventLoop()
      }

      setImportSession((current) =>
        current
          ? {
              ...current,
              importedCount: importedTriggers.length,
              phase: 'complete',
            }
          : current,
      )
      setTimeout(() => setImportSession(null), 500)
      toast.success(`Imported ${importedTriggers.length} triggers.`)
    } catch (error) {
      setImportSession((current) =>
        current
          ? {
              ...current,
              error: getErrorMessage(error),
              phase: 'error',
            }
          : {
              elapsedMs: 0,
              error: getErrorMessage(error),
              estimatedMs: 0,
              fileName: file.name,
              importedCount: 0,
              phase: 'error',
              processedBytes: 0,
              savedBatches: 0,
              savedCount: 0,
              totalBytes: file.size,
              totalBatches: 0,
              totalSaveCount: 0,
            },
      )
      toast.error(getErrorMessage(error))
    }
  }

  async function handleExportSelectedTriggers(triggerIds: JenaTriggerId[]) {
    const selectedTriggers = getTriggersByIdsInTreeOrder(
      treeItems,
      new Set(triggerIds),
    )

    if (selectedTriggers.length === 0) {
      toast.error('No triggers selected for export.')
      return
    }

    await exportTriggers(
      selectedTriggers.length === 1 ? 'Export Trigger' : 'Export Selected Triggers',
      selectedTriggers.length === 1
        ? `${sanitizeExportFileName(selectedTriggers[0].name || 'trigger')}.gtp`
        : 'jena-selected-triggers.gtp',
      selectedTriggers,
    )
  }

  async function handleExportGroup(group: TreeGroupItem) {
    const groupTriggers = getTriggersUnderPath(triggers, group.path)

    if (groupTriggers.length === 0) {
      toast.error('No triggers in this group.')
      return
    }

    await exportTriggers(
      `Export ${group.name}`,
      `${sanitizeExportFileName(group.name || 'group')}.gtp`,
      groupTriggers,
    )
  }

  async function handleExportSelectedGroup(path: string[]) {
    const groupName = path[path.length - 1] ?? 'group'
    const groupTriggers = getTriggersUnderPath(triggers, path)

    if (groupTriggers.length === 0) {
      toast.error('No triggers in the selected group.')
      return
    }

    await exportTriggers(
      `Export ${groupName}`,
      `${sanitizeExportFileName(groupName || 'group')}.gtp`,
      groupTriggers,
    )
  }

  async function handleShareTriggerIds(triggerIds: JenaTriggerId[]) {
    const uniqueTriggerIds = [...new Set(triggerIds)]

    if (uniqueTriggerIds.length === 0) {
      toast.error('No triggers selected for sharing.')
      return
    }

    const shareTriggers = uniqueTriggerIds.flatMap((triggerId) => {
      const resolved = triggersById.get(triggerId)

      return resolved ? [resolved.trigger] : []
    })

    if (shareTriggers.length === 0) {
      toast.error('No stored triggers selected for sharing.')
      return
    }

    try {
      const storedTriggers = await triggerStore.storeTriggers(shareTriggers)
      const response = await call('server.sharing', 'createSharePackage', {
        triggerIds: storedTriggers.map((trigger) => trigger.id),
      })

      try {
        await navigator.clipboard.writeText(response.code)
        toast.success(`${response.code} copied to clipboard.`)
      } catch (error) {
        console.warn('[UserTriggersEditor] failed to copy share code', error)
        toast.error(`Unable to copy share code: ${response.code}`)
      }
    } catch (error) {
      console.warn('[UserTriggersEditor] failed to create share package', error)
      toast.error(getErrorMessage(error))
    }
  }

  async function handleSharePublished() {
    try {
      const response = await call(
        'server.subscriptions',
        'getPublishedSubscriptionCode',
        {},
      )

      try {
        await navigator.clipboard.writeText(response.code)
        toast.success(`${response.code} copied to clipboard.`)
      } catch (error) {
        console.warn('[UserTriggersEditor] failed to copy subscription code', error)
        toast.error(`Unable to copy subscription code: ${response.code}`)
      }
    } catch (error) {
      console.warn('[UserTriggersEditor] failed to create subscription code', error)
      toast.error(getErrorMessage(error))
    }
  }

  async function handleRevokePublishedSubscription() {
    const confirmed = confirm(
      'This will invalidate your current subscriber link. Anyone following that link will stop receiving your published triggers. Continue?',
    )

    if (!confirmed) {
      return
    }

    try {
      await call(
        'server.subscriptions',
        'revokePublishedSubscriptionCode',
        {},
      )
      toast.success('Subscriber link revoked.')
    } catch (error) {
      console.warn('[UserTriggersEditor] failed to revoke subscription code', error)
      toast.error(getErrorMessage(error))
    }
  }

  async function exportTriggers(
    title: string,
    fileName: string,
    exportTriggers: JenaTrigger[],
  ) {
    if (exportTriggers.length === 0) {
      toast.error('No triggers selected for export.')
      return
    }

    try {
      setExportSession({
        elapsedMs: 0,
        error: '',
        estimatedMs: 0,
        fileName,
        phase: 'writing',
        processedBytes: 0,
        title,
        totalBytes: 0,
        triggerCount: exportTriggers.length,
      })

      const packageBytes = await exportGinaPackageFile(exportTriggers, {
        onProgress: (processedBytes, totalBytes, elapsedMs, estimatedMs) => {
          setExportSession((current) =>
            current
              ? {
                  ...current,
                  elapsedMs,
                  estimatedMs,
                  processedBytes,
                  totalBytes,
                }
              : current,
          )
        },
      })

      downloadBytes(packageBytes, fileName)
      setExportSession((current) =>
        current
          ? {
              ...current,
              phase: 'complete',
              processedBytes: current.totalBytes,
            }
          : current,
      )
      setTimeout(() => setExportSession(null), 500)
      toast.success(`Exported ${exportTriggers.length} triggers.`)
    } catch (error) {
      setExportSession((current) =>
        current
          ? {
              ...current,
              error: getErrorMessage(error),
              phase: 'error',
            }
          : {
              elapsedMs: 0,
              error: getErrorMessage(error),
              estimatedMs: 0,
              fileName,
              phase: 'error',
              processedBytes: 0,
              title,
              totalBytes: 0,
              triggerCount: exportTriggers.length,
            },
      )
      toast.error(getErrorMessage(error))
    }
  }

  const effectiveMenuSelection = getEffectiveMenuSelection(
    menuTarget.item,
    selection,
  )
  const menuGroup =
    menuTarget.item?.type === 'group' ? menuTarget.item : null
  const menuTrigger =
    menuTarget.item?.type === 'trigger' ? menuTarget.item : null
  const canMoveSelectedGroupHere =
    !!menuGroup && !!selectedGroupPath && canMoveGroup(selectedGroupPath, menuGroup.path)
  const selectedGroupExportCount = selectedGroupPath
    ? getTriggersUnderPath(triggers, selectedGroupPath).length
    : 0
  const menuGroupExportCount = menuGroup
    ? getTriggersUnderPath(triggers, menuGroup.path).length
    : 0

  return (
    <section
      aria-label="User triggers"
      className="user-triggers-editor"
      onContextMenu={(event) => openContextMenu(event, null)}
    >
      <header className="user-triggers-header">
        <h2>My Triggers</h2>
      </header>

      <div className="user-triggers-toolbar">
        <Button onClick={handleAddRootGroup} size="sm" variant="outline-secondary">
          add group
        </Button>
        <Button onClick={handleImportClick} size="sm" variant="outline-secondary">
          import GINA
        </Button>
        {isAuthenticated ? (
          <Dropdown as={ButtonGroup}>
            <Button
              onClick={() => {
                void handleSharePublished()
              }}
              size="sm"
              variant="outline-primary"
            >
              Share published
            </Button>
            <Dropdown.Toggle
              id="user-triggers-share-published-menu"
              size="sm"
              split
              variant="outline-primary"
            >
              <span className="visually-hidden">Subscription options</span>
            </Dropdown.Toggle>
            <Dropdown.Menu>
              <Dropdown.Item
                onClick={() => {
                  void handleRevokePublishedSubscription()
                }}
              >
                Revoke subscriber link...
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>
        ) : null}
        <input
          accept=".gtp"
          className="d-none"
          onChange={(event) => {
            void handleImportChange(event)
          }}
          ref={fileInputRef}
          type="file"
        />
      </div>

      <div className="user-triggers-tree" role="tree">
        {treeItems.length > 0 ? (
          treeItems.map((item) =>
            item.type === 'group' ? (
              <GroupRow
                collapsed={collapsedGroupIds.has(item.id)}
                checkboxState={
                  groupStatesById.get(item.id)?.state ?? 'disabled'
                }
                checkboxDisabled={
                  !selectedCharacterRecord ||
                  (groupStatesById.get(item.id)?.totalCount ?? 0) === 0
                }
                broadcastDisabled={
                  (groupStatesById.get(item.id)?.totalCount ?? 0) === 0
                }
                broadcastState={
                  groupStatesById.get(item.id)?.broadcastState ?? 'private'
                }
                item={item}
                key={item.id}
                onAddGroup={handleAddGroup}
                onAddTrigger={handleAddTrigger}
                onContextMenu={openContextMenu}
                onSelect={handleGroupClick}
                onToggleBroadcastMode={(broadcastMode) => {
                  void handleToggleGroupBroadcastMode(item, broadcastMode)
                }}
                onToggleChecked={(enabled) => {
                  void handleToggleGroup(item, enabled)
                }}
                onTogglePublish={(publish) => {
                  void handleToggleGroupPublish(item, publish)
                }}
                onToggle={toggleGroup}
                publishDisabled={
                  !isAuthenticated ||
                  (groupStatesById.get(item.id)?.totalCount ?? 0) === 0
                }
                publishState={
                  groupStatesById.get(item.id)?.publishState ?? 'unchecked'
                }
                selected={
                  !!selectedGroupPath &&
                  areStringArraysEqual(selectedGroupPath, item.path)
                }
                showEnableColumn={showEnableColumn}
              />
            ) : (
              <TriggerRow
                checkboxDisabled={!selectedCharacterRecord}
                checkboxState={getTriggerCheckboxState(
                  item.resolved,
                  selectedCharacterKey,
                )}
                item={item}
                key={item.id}
                onBroadcastModeToggle={(broadcastMode) => {
                  void handleToggleTriggerBroadcastMode(item, broadcastMode)
                }}
                onClick={handleTriggerClick}
                onContextMenu={openContextMenu}
                onDoubleClick={(triggerItem) => {
                  handleEditTrigger(triggerItem.id)
                }}
                onPublishToggle={(publish) => {
                  void handleToggleTriggerPublish(item, publish)
                }}
                onToggle={(enabled) => {
                  void handleToggleTrigger(item, enabled)
                }}
                publishDisabled={!isAuthenticated}
                selected={selectedTriggerIds.has(item.id)}
                showEnableColumn={showEnableColumn}
              />
            ),
          )
        ) : (
          <div className="user-triggers-empty">No triggers loaded</div>
        )}
      </div>

      <div className="user-triggers-status">
        {getImportStatus(importSession) ||
          `${triggers.length} trigger${triggers.length === 1 ? '' : 's'}`}
      </div>

      <ControlledMenu
        anchorPoint={anchorPoint}
        endTransition={endTransition}
        onClose={() => setMenuOpen(false)}
        state={menuState}
      >
        {menuTrigger ? (
          <>
            <MenuItem
              disabled={effectiveMenuSelection.length !== 1}
              onClick={() => handleEditTrigger(effectiveMenuSelection[0])}
            >
              Edit...
            </MenuItem>
            <MenuItem
              disabled={effectiveMenuSelection.length !== 1}
              onClick={() => {
                void handleRenameTrigger(effectiveMenuSelection[0]).catch(
                  (error: unknown) => {
                    toast.error(getErrorMessage(error))
                  },
                )
              }}
            >
              Rename...
            </MenuItem>
            <MenuItem
              disabled={effectiveMenuSelection.length === 0}
              onClick={() => {
                void handleExportSelectedTriggers(effectiveMenuSelection)
              }}
            >
              {effectiveMenuSelection.length > 1
                ? 'Export selected triggers...'
                : 'Export trigger...'}
            </MenuItem>
            <MenuItem
              disabled={effectiveMenuSelection.length === 0}
              onClick={() => {
                void handleShareTriggerIds(effectiveMenuSelection)
              }}
            >
              {effectiveMenuSelection.length > 1
                ? 'Share selected triggers'
                : 'Share trigger'}
            </MenuItem>
          </>
        ) : null}
        {menuGroup ? (
          <>
            <MenuItem
              onClick={() => {
                void handleRenameGroup(menuGroup).catch((error: unknown) => {
                  toast.error(getErrorMessage(error))
                })
              }}
            >
              Rename group...
            </MenuItem>
            <MenuItem onClick={() => handleAddGroup(menuGroup.path)}>
              Add subgroup...
            </MenuItem>
            <MenuItem onClick={() => handleAddTrigger(menuGroup.path)}>
              Add trigger...
            </MenuItem>
            <MenuItem
              disabled={menuGroupExportCount === 0}
              onClick={() => {
                void handleExportGroup(menuGroup)
              }}
            >
              Export this group...
            </MenuItem>
            <MenuItem
              disabled={menuGroupExportCount === 0}
              onClick={() => {
                void handleShareTriggerIds(getTriggerIdsUnderPath(triggers, menuGroup.path))
              }}
            >
              Share this group
            </MenuItem>
            {selectedGroupPath &&
            !areStringArraysEqual(selectedGroupPath, menuGroup.path) ? (
              <>
                <MenuItem
                  disabled={selectedGroupExportCount === 0}
                  onClick={() => {
                    void handleExportSelectedGroup(selectedGroupPath)
                  }}
                >
                  Export selected group...
                </MenuItem>
                <MenuItem
                  disabled={selectedGroupExportCount === 0}
                  onClick={() => {
                    void handleShareTriggerIds(
                      getTriggerIdsUnderPath(triggers, selectedGroupPath),
                    )
                  }}
                >
                  Share selected group
                </MenuItem>
              </>
            ) : null}
            <MenuItem
              disabled={
                selectedGroupPath
                  ? !canMoveSelectedGroupHere
                  : selectedTriggerIds.size === 0
              }
              onClick={() => {
                if (selectedGroupPath) {
                  void handleMoveSelectedGroup(menuGroup.path)
                } else {
                  void handleMoveSelectedTriggers(menuGroup.path)
                }
              }}
            >
              {selectedGroupPath
                ? 'Move selected group here...'
                : 'Move selected triggers here...'}
            </MenuItem>
          </>
        ) : null}
        {!menuGroup && !menuTrigger ? (
          <>
            <MenuItem onClick={handleAddRootGroup}>Add group...</MenuItem>
            <MenuItem onClick={handleImportClick}>Import GINA...</MenuItem>
            {selection.type === 'triggers' ? (
              <>
                <MenuItem
                  disabled={selection.ids.size === 0}
                  onClick={() => {
                    void handleExportSelectedTriggers([...selection.ids])
                  }}
                >
                  Export selected triggers...
                </MenuItem>
                <MenuItem
                  disabled={selection.ids.size === 0}
                  onClick={() => {
                    void handleShareTriggerIds([...selection.ids])
                  }}
                >
                  Share selected triggers
                </MenuItem>
              </>
            ) : null}
            {selectedGroupPath ? (
              <>
                <MenuItem
                  disabled={selectedGroupExportCount === 0}
                  onClick={() => {
                    void handleExportSelectedGroup(selectedGroupPath)
                  }}
                >
                  Export selected group...
                </MenuItem>
                <MenuItem
                  disabled={selectedGroupExportCount === 0}
                  onClick={() => {
                    void handleShareTriggerIds(
                      getTriggerIdsUnderPath(triggers, selectedGroupPath),
                    )
                  }}
                >
                  Share selected group
                </MenuItem>
              </>
            ) : null}
          </>
        ) : null}
        <MenuDivider />
        {menuGroup ? (
          <MenuItem
            onClick={() => {
              void handleDeleteGroup(menuGroup)
            }}
          >
            Delete...
          </MenuItem>
        ) : (
          <MenuItem
            disabled={effectiveMenuSelection.length === 0}
            onClick={() => {
              void handleDeleteTriggerIds(effectiveMenuSelection)
            }}
          >
            Delete...
          </MenuItem>
        )}
      </ControlledMenu>

      {editorSession ? (
        <TriggerEditorDialog
          setShown={(shown) => {
            if (!shown) {
              setEditorSession(null)
            }
          }}
          setTrigger={(trigger) => {
            void handleSaveEditor(trigger).catch((error: unknown) => {
              toast.error(getErrorMessage(error))
            })
          }}
          shown={true}
          trigger={editorSession.trigger}
        />
      ) : null}

      <ImportProgressDialog
        session={importSession}
        setSession={setImportSession}
      />
      <ExportProgressDialog
        session={exportSession}
        setSession={setExportSession}
      />
      <OperationProgressDialog
        session={operationSession}
        setSession={setOperationSession}
      />
    </section>
  )
}

function ImportProgressDialog({
  session,
  setSession,
}: {
  session: ImportSession | null
  setSession: (session: ImportSession | null) => void
}) {
  const isBusy = session?.phase === 'reading' || session?.phase === 'saving'
  const progressPercent = session
    ? getImportProgressPercent(session)
    : 0

  return (
    <Modal
      backdrop={isBusy ? 'static' : true}
      centered
      keyboard={!isBusy}
      onHide={() => {
        if (!isBusy) {
          setSession(null)
        }
      }}
      show={!!session}
    >
      <Modal.Header closeButton={session?.phase === 'error'}>
        <Modal.Title>Import GINA Package</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {session ? (
          <div className="user-triggers-import-dialog">
            <div>
              <div className="user-triggers-import-file">{session.fileName}</div>
              <div className="user-triggers-import-status">
                {getImportStatus(session)}
              </div>
            </div>
            <ProgressBar
              animated={isBusy}
              now={progressPercent}
              striped={isBusy}
              variant={session.phase === 'error' ? 'danger' : 'success'}
            />
            <div className="user-triggers-import-metrics">
              {session.phase === 'saving' || session.phase === 'complete' ? (
                <>
                  <span>
                    {session.savedCount} / {session.totalSaveCount} triggers
                  </span>
                  <span>
                    batch {session.savedBatches} / {session.totalBatches}
                  </span>
                </>
              ) : (
                <span>
                  {formatBytes(session.processedBytes)} / {formatBytes(session.totalBytes)}
                </span>
              )}
              <span>elapsed {formatDuration(session.elapsedMs)}</span>
              {session.phase === 'reading' ? (
                <span>remaining {formatDuration(session.estimatedMs)}</span>
              ) : null}
            </div>
            {session.phase === 'error' ? (
              <Alert className="mb-0 py-2" variant="danger">
                {session.error}
              </Alert>
            ) : null}
          </div>
        ) : null}
      </Modal.Body>
    </Modal>
  )
}

function ExportProgressDialog({
  session,
  setSession,
}: {
  session: ExportSession | null
  setSession: (session: ExportSession | null) => void
}) {
  const isBusy = session?.phase === 'writing'
  const progressPercent = session
    ? getExportProgressPercent(session)
    : 0

  return (
    <Modal
      backdrop={isBusy ? 'static' : true}
      centered
      keyboard={!isBusy}
      onHide={() => {
        if (!isBusy) {
          setSession(null)
        }
      }}
      show={!!session}
    >
      <Modal.Header closeButton={session?.phase === 'error'}>
        <Modal.Title>{session?.title ?? 'Export GINA Package'}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {session ? (
          <div className="user-triggers-import-dialog">
            <div>
              <div className="user-triggers-import-file">{session.fileName}</div>
              <div className="user-triggers-import-status">
                {getExportStatus(session)}
              </div>
            </div>
            <ProgressBar
              animated={isBusy}
              now={progressPercent}
              striped={isBusy}
              variant={session.phase === 'error' ? 'danger' : 'success'}
            />
            <div className="user-triggers-import-metrics">
              <span>
                {formatBytes(session.processedBytes)} / {formatBytes(session.totalBytes)}
              </span>
              <span>{session.triggerCount} triggers</span>
              <span>elapsed {formatDuration(session.elapsedMs)}</span>
              {session.phase === 'writing' ? (
                <span>remaining {formatDuration(session.estimatedMs)}</span>
              ) : null}
            </div>
            {session.phase === 'error' ? (
              <Alert className="mb-0 py-2" variant="danger">
                {session.error}
              </Alert>
            ) : null}
          </div>
        ) : null}
      </Modal.Body>
    </Modal>
  )
}

function OperationProgressDialog({
  session,
  setSession,
}: {
  session: OperationSession | null
  setSession: (session: OperationSession | null) => void
}) {
  const isBusy = session?.phase === 'running'
  const progressPercent = session
    ? getOperationProgressPercent(session)
    : 0

  return (
    <Modal
      backdrop={isBusy ? 'static' : true}
      centered
      keyboard={!isBusy}
      onHide={() => {
        if (!isBusy) {
          setSession(null)
        }
      }}
      show={!!session}
    >
      <Modal.Header closeButton={session?.phase === 'error'}>
        <Modal.Title>{session?.title ?? 'Update Triggers'}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {session ? (
          <div className="user-triggers-import-dialog">
            <div>
              <div className="user-triggers-import-file">
                {getOperationStatus(session)}
              </div>
              <div className="user-triggers-import-status">
                {session.processedCount} / {session.totalCount} triggers
              </div>
            </div>
            <ProgressBar
              animated={isBusy}
              now={progressPercent}
              striped={isBusy}
              variant={session.phase === 'error' ? 'danger' : 'success'}
            />
            <div className="user-triggers-import-metrics">
              <span>
                batch {session.processedBatches} / {session.totalBatches}
              </span>
              <span>{progressPercent}%</span>
            </div>
            {session.phase === 'error' ? (
              <Alert className="mb-0 py-2" variant="danger">
                {session.error}
              </Alert>
            ) : null}
          </div>
        ) : null}
      </Modal.Body>
    </Modal>
  )
}

function GroupRow({
  broadcastDisabled,
  broadcastState,
  checkboxDisabled,
  checkboxState,
  collapsed,
  item,
  onAddGroup,
  onAddTrigger,
  onContextMenu,
  onSelect,
  onToggleBroadcastMode,
  onToggle,
  onToggleChecked,
  onTogglePublish,
  publishDisabled,
  publishState,
  selected,
  showEnableColumn,
}: {
  broadcastDisabled: boolean
  broadcastState: BroadcastModeState
  checkboxDisabled: boolean
  checkboxState: UserTriggerCheckboxState
  collapsed: boolean
  item: TreeGroupItem
  onAddGroup: (path: string[]) => void
  onAddTrigger: (path: string[]) => void
  onContextMenu: (event: MouseEvent, item: TreeItem) => void
  onSelect: (event: MouseEvent, item: TreeGroupItem) => void
  onToggleBroadcastMode: (broadcastMode: JenaBroadcastMode) => void
  onToggle: (item: TreeGroupItem) => void
  onToggleChecked: (enabled: boolean) => void
  onTogglePublish: (publish: boolean) => void
  publishDisabled: boolean
  publishState: IconTriStateToggleState
  selected: boolean
  showEnableColumn: boolean
}) {
  return (
    <div
      aria-expanded={!collapsed}
      aria-selected={selected}
      className={
        selected
          ? 'user-triggers-row user-triggers-row-selected'
          : 'user-triggers-row'
      }
      onClick={(event) => onSelect(event, item)}
      onContextMenu={(event) => {
        event.stopPropagation()
        onContextMenu(event, item)
      }}
      onDoubleClick={() => onToggle(item)}
      role="treeitem"
      tabIndex={0}
    >
      <span className="user-triggers-row-main">
        <span
          className="user-triggers-indent"
          style={{ width: `${Math.max(0, item.path.length - 1) * 1.15}rem` }}
        />
        <button
          aria-label={collapsed ? `Expand ${item.name}` : `Collapse ${item.name}`}
          className="user-triggers-caret"
          disabled={item.childCount === 0}
          onClick={(event) => {
            event.stopPropagation()
            onToggle(item)
          }}
          type="button"
        >
          {item.childCount > 0 ? (collapsed ? '>' : 'v') : ''}
        </button>
        {showEnableColumn ? (
          <FourStateCheckbox
            ariaLabel={`Enable triggers in ${item.name}`}
            className="user-triggers-checkbox"
            disabled={checkboxDisabled}
            mode={TERNARY}
            onChange={(state) => onToggleChecked(state === 'enabled')}
            state={checkboxState}
          />
        ) : null}
        <span className="user-triggers-group-name">{item.name}</span>
      </span>
      <span className="user-triggers-row-side">
        <span className="user-triggers-row-flags">
          <IconTriStateToggle
            checkedIcon={Globe}
            disabled={publishDisabled}
            label={publishDisabled ? 'Log in to publish' : 'Publish'}
            mixedLabel="Publish"
            onToggle={onTogglePublish}
            state={publishState}
            uncheckedIcon={GlobeOff}
          />
          <BroadcastModeToggle
            disabled={broadcastDisabled}
            mode={broadcastState}
            onToggle={onToggleBroadcastMode}
          />
        </span>
        <span className="user-triggers-row-actions">
          <Button
            aria-label={`Add subgroup to ${item.name}`}
            onClick={(event) => {
              event.stopPropagation()
              onAddGroup(item.path)
            }}
            size="sm"
            title="Add subgroup"
            variant="outline-secondary"
          >
            <FolderPlus aria-hidden="true" size={15} />
          </Button>
          <Button
            aria-label={`Add trigger to ${item.name}`}
            onClick={(event) => {
              event.stopPropagation()
              onAddTrigger(item.path)
            }}
            size="sm"
            title="Add trigger"
            variant="outline-secondary"
          >
            <ListPlus aria-hidden="true" size={15} />
          </Button>
        </span>
      </span>
    </div>
  )
}

function TriggerRow({
  checkboxDisabled,
  checkboxState,
  item,
  onBroadcastModeToggle,
  onClick,
  onContextMenu,
  onDoubleClick,
  onPublishToggle,
  onToggle,
  publishDisabled,
  selected,
  showEnableColumn,
}: {
  checkboxDisabled: boolean
  checkboxState: FourStateCheckboxState
  item: TreeTriggerItem
  onBroadcastModeToggle: (broadcastMode: JenaBroadcastMode) => void
  onClick: (event: MouseEvent, item: TreeTriggerItem) => void
  onContextMenu: (event: MouseEvent, item: TreeItem) => void
  onDoubleClick: (item: TreeTriggerItem) => void
  onPublishToggle: (publish: boolean) => void
  onToggle: (enabled: boolean) => void
  publishDisabled: boolean
  selected: boolean
  showEnableColumn: boolean
}) {
  return (
    <div
      aria-selected={selected}
      className={
        selected
          ? 'user-triggers-row user-triggers-row-selected'
          : 'user-triggers-row'
      }
      onClick={(event) => onClick(event, item)}
      onContextMenu={(event) => {
        event.stopPropagation()
        onContextMenu(event, item)
      }}
      onDoubleClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onDoubleClick(item)
      }}
      role="treeitem"
      tabIndex={0}
    >
      <span className="user-triggers-row-main">
        <span
          className="user-triggers-indent"
          style={{ width: `${item.path.length * 1.15}rem` }}
        />
        {showEnableColumn ? (
          <FourStateCheckbox
            ariaLabel={`Enable ${item.resolved.trigger.name || 'unnamed trigger'}`}
            className="user-triggers-checkbox"
            disabled={checkboxDisabled}
            mode={TERNARY}
            onChange={(state) => onToggle(state === 'enabled')}
            state={checkboxState}
          />
        ) : null}
        <span className="user-triggers-trigger-name">
          {item.resolved.trigger.name || '(unnamed trigger)'}
        </span>
      </span>
      <span className="user-triggers-row-side">
        <span className="user-triggers-row-flags">
          <IconTriStateToggle
            checkedIcon={Globe}
            disabled={publishDisabled}
            label={publishDisabled ? 'Log in to publish' : 'Publish'}
            onToggle={onPublishToggle}
            state={item.resolved.publish ? 'checked' : 'unchecked'}
            uncheckedIcon={GlobeOff}
          />
          <BroadcastModeToggle
            mode={item.resolved.broadcastMode}
            onToggle={onBroadcastModeToggle}
          />
        </span>
      </span>
    </div>
  )
}

function BroadcastModeToggle({
  disabled = false,
  mode,
  onToggle,
}: {
  disabled?: boolean
  mode: BroadcastModeState
  onToggle: (broadcastMode: JenaBroadcastMode) => void
}) {
  const Icon = mode === 'private' ? RadioOff : Radio
  const label =
    mode === 'mixed' ? 'Mixed broadcast modes' : getBroadcastModeLabel(mode)

  return (
    <button
      aria-label={label}
      className="icon-tri-state-toggle user-triggers-broadcast-toggle"
      data-state={mode}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onToggle(getNextBroadcastMode(mode))
      }}
      title={label}
      type="button"
    >
      <Icon aria-hidden="true" size={15} strokeWidth={2} />
      {mode === 'boxes' ? (
        <span className="icon-tri-state-toggle-badge user-triggers-broadcast-mode-badge">
          <span className="user-triggers-broadcast-mode-half-circle" />
        </span>
      ) : null}
      {mode === 'mixed' ? (
        <span className="icon-tri-state-toggle-badge user-triggers-broadcast-mode-badge">
          <span className="user-triggers-broadcast-mode-mixed-mark" />
        </span>
      ) : null}
    </button>
  )
}

function buildVisibleTreeItems(
  triggers: JenaResolvedTrigger[],
  emptyGroups: string[][],
  collapsedGroups: Set<string>,
) {
  const groups = new Map<string, TreeGroupItem>()
  const triggersByParent = new Map<string, TreeTriggerItem[]>()

  function ensureGroup(path: string[]) {
    path.forEach((_, index) => {
      const groupPath = path.slice(0, index + 1)
      const id = getGroupId(groupPath)

      if (!groups.has(id)) {
        groups.set(id, {
          childCount: 0,
          id,
          name: groupPath[groupPath.length - 1],
          path: groupPath,
          triggerCount: 0,
          type: 'group',
        })
      }
    })
  }

  emptyGroups.forEach(ensureGroup)
  triggers.forEach((resolved) => {
    ensureGroup(resolved.trigger.groupPath)

    const parentId = getGroupId(resolved.trigger.groupPath)
    const siblings = triggersByParent.get(parentId) ?? []
    siblings.push({
      id: resolved.trigger.id,
      path: resolved.trigger.groupPath,
      resolved,
      type: 'trigger',
    })
    triggersByParent.set(parentId, siblings)
  })

  groups.forEach((group) => {
    group.childCount = countChildren(groups, triggersByParent, group.path)
    group.triggerCount = getTriggerIdsUnderPath(triggers, group.path).length
  })

  triggersByParent.forEach((siblings) => {
    siblings.sort(compareTriggerItems)
  })

  return flattenGroups(groups, triggersByParent, collapsedGroups, [])
}

function getGroupIds(
  triggers: JenaResolvedTrigger[],
  emptyGroups: string[][],
) {
  const groupIds = new Set<string>()

  function addGroupPath(path: string[]) {
    path.forEach((_, index) => {
      groupIds.add(getGroupId(path.slice(0, index + 1)))
    })
  }

  emptyGroups.forEach(addGroupPath)
  triggers.forEach((resolved) => addGroupPath(resolved.trigger.groupPath))

  return [...groupIds].sort()
}

function flattenGroups(
  groups: Map<string, TreeGroupItem>,
  triggersByParent: Map<string, TreeTriggerItem[]>,
  collapsedGroups: Set<string>,
  parentPath: string[],
) {
  const parentId = getGroupId(parentPath)
  const items: TreeItem[] = []
  const childGroups = [...groups.values()]
    .filter((group) => isDirectChildPath(group.path, parentPath))
    .sort(compareGroupItems)

  childGroups.forEach((group) => {
    items.push(group)

    if (!collapsedGroups.has(group.id)) {
      items.push(...flattenGroups(groups, triggersByParent, collapsedGroups, group.path))
    }
  })

  items.push(...(triggersByParent.get(parentId) ?? []))

  return items
}

function countChildren(
  groups: Map<string, TreeGroupItem>,
  triggersByParent: Map<string, TreeTriggerItem[]>,
  path: string[],
) {
  const directGroups = [...groups.values()].filter((group) =>
    isDirectChildPath(group.path, path),
  ).length
  const directTriggers = triggersByParent.get(getGroupId(path))?.length ?? 0

  return directGroups + directTriggers
}

function compareGroupItems(left: TreeGroupItem, right: TreeGroupItem) {
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
}

function compareTriggerItems(left: TreeTriggerItem, right: TreeTriggerItem) {
  return left.resolved.trigger.name.localeCompare(
    right.resolved.trigger.name,
    undefined,
    { sensitivity: 'base' },
  )
}

function getTriggerIdsUnderPath(
  triggers: JenaResolvedTrigger[],
  path: string[],
) {
  return triggers.flatMap((resolved) => {
    return isSameOrChildPath(resolved.trigger.groupPath, path)
      ? [resolved.trigger.id]
      : []
  })
}

function getResolvedTriggersUnderPath(
  triggers: JenaResolvedTrigger[],
  path: string[],
) {
  return triggers.filter((resolved) =>
    isSameOrChildPath(resolved.trigger.groupPath, path),
  )
}

function getTriggersByIdsInTreeOrder(
  treeItems: TreeItem[],
  triggerIds: Set<JenaTriggerId>,
) {
  const seenTriggerIds = new Set<JenaTriggerId>()
  const selectedTriggers: JenaTrigger[] = []

  treeItems.forEach((item) => {
    if (
      item.type === 'trigger' &&
      triggerIds.has(item.id) &&
      !seenTriggerIds.has(item.id)
    ) {
      seenTriggerIds.add(item.id)
      selectedTriggers.push(item.resolved.trigger)
    }
  })

  return selectedTriggers
}

function getTriggersUnderPath(
  triggers: JenaResolvedTrigger[],
  groupPath: string[],
) {
  const seenTriggerIds = new Set<JenaTriggerId>()
  const selectedTriggers: JenaTrigger[] = []

  getResolvedTriggersUnderPath(triggers, groupPath)
    .sort(compareResolvedTriggersByPath)
    .forEach((resolved) => {
      if (seenTriggerIds.has(resolved.trigger.id)) {
        return
      }

      seenTriggerIds.add(resolved.trigger.id)
      selectedTriggers.push(resolved.trigger)
    })

  return selectedTriggers
}

function compareResolvedTriggersByPath(
  left: JenaResolvedTrigger,
  right: JenaResolvedTrigger,
) {
  const pathComparison = left.trigger.groupPath
    .join('\0')
    .localeCompare(right.trigger.groupPath.join('\0'), undefined, {
      sensitivity: 'base',
    })

  if (pathComparison !== 0) {
    return pathComparison
  }

  return left.trigger.name.localeCompare(right.trigger.name, undefined, {
    sensitivity: 'base',
  })
}

function getGroupStatesById(
  triggers: JenaResolvedTrigger[],
  selectedCharacterKey: string | null,
) {
  const groupStates = new Map<
    string,
    {
      broadcastState: BroadcastModeState
      enabledCount: number
      publishCount: number
      publishState: IconTriStateToggleState
      state: UserTriggerCheckboxState
      totalCount: number
    }
  >()
  const groupPathsById = new Map<string, string[]>()

  triggers.forEach((resolved) => {
    resolved.trigger.groupPath.forEach((_, index) => {
      const groupPath = resolved.trigger.groupPath.slice(0, index + 1)
      groupPathsById.set(getGroupId(groupPath), groupPath)
    })
  })

  groupPathsById.forEach((groupPath, groupId) => {
    const descendantTriggers = triggers.filter((resolved) =>
      isSameOrChildPath(resolved.trigger.groupPath, groupPath),
    )
    const enabledCount = selectedCharacterKey
      ? descendantTriggers.filter((resolved) =>
          resolved.enabledFor.some(
            (character) =>
              getJenaCharacterServerKey(character) === selectedCharacterKey,
          ),
        ).length
      : 0
    const publishCount = descendantTriggers.filter((resolved) => resolved.publish).length
    const broadcastState = getBroadcastModeState(descendantTriggers)

    groupStates.set(groupId, {
      broadcastState,
      enabledCount,
      publishCount,
      publishState: getIconTriState(publishCount, descendantTriggers.length),
      state: getUserTriggerCheckboxState(enabledCount, descendantTriggers.length),
      totalCount: descendantTriggers.length,
    })
  })

  return groupStates
}

function getTriggerCheckboxState(
  resolved: JenaResolvedTrigger,
  selectedCharacterKey: string | null,
): UserTriggerCheckboxState {
  if (
    selectedCharacterKey &&
    resolved.enabledFor.some(
      (character) => getJenaCharacterServerKey(character) === selectedCharacterKey,
    )
  ) {
    return 'enabled'
  }

  return 'disabled'
}

function getBroadcastModeState(
  triggers: JenaResolvedTrigger[],
): BroadcastModeState {
  if (triggers.length === 0) {
    return 'private'
  }

  const firstMode = triggers[0]?.broadcastMode ?? 'private'
  if (
    triggers.every(
      (trigger) => trigger.broadcastMode === firstMode,
    )
  ) {
    return firstMode
  }

  return 'mixed'
}

function getNextBroadcastMode(mode: BroadcastModeState): JenaBroadcastMode {
  switch (mode) {
    case 'mixed':
      return 'private'
    case 'private':
      return 'boxes'
    case 'boxes':
      return 'subscribers'
    case 'subscribers':
      return 'private'
  }
}

function getBroadcastModeLabel(mode: JenaBroadcastMode) {
  switch (mode) {
    case 'private':
      return 'Private'
    case 'boxes':
      return 'My boxes'
    case 'subscribers':
      return 'My subscribers'
  }
}

function getUserTriggerCheckboxState(
  enabledCount: number,
  totalCount: number,
): UserTriggerCheckboxState {
  if (totalCount > 0 && enabledCount === totalCount) {
    return 'enabled'
  }

  if (enabledCount > 0) {
    return 'mixed'
  }

  return 'disabled'
}

function getIconTriState(
  enabledCount: number,
  totalCount: number,
): IconTriStateToggleState {
  if (totalCount > 0 && enabledCount === totalCount) {
    return 'checked'
  }

  if (enabledCount > 0) {
    return 'mixed'
  }

  return 'unchecked'
}

function selectTriggerRange(
  triggerOrder: JenaTriggerId[],
  anchorId: JenaTriggerId,
  targetId: JenaTriggerId,
) {
  const anchorIndex = triggerOrder.indexOf(anchorId)
  const targetIndex = triggerOrder.indexOf(targetId)

  if (anchorIndex < 0 || targetIndex < 0) {
    return new Set([targetId])
  }

  const start = Math.min(anchorIndex, targetIndex)
  const end = Math.max(anchorIndex, targetIndex)

  return new Set(triggerOrder.slice(start, end + 1))
}

function getEffectiveMenuSelection(
  item: TreeItem | null,
  selection: TreeSelection,
) {
  if (
    item?.type === 'trigger' &&
    (selection.type !== 'triggers' || !selection.ids.has(item.id))
  ) {
    return [item.id]
  }

  return selection.type === 'triggers' ? [...selection.ids] : []
}

function getSelectionAnchor(
  ids: Set<JenaTriggerId>,
  preferred: JenaTriggerId | null,
) {
  if (preferred && ids.has(preferred)) {
    return preferred
  }

  return [...ids][0] ?? null
}

function mergeGroupPaths(paths: string[][]) {
  return [
    ...new Map(
      paths
        .filter((path) => path.length > 0)
        .map((path) => [getGroupId(path), path]),
    ).values(),
  ].sort(comparePaths)
}

function comparePaths(left: string[], right: string[]) {
  return left.join('\0').localeCompare(right.join('\0'), undefined, {
    sensitivity: 'base',
  })
}

function isDirectChildPath(path: string[], parentPath: string[]) {
  return (
    path.length === parentPath.length + 1 &&
    parentPath.every((part, index) => path[index] === part)
  )
}

function isSameOrChildPath(path: string[], parentPath: string[]) {
  return (
    path.length >= parentPath.length &&
    parentPath.every((part, index) => path[index] === part)
  )
}

function canMoveGroup(sourcePath: string[], targetParentPath: string[]) {
  const sourceParentPath = sourcePath.slice(0, -1)

  return (
    sourcePath.length > 0 &&
    !areStringArraysEqual(sourceParentPath, targetParentPath) &&
    !isSameOrChildPath(targetParentPath, sourcePath)
  )
}

function renamePathPrefix(
  path: string[],
  oldPrefix: string[],
  newPrefix: string[],
) {
  if (!isSameOrChildPath(path, oldPrefix)) {
    return path
  }

  return [...newPrefix, ...path.slice(oldPrefix.length)]
}

function getGroupId(path: string[]) {
  return path.join('\0')
}

function areStringArraysEqual(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function toCharacterServer(character: CharacterPresence): JenaCharacterServer {
  return {
    characterName: character.characterName,
    serverName: character.serverName,
  }
}

function cloneTrigger(trigger: JenaTrigger): JenaTrigger {
  return structuredClone(trigger)
}

function createTriggerReplacement(
  resolved: JenaResolvedTrigger,
  nextTrigger: JenaTrigger,
): TriggerReplacement {
  const newTrigger = withCanonicalTriggerId(nextTrigger)

  return {
    newTrigger,
    oldTriggerId: resolved.trigger.id,
    upsert: {
      enabledFor: resolved.enabledFor,
      trigger: newTrigger,
    },
  }
}

function getImportStatus(session: ImportSession | null) {
  if (!session) {
    return ''
  }

  switch (session.phase) {
    case 'reading':
      return `Reading package ${getImportProgressPercent(session)}%`
    case 'saving':
      return `Saving triggers ${session.savedBatches} / ${session.totalBatches} batches`
    case 'complete':
      return `Imported ${session.importedCount} triggers`
    case 'error':
      return 'Import failed'
  }
}

function getOperationStatus(session: OperationSession) {
  switch (session.phase) {
    case 'running':
      return 'Updating triggers'
    case 'complete':
      return 'Update complete'
    case 'error':
      return 'Update failed'
  }
}

function getExportStatus(session: ExportSession) {
  switch (session.phase) {
    case 'writing':
      return 'Writing package'
    case 'complete':
      return `Exported ${session.triggerCount} triggers`
    case 'error':
      return 'Export failed'
  }
}

function getOperationProgressPercent(session: OperationSession) {
  if (session.totalCount <= 0) {
    return 100
  }

  return Math.max(
    0,
    Math.min(100, Math.round((session.processedCount / session.totalCount) * 100)),
  )
}

function getExportProgressPercent(session: ExportSession) {
  if (session.phase === 'complete') {
    return 100
  }

  if (session.totalBytes <= 0) {
    return 0
  }

  return Math.max(
    0,
    Math.min(100, Math.round((session.processedBytes / session.totalBytes) * 100)),
  )
}

function getImportProgressPercent(session: ImportSession) {
  if (session.phase === 'saving' || session.phase === 'complete') {
    if (session.totalSaveCount <= 0) {
      return 100
    }

    return Math.max(
      0,
      Math.min(
        100,
        Math.round((session.savedCount / session.totalSaveCount) * 100),
      ),
    )
  }

  if (session.totalBytes <= 0) {
    return 0
  }

  return Math.max(
    0,
    Math.min(100, Math.round((session.processedBytes / session.totalBytes) * 100)),
  )
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDuration(durationMs: number) {
  const boundedMs = Math.max(0, durationMs)

  if (boundedMs < 1000) {
    return '<1s'
  }

  const totalSeconds = Math.round(boundedMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes === 0) {
    return `${seconds}s`
  }

  return `${minutes}m ${seconds}s`
}

function sanitizeExportFileName(value: string) {
  const sanitized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')

  return sanitized || 'jena-triggers'
}

function downloadBytes(bytes: Uint8Array, fileName: string) {
  const data = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(data).set(bytes)

  const blob = new Blob([data], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function chunkArray<TItem>(items: TItem[], chunkSize: number) {
  const chunks: TItem[][] = []

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }

  return chunks
}

function yieldToEventLoop() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function readEmptyGroups() {
  const database = await openDatabase()

  try {
    return (await getValue<string[][]>(database, emptyGroupsCacheKey)) ?? []
  } finally {
    database.close()
  }
}

async function writeEmptyGroups(groups: string[][]) {
  const database = await openDatabase()

  try {
    await putValue(database, emptyGroupsCacheKey, mergeGroupPaths(groups))
  } finally {
    database.close()
  }
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion)

    request.onupgradeneeded = () => {
      const database = request.result

      if (!database.objectStoreNames.contains(handlesStoreName)) {
        database.createObjectStore(handlesStoreName)
      }
      if (!database.objectStoreNames.contains(triggerCacheStoreName)) {
        database.createObjectStore(triggerCacheStoreName)
      }
      if (!database.objectStoreNames.contains(userTriggerCacheStoreName)) {
        database.createObjectStore(userTriggerCacheStoreName)
      }
      if (!database.objectStoreNames.contains(settingsStoreName)) {
        database.createObjectStore(settingsStoreName)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB failed.'))
  })
}

function getValue<TValue>(database: IDBDatabase, key: IDBValidKey) {
  return new Promise<TValue | undefined>((resolve, reject) => {
    const transaction = database.transaction(userTriggerCacheStoreName, 'readonly')
    const store = transaction.objectStore(userTriggerCacheStoreName)
    const request = store.get(key)

    request.onsuccess = () => resolve(request.result as TValue | undefined)
    request.onerror = () => reject(request.error ?? new Error('Read failed.'))
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Transaction failed.'))
  })
}

function putValue(database: IDBDatabase, key: IDBValidKey, value: unknown) {
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(userTriggerCacheStoreName, 'readwrite')
    const store = transaction.objectStore(userTriggerCacheStoreName)

    store.put(value, key)

    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Transaction failed.'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Transaction aborted.'))
  })
}
