import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, MouseEvent } from 'react'
import { ControlledMenu, MenuDivider, MenuItem, useMenuState } from '@szhsin/react-menu'
import '@szhsin/react-menu/dist/index.css'
import Alert from 'react-bootstrap/Alert'
import Button from 'react-bootstrap/Button'
import Modal from 'react-bootstrap/Modal'
import ProgressBar from 'react-bootstrap/ProgressBar'
import toast from 'react-hot-toast'
import type { CharacterPresence } from '../../shared/messages'
import {
  createEmptyTrigger,
  withCanonicalTriggerId,
  type JenaCharacterServer,
  type JenaResolvedTrigger,
  type JenaTrigger,
  type JenaTriggerId,
  type JenaTriggerUpsert,
} from '../../shared/triggers'
import {
  TriStateCheckbox,
  type TriStateCheckboxState,
} from '../../shared/widgets/TriStateCheckbox'
import { TriggerEditorDialog } from './TriggerEditorDialog'
import { parseGinaPackageFile } from './ginaPackageParser'
import { useTriggerManager } from './UserTriggerManager'
import './UserTriggersEditor.css'

const databaseName = 'jena'
const databaseVersion = 3
const handlesStoreName = 'handles'
const triggerCacheStoreName = 'trigger-cache'
const userTriggerCacheStoreName = 'user-trigger-cache'
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
  id: string
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

interface TriggerReplacement {
  newTrigger: JenaTrigger
  oldTriggerId: JenaTriggerId
  upsert: JenaTriggerUpsert
}

export function UserTriggersEditor({
  selectedCharacter,
}: UserTriggersEditorProps) {
  const {
    deleteTriggers,
    toggleTriggers,
    triggers,
    upsertTrigger,
    upsertTriggers,
  } = useTriggerManager()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [emptyGroups, setEmptyGroups] = useState<string[][]>([])
  const [emptyGroupsLoaded, setEmptyGroupsLoaded] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  )
  const [selectedTriggerIds, setSelectedTriggerIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [lastSelectedTriggerId, setLastSelectedTriggerId] =
    useState<string | null>(null)
  const [editorSession, setEditorSession] = useState<EditorSession | null>(null)
  const [importSession, setImportSession] = useState<ImportSession | null>(null)
  const [operationSession, setOperationSession] =
    useState<OperationSession | null>(null)
  const [menuTarget, setMenuTarget] = useState<MenuTarget>({ item: null })
  const [anchorPoint, setAnchorPoint] = useState({ x: 0, y: 0 })
  const knownGroupIdsRef = useRef<Set<string>>(new Set())
  const [{ state: menuState, endTransition }, setMenuOpen] = useMenuState()
  const selectedCharacterKey = selectedCharacter
    ? getCharacterServerKey(selectedCharacter)
    : null
  const selectedCharacterRecord = selectedCharacter
    ? toCharacterServer(selectedCharacter)
    : null
  const treeItems = useMemo(
    () => buildVisibleTreeItems(triggers, emptyGroups, collapsedGroups),
    [collapsedGroups, emptyGroups, triggers],
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
    const currentGroupIds = new Set(groupIds)
    const knownGroupIds = knownGroupIdsRef.current

    setCollapsedGroups((previous) => {
      const next = new Set(
        [...previous].filter((groupId) => currentGroupIds.has(groupId)),
      )

      groupIds.forEach((groupId) => {
        if (!knownGroupIds.has(groupId)) {
          next.add(groupId)
        }
      })

      return areSetsEqual(previous, next) ? previous : next
    })

    knownGroupIdsRef.current = currentGroupIds
  }, [groupIds])

  function openContextMenu(
    event: MouseEvent,
    item: TreeItem | null,
  ) {
    event.preventDefault()
    setMenuTarget({ item })
    setAnchorPoint({ x: event.clientX, y: event.clientY })

    if (
      item?.type === 'trigger' &&
      !selectedTriggerIds.has(item.id)
    ) {
      setSelectedTriggerIds(new Set([item.id]))
      setLastSelectedTriggerId(item.id)
    }

    setMenuOpen(true)
  }

  function handleTriggerClick(event: MouseEvent, item: TreeTriggerItem) {
    if (event.shiftKey && lastSelectedTriggerId) {
      setSelectedTriggerIds(
        selectTriggerRange(triggerOrder, lastSelectedTriggerId, item.id),
      )
      return
    }

    if (event.ctrlKey || event.metaKey) {
      setSelectedTriggerIds((previous) => {
        const nextSelection = new Set(previous)

        if (nextSelection.has(item.id)) {
          nextSelection.delete(item.id)
        } else {
          nextSelection.add(item.id)
        }

        return nextSelection
      })
      setLastSelectedTriggerId(item.id)
      return
    }

    setSelectedTriggerIds(new Set([item.id]))
    setLastSelectedTriggerId(item.id)
  }

  function toggleGroup(item: TreeGroupItem) {
    setCollapsedGroups((previous) => {
      const next = new Set(previous)

      if (next.has(item.id)) {
        next.delete(item.id)
      } else {
        next.add(item.id)
      }

      return next
    })
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
    setCollapsedGroups((previous) => {
      const next = new Set(previous)
      next.delete(getGroupId(parentPath))
      return next
    })
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
    setSelectedTriggerIds(new Set([renamedTrigger.id]))
    setLastSelectedTriggerId(renamedTrigger.id)
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
    setSelectedTriggerIds(new Set([canonicalTrigger.id]))
    setLastSelectedTriggerId(canonicalTrigger.id)
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
    setSelectedTriggerIds((previous) => {
      const next = new Set(previous)
      triggerIds.forEach((triggerId) => next.delete(triggerId))
      return next
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
    setSelectedTriggerIds((previous) => {
      const next = new Set(previous)
      affectedTriggerIds.forEach((triggerId) => next.delete(triggerId))
      return next
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

    const completedReplacements = await performChunkedReplacements(
      `Rename ${group.name}`,
      replacements,
    )
    setSelectedTriggerIds(new Set(completedReplacements.map((replacement) => replacement.newTrigger.id)))
    setLastSelectedTriggerId(
      completedReplacements.at(-1)?.newTrigger.id ?? null,
    )
    setEmptyGroups((previous) =>
      mergeGroupPaths(
        previous.map((path) => renamePathPrefix(path, group.path, renamedPath)),
      ),
    )
  }

  async function handleMoveSelected(targetPath: string[]) {
    const triggerIds = [...selectedTriggerIds]
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
    setSelectedTriggerIds(new Set(completedReplacements.map((replacement) => replacement.newTrigger.id)))
    setLastSelectedTriggerId(
      completedReplacements.at(-1)?.newTrigger.id ?? null,
    )
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

  const effectiveMenuSelection = getEffectiveMenuSelection(
    menuTarget.item,
    selectedTriggerIds,
  )
  const menuGroup =
    menuTarget.item?.type === 'group' ? menuTarget.item : null
  const menuTrigger =
    menuTarget.item?.type === 'trigger' ? menuTarget.item : null

  return (
    <section
      aria-label="User triggers"
      className="user-triggers-editor"
      onContextMenu={(event) => openContextMenu(event, null)}
    >
      <div className="user-triggers-toolbar">
        <Button onClick={handleAddRootGroup} size="sm" variant="outline-secondary">
          add group
        </Button>
        <Button onClick={handleImportClick} size="sm" variant="outline-secondary">
          import GINA
        </Button>
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
                collapsed={collapsedGroups.has(item.id)}
                checkboxState={
                  groupStatesById.get(item.id)?.state ?? 'unchecked'
                }
                checkboxDisabled={
                  !selectedCharacterRecord ||
                  (groupStatesById.get(item.id)?.totalCount ?? 0) === 0
                }
                item={item}
                key={item.id}
                onAddGroup={handleAddGroup}
                onAddTrigger={handleAddTrigger}
                onContextMenu={openContextMenu}
                onToggleChecked={(enabled) => {
                  void handleToggleGroup(item, enabled)
                }}
                onToggle={toggleGroup}
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
                onClick={handleTriggerClick}
                onContextMenu={openContextMenu}
                onToggle={(enabled) => {
                  void handleToggleTrigger(item, enabled)
                }}
                selected={selectedTriggerIds.has(item.id)}
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
              edit
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
              rename
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
              rename group
            </MenuItem>
            <MenuItem onClick={() => handleAddGroup(menuGroup.path)}>
              add subgroup
            </MenuItem>
            <MenuItem onClick={() => handleAddTrigger(menuGroup.path)}>
              add trigger
            </MenuItem>
            <MenuItem
              disabled={selectedTriggerIds.size === 0}
              onClick={() => {
                void handleMoveSelected(menuGroup.path)
              }}
            >
              move selected here
            </MenuItem>
          </>
        ) : null}
        {!menuGroup && !menuTrigger ? (
          <>
            <MenuItem onClick={handleAddRootGroup}>add group</MenuItem>
            <MenuItem onClick={handleImportClick}>import GINA</MenuItem>
          </>
        ) : null}
        <MenuItem disabled>share</MenuItem>
        <MenuDivider />
        {menuGroup ? (
          <MenuItem
            onClick={() => {
              void handleDeleteGroup(menuGroup)
            }}
          >
            delete
          </MenuItem>
        ) : (
          <MenuItem
            disabled={effectiveMenuSelection.length === 0}
            onClick={() => {
              void handleDeleteTriggerIds(effectiveMenuSelection)
            }}
          >
            delete
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
  checkboxDisabled,
  checkboxState,
  collapsed,
  item,
  onAddGroup,
  onAddTrigger,
  onContextMenu,
  onToggle,
  onToggleChecked,
}: {
  checkboxDisabled: boolean
  checkboxState: TriStateCheckboxState
  collapsed: boolean
  item: TreeGroupItem
  onAddGroup: (path: string[]) => void
  onAddTrigger: (path: string[]) => void
  onContextMenu: (event: React.MouseEvent, item: TreeItem) => void
  onToggle: (item: TreeGroupItem) => void
  onToggleChecked: (enabled: boolean) => void
}) {
  return (
    <div
      aria-expanded={!collapsed}
      className="user-triggers-row"
      onClick={() => onToggle(item)}
      onContextMenu={(event) => {
        event.stopPropagation()
        onContextMenu(event, item)
      }}
      role="treeitem"
      tabIndex={0}
    >
      <span className="user-triggers-row-main">
        <span
          className="user-triggers-indent"
          style={{ width: `${Math.max(0, item.path.length - 1) * 1.15}rem` }}
        />
        <span className="user-triggers-caret">
          {item.childCount > 0 ? (collapsed ? '>' : 'v') : ''}
        </span>
        <TriStateCheckbox
          ariaLabel={`Enable triggers in ${item.name}`}
          className="form-check-input user-triggers-checkbox"
          disabled={checkboxDisabled}
          onChange={onToggleChecked}
          state={checkboxState}
        />
        <span className="user-triggers-group-name">{item.name}</span>
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
          +
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
          T+
        </Button>
      </span>
    </div>
  )
}

function TriggerRow({
  checkboxDisabled,
  checkboxState,
  item,
  onClick,
  onContextMenu,
  onToggle,
  selected,
}: {
  checkboxDisabled: boolean
  checkboxState: TriStateCheckboxState
  item: TreeTriggerItem
  onClick: (event: React.MouseEvent, item: TreeTriggerItem) => void
  onContextMenu: (event: MouseEvent, item: TreeItem) => void
  onToggle: (enabled: boolean) => void
  selected: boolean
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
      role="treeitem"
      tabIndex={0}
    >
      <span className="user-triggers-row-main">
        <span
          className="user-triggers-indent"
          style={{ width: `${item.path.length * 1.15}rem` }}
        />
        <TriStateCheckbox
          ariaLabel={`Enable ${item.resolved.trigger.name || 'unnamed trigger'}`}
          className="form-check-input user-triggers-checkbox"
          disabled={checkboxDisabled}
          onChange={onToggle}
          state={checkboxState}
        />
        <span className="user-triggers-trigger-name">
          {item.resolved.trigger.name || '(unnamed trigger)'}
        </span>
      </span>
    </div>
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

function getGroupStatesById(
  triggers: JenaResolvedTrigger[],
  selectedCharacterKey: string | null,
) {
  const groupStates = new Map<
    string,
    {
      enabledCount: number
      state: TriStateCheckboxState
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
              getCharacterServerKey(character) === selectedCharacterKey,
          ),
        ).length
      : 0

    groupStates.set(groupId, {
      enabledCount,
      state: getTriState(enabledCount, descendantTriggers.length),
      totalCount: descendantTriggers.length,
    })
  })

  return groupStates
}

function getTriggerCheckboxState(
  resolved: JenaResolvedTrigger,
  selectedCharacterKey: string | null,
): TriStateCheckboxState {
  if (
    selectedCharacterKey &&
    resolved.enabledFor.some(
      (character) => getCharacterServerKey(character) === selectedCharacterKey,
    )
  ) {
    return 'checked'
  }

  return 'unchecked'
}

function getTriState(
  enabledCount: number,
  totalCount: number,
): TriStateCheckboxState {
  if (totalCount > 0 && enabledCount === totalCount) {
    return 'checked'
  }

  if (enabledCount > 0) {
    return 'mixed'
  }

  return 'unchecked'
}

function selectTriggerRange(
  triggerOrder: string[],
  anchorId: string,
  targetId: string,
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
  selectedTriggerIds: Set<string>,
) {
  if (item?.type === 'trigger' && !selectedTriggerIds.has(item.id)) {
    return [item.id]
  }

  return [...selectedTriggerIds]
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

function areSetsEqual<TValue>(left: Set<TValue>, right: Set<TValue>) {
  return (
    left.size === right.size &&
    [...left].every((value) => right.has(value))
  )
}

function toCharacterServer(character: CharacterPresence): JenaCharacterServer {
  return {
    characterName: character.characterName,
    serverName: character.serverName,
  }
}

function getCharacterServerKey(character: JenaCharacterServer) {
  return `${character.serverName.trim().toLocaleLowerCase()}\0${character.characterName.trim().toLocaleLowerCase()}`
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

function getOperationProgressPercent(session: OperationSession) {
  if (session.totalCount <= 0) {
    return 100
  }

  return Math.max(
    0,
    Math.min(100, Math.round((session.processedCount / session.totalCount) * 100)),
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
