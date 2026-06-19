import { useEffect, useMemo, useState } from 'react'
import type { MouseEvent } from 'react'
import { ControlledMenu, MenuItem, useMenuState } from '@szhsin/react-menu'
import { Radio, RadioOff, X } from 'lucide-react'
import Alert from 'react-bootstrap/Alert'
import Button from 'react-bootstrap/Button'
import Card from 'react-bootstrap/Card'
import Modal from 'react-bootstrap/Modal'
import ProgressBar from 'react-bootstrap/ProgressBar'
import toast from 'react-hot-toast'
import type { CharacterPresence } from '../../shared/messages'
import {
  BINARY,
  FourStateCheckbox,
  QUATERNARY,
  type FourStateCheckboxState,
} from '../../shared/widgets/FourStateCheckbox'
import {
  getJenaCharacterServerKey,
  type JenaCharacterServer,
  type JenaTrigger,
  type JenaTriggerId,
  type JenaTriggerUpsert,
} from '../../shared/triggers'
import { TriggerEditorDialog } from '../editor/TriggerEditorDialog'
import {
  useSubscribedTriggerManager,
  type ResolvedSubscribedTrigger,
  type SubscribedTriggerSnapshot,
} from '../model/SubscribedTriggerManager'
import { useTriggerManager } from '../model/UserTriggerManager'
import './SubscribedTriggersView.css'

const databaseName = 'jena'
const databaseVersion = 4
const handlesStoreName = 'handles'
const settingsStoreName = 'settings'
const triggerCacheStoreName = 'trigger-cache'
const userTriggerCacheStoreName = 'user-trigger-cache'
const expandedGroupsCacheKey = 'subscribed-triggers-expanded-groups'
const adoptTriggerChunkSize = 100

interface SubscribedTriggersViewProps {
  selectedCharacter: CharacterPresence | null
}

type TreeSelection =
  | { type: 'none' }
  | { path: string[]; subscriptionId: string; type: 'group' }
  | {
      anchorId: JenaTriggerId | null
      ids: Set<JenaTriggerId>
      subscriptionId: string
      type: 'triggers'
    }

type TreeItem = TreeGroupItem | TreeTriggerItem

interface TreeGroupItem {
  childCount: number
  id: string
  name: string
  path: string[]
  subscriptionId: string
  triggerCount: number
  type: 'group'
}

interface TreeTriggerItem {
  id: JenaTriggerId
  path: string[]
  subscriptionId: string
  trigger: ResolvedSubscribedTrigger
  type: 'trigger'
}

interface MenuTarget {
  item: TreeItem | null
  subscription: SubscribedTriggerSnapshot | null
}

interface AdoptSession {
  error: string
  phase: 'complete' | 'error' | 'running'
  processedBatches: number
  processedCount: number
  title: string
  totalBatches: number
  totalCount: number
}

export function SubscribedTriggersView({
  selectedCharacter,
}: SubscribedTriggersViewProps) {
  const {
    defaultEnablement,
    removeSubscription,
    setSubscribedTriggerEnablement,
    setSubscriptionDefaultEnablement,
    snapshots,
    triggerEnablement,
  } = useSubscribedTriggerManager()
  const { upsertTriggers } = useTriggerManager()
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set())
  const [expandedGroupsLoaded, setExpandedGroupsLoaded] = useState(false)
  const [selection, setSelection] = useState<TreeSelection>({ type: 'none' })
  const [menuTarget, setMenuTarget] = useState<MenuTarget>({
    item: null,
    subscription: null,
  })
  const [anchorPoint, setAnchorPoint] = useState({ x: 0, y: 0 })
  const [{ state: menuState, endTransition }, setMenuOpen] = useMenuState()
  const [viewTrigger, setViewTrigger] = useState<JenaTrigger | null>(null)
  const [adoptSession, setAdoptSession] = useState<AdoptSession | null>(null)
  const selectedCharacterRecord = selectedCharacter
    ? toCharacterServer(selectedCharacter)
    : null
  const selectedCharacterKey = selectedCharacterRecord
    ? getJenaCharacterServerKey(selectedCharacterRecord)
    : null
  const defaultEnablementByKey = useMemo(() => {
    return new Map(
      defaultEnablement.map((record) => [
        getCharacterRecordKey(record.subscriptionId, record.character),
        record.mode,
      ]),
    )
  }, [defaultEnablement])
  const triggerEnablementByKey = useMemo(() => {
    return new Map(
      triggerEnablement.map((record) => [
        getTriggerRecordKey(
          record.subscriptionId,
          record.triggerId,
          record.character,
        ),
        record.mode,
      ]),
    )
  }, [triggerEnablement])
  const orderedSnapshots = useMemo(() => {
    return [...snapshots].sort((left, right) =>
      left.ownerDisplayName.localeCompare(right.ownerDisplayName, undefined, {
        sensitivity: 'base',
      }),
    )
  }, [snapshots])
  const treeItemsBySubscription = useMemo(() => {
    return new Map(
      orderedSnapshots.map((snapshot) => [
        snapshot.id,
        buildVisibleTreeItems(snapshot, expandedGroupIds),
      ]),
    )
  }, [expandedGroupIds, orderedSnapshots])
  const triggerOrderBySubscription = useMemo(() => {
    return new Map(
      [...treeItemsBySubscription].map(([subscriptionId, treeItems]) => [
        subscriptionId,
        treeItems.flatMap((item) => (item.type === 'trigger' ? [item.id] : [])),
      ]),
    )
  }, [treeItemsBySubscription])

  useEffect(() => {
    let cancelled = false

    void readExpandedGroups()
      .then((ids) => {
        if (!cancelled) {
          setExpandedGroupIds(new Set(ids))
          setExpandedGroupsLoaded(true)
        }
      })
      .catch((error: unknown) => {
        console.warn('[SubscribedTriggersView] unable to load expanded groups', error)
        if (!cancelled) {
          setExpandedGroupsLoaded(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!expandedGroupsLoaded) {
      return
    }

    void writeExpandedGroups([...expandedGroupIds]).catch((error: unknown) => {
      console.warn('[SubscribedTriggersView] unable to save expanded groups', error)
    })
  }, [expandedGroupIds, expandedGroupsLoaded])

  function openContextMenu(
    event: MouseEvent,
    subscription: SubscribedTriggerSnapshot,
    item: TreeItem | null,
  ) {
    event.preventDefault()
    event.stopPropagation()
    setMenuTarget({ item, subscription })
    setAnchorPoint({ x: event.clientX, y: event.clientY })

    if (item?.type === 'trigger') {
      setSelection((current) => {
        if (
          current.type === 'triggers' &&
          current.subscriptionId === item.subscriptionId &&
          current.ids.has(item.id)
        ) {
          return current
        }

        return {
          anchorId: item.id,
          ids: new Set([item.id]),
          subscriptionId: item.subscriptionId,
          type: 'triggers',
        }
      })
    } else if (item?.type === 'group') {
      setSelection((current) => {
        if (
          current.type === 'triggers' &&
          current.subscriptionId === item.subscriptionId &&
          current.ids.size > 0
        ) {
          return current
        }

        return {
          path: item.path,
          subscriptionId: item.subscriptionId,
          type: 'group',
        }
      })
    }

    setMenuOpen(true)
  }

  function handleTriggerClick(event: MouseEvent, item: TreeTriggerItem) {
    setSelection((current) => {
      if (event.shiftKey && current.type === 'triggers' && current.anchorId) {
        return {
          anchorId: current.anchorId,
          ids: selectTriggerRange(
            triggerOrderBySubscription.get(item.subscriptionId) ?? [],
            current.anchorId,
            item.id,
          ),
          subscriptionId: item.subscriptionId,
          type: 'triggers',
        }
      }

      if (event.ctrlKey || event.metaKey) {
        const nextIds =
          current.type === 'triggers' && current.subscriptionId === item.subscriptionId
            ? new Set(current.ids)
            : new Set<JenaTriggerId>()

        if (nextIds.has(item.id)) {
          nextIds.delete(item.id)
        } else {
          nextIds.add(item.id)
        }

        return {
          anchorId: getSelectionAnchor(nextIds, item.id),
          ids: nextIds,
          subscriptionId: item.subscriptionId,
          type: 'triggers',
        }
      }

      return {
        anchorId: item.id,
        ids: new Set([item.id]),
        subscriptionId: item.subscriptionId,
        type: 'triggers',
      }
    })
  }

  function handleGroupClick(_event: MouseEvent, item: TreeGroupItem) {
    setSelection({
      path: item.path,
      subscriptionId: item.subscriptionId,
      type: 'group',
    })
  }

  function toggleGroup(item: TreeGroupItem) {
    setExpandedGroupIds((current) => {
      const next = new Set(current)
      if (next.has(item.id)) {
        next.delete(item.id)
      } else {
        next.add(item.id)
      }

      return next
    })
  }

  async function handleDefaultToggle(
    subscription: SubscribedTriggerSnapshot,
    enabled: boolean,
  ) {
    if (!selectedCharacterRecord) {
      return
    }

    await setSubscriptionDefaultEnablement(
      subscription.id,
      selectedCharacterRecord,
      enabled ? 'enabled' : 'disabled',
    )
  }

  async function handleTriggerEnablement(
    item: TreeTriggerItem,
    state: FourStateCheckboxState,
  ) {
    if (!selectedCharacterRecord || state === 'mixed') {
      return
    }

    await setSubscribedTriggerEnablement(
      item.subscriptionId,
      item.id,
      selectedCharacterRecord,
      state,
    )
  }

  async function handleGroupEnablement(
    subscription: SubscribedTriggerSnapshot,
    item: TreeGroupItem,
    state: FourStateCheckboxState,
  ) {
    if (!selectedCharacterRecord || state === 'mixed') {
      return
    }

    const triggerIds = getTriggerIdsUnderPath(subscription.triggers, item.path)
    for (const triggerId of triggerIds) {
      await setSubscribedTriggerEnablement(
        subscription.id,
        triggerId,
        selectedCharacterRecord,
        state,
      )
    }
  }

  async function handleUnsubscribe(subscription: SubscribedTriggerSnapshot) {
    if (
      !confirm(
        `Stop subscribing to ${subscription.ownerDisplayName || 'this publisher'}?`,
      )
    ) {
      return
    }

    try {
      await removeSubscription(subscription.id)
      toast.success('Subscription removed.')
    } catch (error) {
      console.warn('[SubscribedTriggersView] unable to unsubscribe', error)
      toast.error(getErrorMessage(error))
    }
  }

  async function adoptTriggers(title: string, triggers: JenaTrigger[]) {
    if (triggers.length === 0) {
      toast.error('No subscribed triggers selected.')
      return
    }

    const upserts = triggers.map<JenaTriggerUpsert>((trigger) => ({
      enabledFor: selectedCharacterRecord ? [selectedCharacterRecord] : [],
      trigger,
    }))
    const chunks = chunkArray(upserts, adoptTriggerChunkSize)

    try {
      setAdoptSession({
        error: '',
        phase: 'running',
        processedBatches: 0,
        processedCount: 0,
        title,
        totalBatches: chunks.length,
        totalCount: upserts.length,
      })

      for (const [index, chunk] of chunks.entries()) {
        await upsertTriggers(chunk)
        setAdoptSession((current) =>
          current
            ? {
                ...current,
                processedBatches: index + 1,
                processedCount: Math.min(
                  current.totalCount,
                  current.processedCount + chunk.length,
                ),
              }
            : current,
        )
        await yieldToEventLoop()
      }

      setAdoptSession((current) =>
        current
          ? {
              ...current,
              phase: 'complete',
              processedBatches: chunks.length,
              processedCount: upserts.length,
            }
          : current,
      )
      setTimeout(() => setAdoptSession(null), 500)
      toast.success(`Adopted ${upserts.length} trigger${upserts.length === 1 ? '' : 's'}.`)
    } catch (error) {
      console.warn('[SubscribedTriggersView] unable to adopt triggers', error)
      setAdoptSession((current) =>
        current
          ? {
              ...current,
              error: getErrorMessage(error),
              phase: 'error',
            }
          : current,
      )
      toast.error(getErrorMessage(error))
    }
  }

  function adoptMenuTarget() {
    if (!menuTarget.subscription) {
      return
    }

    const triggerIds = getEffectiveMenuSelection(menuTarget.item, selection)
    if (triggerIds.length > 0) {
      const triggers = getTriggersByIdsInTreeOrder(
        treeItemsBySubscription.get(menuTarget.subscription.id) ?? [],
        new Set(triggerIds),
      )
      void adoptTriggers(
        triggerIds.length === 1 ? 'Adopt Trigger' : 'Adopt Selection',
        triggers,
      )
      return
    }

    if (menuTarget.item?.type === 'group') {
      void adoptTriggers(
        'Adopt Group',
        getTriggersUnderPath(menuTarget.subscription.triggers, menuTarget.item.path),
      )
    }
  }

  function getDefaultEnabled(subscriptionId: string) {
    if (!selectedCharacterKey) {
      return false
    }

    return (
      defaultEnablementByKey.get(`${subscriptionId}\0${selectedCharacterKey}`) ===
      'enabled'
    )
  }

  function getTriggerOverrideState(item: TreeTriggerItem): FourStateCheckboxState {
    if (!selectedCharacterKey) {
      return 'inherit'
    }

    return (
      triggerEnablementByKey.get(
        `${item.subscriptionId}\0${item.id}\0${selectedCharacterKey}`,
      ) ?? 'inherit'
    )
  }

  function getGroupOverrideState(
    subscription: SubscribedTriggerSnapshot,
    item: TreeGroupItem,
  ): FourStateCheckboxState {
    if (!selectedCharacterKey) {
      return 'inherit'
    }

    const triggerIds = getTriggerIdsUnderPath(subscription.triggers, item.path)
    if (triggerIds.length === 0) {
      return 'inherit'
    }

    const states = new Set(
      triggerIds.map(
        (triggerId) =>
          triggerEnablementByKey.get(
            `${subscription.id}\0${triggerId}\0${selectedCharacterKey}`,
          ) ?? 'inherit',
      ),
    )

    return states.size === 1 ? ([...states][0] as FourStateCheckboxState) : 'mixed'
  }

  const menuTrigger =
    menuTarget.item?.type === 'trigger' ? menuTarget.item : null
  const menuGroup =
    menuTarget.item?.type === 'group' ? menuTarget.item : null
  const effectiveMenuSelection = getEffectiveMenuSelection(
    menuTarget.item,
    selection,
  )

  return (
    <section className="subscribed-triggers-view" aria-label="Subscribed triggers">
      <header className="subscribed-triggers-header">
        <h2>Subscriptions</h2>
      </header>

      <div className="subscribed-triggers-body">
        {orderedSnapshots.length === 0 ? (
          <div className="subscribed-triggers-empty">No subscriptions</div>
        ) : (
          <div className="subscribed-triggers-list">
            {orderedSnapshots.map((subscription) => {
              const treeItems = treeItemsBySubscription.get(subscription.id) ?? []
              const defaultEnabled = getDefaultEnabled(subscription.id)

              return (
                <Card className="subscribed-triggers-card" key={subscription.id}>
                  <Card.Header className="subscribed-triggers-card-header">
                    <FourStateCheckbox
                      ariaLabel={`Enable ${subscription.ownerDisplayName} by default`}
                      className="subscribed-triggers-default-checkbox"
                      disabled={!selectedCharacterRecord}
                      mode={BINARY}
                      onChange={(nextState) => {
                        void handleDefaultToggle(
                          subscription,
                          nextState === 'enabled',
                        )
                      }}
                      state={defaultEnabled ? 'enabled' : 'disabled'}
                      stopPropagation
                      title={
                        selectedCharacterRecord
                          ? 'Enable by default'
                          : 'Select a character to change enablement'
                      }
                    />
                    <span className="subscribed-triggers-publisher-name">
                      {subscription.ownerDisplayName || 'Anonymous publisher'}
                    </span>
                    <Button
                      aria-label={`Unsubscribe from ${subscription.ownerDisplayName}`}
                      className="subscribed-triggers-unsubscribe"
                      onClick={() => {
                        void handleUnsubscribe(subscription)
                      }}
                      size="sm"
                      title="Unsubscribe"
                      variant="outline-danger"
                    >
                      <X aria-hidden="true" size={15} />
                    </Button>
                  </Card.Header>
                  <Card.Body className="subscribed-triggers-card-body">
                    {subscription.triggers.length === 0 ? (
                      <div className="subscribed-triggers-card-empty">
                        No published triggers
                      </div>
                    ) : (
                      <div
                        className="subscribed-triggers-tree"
                        onContextMenu={(event) =>
                          openContextMenu(event, subscription, null)
                        }
                        role="tree"
                      >
                        {treeItems.map((item) =>
                          item.type === 'group' ? (
                            <SubscribedGroupRow
                              checkboxDisabled={!selectedCharacterRecord}
                              checkboxState={getGroupOverrideState(
                                subscription,
                                item,
                              )}
                              collapsed={!expandedGroupIds.has(item.id)}
                              item={item}
                              key={item.id}
                              onContextMenu={(event, rowItem) =>
                                openContextMenu(event, subscription, rowItem)
                              }
                              onSelect={handleGroupClick}
                              onToggle={toggleGroup}
                              onToggleChecked={(state) => {
                                void handleGroupEnablement(
                                  subscription,
                                  item,
                                  state,
                                )
                              }}
                              selected={
                                selection.type === 'group' &&
                                selection.subscriptionId === item.subscriptionId &&
                                areStringArraysEqual(selection.path, item.path)
                              }
                            />
                          ) : (
                            <SubscribedTriggerRow
                              checkboxDisabled={!selectedCharacterRecord}
                              checkboxState={getTriggerOverrideState(item)}
                              item={item}
                              key={item.id}
                              onClick={handleTriggerClick}
                              onContextMenu={(event, rowItem) =>
                                openContextMenu(event, subscription, rowItem)
                              }
                              onDoubleClick={(trigger) => setViewTrigger(trigger)}
                              onToggleChecked={(state) => {
                                void handleTriggerEnablement(item, state)
                              }}
                              selected={
                                selection.type === 'triggers' &&
                                selection.subscriptionId === item.subscriptionId &&
                                selection.ids.has(item.id)
                              }
                            />
                          ),
                        )}
                      </div>
                    )}
                  </Card.Body>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      <ControlledMenu
        anchorPoint={anchorPoint}
        endTransition={endTransition}
        onClose={() => setMenuOpen(false)}
        state={menuState}
      >
        {menuTrigger ? (
          <MenuItem onClick={() => setViewTrigger(menuTrigger.trigger.trigger)}>
            View...
          </MenuItem>
        ) : null}
        <MenuItem
          disabled={
            !menuGroup &&
            !menuTrigger &&
            effectiveMenuSelection.length === 0
          }
          onClick={adoptMenuTarget}
        >
          {getAdoptMenuLabel(menuTarget.item, effectiveMenuSelection.length)}
        </MenuItem>
      </ControlledMenu>

      {viewTrigger ? (
        <TriggerEditorDialog
          readOnly
          setShown={(shown) => {
            if (!shown) {
              setViewTrigger(null)
            }
          }}
          setTrigger={() => undefined}
          shown={true}
          trigger={viewTrigger}
        />
      ) : null}

      <AdoptProgressDialog session={adoptSession} setSession={setAdoptSession} />
    </section>
  )
}

function SubscribedGroupRow({
  checkboxDisabled,
  checkboxState,
  collapsed,
  item,
  onContextMenu,
  onSelect,
  onToggle,
  onToggleChecked,
  selected,
}: {
  checkboxDisabled: boolean
  checkboxState: FourStateCheckboxState
  collapsed: boolean
  item: TreeGroupItem
  onContextMenu: (event: MouseEvent, item: TreeItem) => void
  onSelect: (event: MouseEvent, item: TreeGroupItem) => void
  onToggle: (item: TreeGroupItem) => void
  onToggleChecked: (state: FourStateCheckboxState) => void
  selected: boolean
}) {
  return (
    <div
      aria-expanded={!collapsed}
      aria-selected={selected}
      className={
        selected
          ? 'subscribed-triggers-row subscribed-triggers-row-selected'
          : 'subscribed-triggers-row'
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
      <span className="subscribed-triggers-row-main">
        <span
          className="subscribed-triggers-indent"
          style={{ width: `${Math.max(0, item.path.length - 1) * 1.15}rem` }}
        />
        <button
          aria-label={collapsed ? `Expand ${item.name}` : `Collapse ${item.name}`}
          className="subscribed-triggers-caret"
          disabled={item.childCount === 0}
          onClick={(event) => {
            event.stopPropagation()
            onToggle(item)
          }}
          type="button"
        >
          {item.childCount > 0 ? (collapsed ? '>' : 'v') : ''}
        </button>
        <FourStateCheckbox
          ariaLabel={`Enable triggers in ${item.name}`}
          disabled={checkboxDisabled || item.triggerCount === 0}
          mode={QUATERNARY}
          onChange={onToggleChecked}
          state={checkboxState}
        />
        <span className="subscribed-triggers-group-name">{item.name}</span>
      </span>
    </div>
  )
}

function SubscribedTriggerRow({
  checkboxDisabled,
  checkboxState,
  item,
  onClick,
  onContextMenu,
  onDoubleClick,
  onToggleChecked,
  selected,
}: {
  checkboxDisabled: boolean
  checkboxState: FourStateCheckboxState
  item: TreeTriggerItem
  onClick: (event: MouseEvent, item: TreeTriggerItem) => void
  onContextMenu: (event: MouseEvent, item: TreeItem) => void
  onDoubleClick: (trigger: JenaTrigger) => void
  onToggleChecked: (state: FourStateCheckboxState) => void
  selected: boolean
}) {
  return (
    <div
      aria-selected={selected}
      className={
        selected
          ? 'subscribed-triggers-row subscribed-triggers-row-selected'
          : 'subscribed-triggers-row'
      }
      onClick={(event) => onClick(event, item)}
      onContextMenu={(event) => {
        event.stopPropagation()
        onContextMenu(event, item)
      }}
      onDoubleClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onDoubleClick(item.trigger.trigger)
      }}
      role="treeitem"
      tabIndex={0}
    >
      <span className="subscribed-triggers-row-main">
        <span
          className="subscribed-triggers-indent"
          style={{ width: `${item.path.length * 1.15}rem` }}
        />
        <span className="subscribed-triggers-caret-placeholder" />
        <FourStateCheckbox
          ariaLabel={`Enable ${item.trigger.trigger.name || 'unnamed trigger'}`}
          disabled={checkboxDisabled}
          mode={QUATERNARY}
          onChange={onToggleChecked}
          state={checkboxState}
        />
        <span className="subscribed-triggers-trigger-name">
          {item.trigger.trigger.name || '(unnamed trigger)'}
        </span>
      </span>
      <span className="subscribed-triggers-row-side">
        <BroadcastIndicator broadcastToSubscribers={item.trigger.broadcastToSubscribers} />
      </span>
    </div>
  )
}

function BroadcastIndicator({
  broadcastToSubscribers,
}: {
  broadcastToSubscribers: boolean
}) {
  const Icon = broadcastToSubscribers ? Radio : RadioOff
  const label = broadcastToSubscribers ? 'Broadcasts to subscribers' : 'Private'

  return (
    <span
      aria-label={label}
      className="subscribed-triggers-broadcast-indicator"
      data-state={broadcastToSubscribers ? 'subscribers' : 'private'}
      role="img"
      title={label}
    >
      <Icon aria-hidden="true" size={15} strokeWidth={2} />
    </span>
  )
}

function AdoptProgressDialog({
  session,
  setSession,
}: {
  session: AdoptSession | null
  setSession: (session: AdoptSession | null) => void
}) {
  const isBusy = session?.phase === 'running'
  const progressPercent = session
    ? Math.round((session.processedCount / session.totalCount) * 100)
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
        <Modal.Title>{session?.title ?? 'Adopt Triggers'}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {session ? (
          <div className="subscribed-triggers-adopt-dialog">
            <div>
              <div className="subscribed-triggers-adopt-title">
                {getAdoptStatus(session)}
              </div>
              <div className="subscribed-triggers-adopt-status">
                {session.processedCount} / {session.totalCount} triggers
              </div>
            </div>
            <ProgressBar
              animated={isBusy}
              now={progressPercent}
              striped={isBusy}
              variant={session.phase === 'error' ? 'danger' : 'success'}
            />
            <div className="subscribed-triggers-adopt-status">
              batch {session.processedBatches} / {session.totalBatches}
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

function buildVisibleTreeItems(
  subscription: SubscribedTriggerSnapshot,
  expandedGroupIds: Set<string>,
) {
  const groups = new Map<string, TreeGroupItem>()
  const triggersByParent = new Map<string, TreeTriggerItem[]>()

  function ensureGroup(path: string[]) {
    path.forEach((_, index) => {
      const groupPath = path.slice(0, index + 1)
      const id = getSubscriptionGroupId(subscription.id, groupPath)

      if (!groups.has(id)) {
        groups.set(id, {
          childCount: 0,
          id,
          name: groupPath[groupPath.length - 1],
          path: groupPath,
          subscriptionId: subscription.id,
          triggerCount: 0,
          type: 'group',
        })
      }
    })
  }

  subscription.triggers.forEach((trigger) => {
    ensureGroup(trigger.trigger.groupPath)

    const parentId = getSubscriptionGroupId(
      subscription.id,
      trigger.trigger.groupPath,
    )
    const siblings = triggersByParent.get(parentId) ?? []
    siblings.push({
      id: trigger.trigger.id,
      path: trigger.trigger.groupPath,
      subscriptionId: subscription.id,
      trigger,
      type: 'trigger',
    })
    triggersByParent.set(parentId, siblings)
  })

  groups.forEach((group) => {
    group.childCount = countChildren(
      subscription.id,
      groups,
      triggersByParent,
      group.path,
    )
    group.triggerCount = getTriggerIdsUnderPath(subscription.triggers, group.path).length
  })

  triggersByParent.forEach((siblings) => {
    siblings.sort(compareTriggerItems)
  })

  return flattenGroups(
    subscription.id,
    groups,
    triggersByParent,
    expandedGroupIds,
    [],
  )
}

function flattenGroups(
  subscriptionId: string,
  groups: Map<string, TreeGroupItem>,
  triggersByParent: Map<string, TreeTriggerItem[]>,
  expandedGroupIds: Set<string>,
  parentPath: string[],
) {
  const parentId = getSubscriptionGroupId(subscriptionId, parentPath)
  const items: TreeItem[] = []
  const childGroups = [...groups.values()]
    .filter((group) => isDirectChildPath(group.path, parentPath))
    .sort(compareGroupItems)

  childGroups.forEach((group) => {
    items.push(group)

    if (expandedGroupIds.has(group.id)) {
      items.push(
        ...flattenGroups(
          subscriptionId,
          groups,
          triggersByParent,
          expandedGroupIds,
          group.path,
        ),
      )
    }
  })

  items.push(...(triggersByParent.get(parentId) ?? []))

  return items
}

function countChildren(
  subscriptionId: string,
  groups: Map<string, TreeGroupItem>,
  triggersByParent: Map<string, TreeTriggerItem[]>,
  path: string[],
) {
  const directGroups = [...groups.values()].filter((group) =>
    isDirectChildPath(group.path, path),
  ).length
  const directTriggers =
    triggersByParent.get(getSubscriptionGroupId(subscriptionId, path))?.length ?? 0

  return directGroups + directTriggers
}

function getTriggerIdsUnderPath(
  triggers: ResolvedSubscribedTrigger[],
  path: string[],
) {
  return triggers.flatMap((trigger) =>
    isSameOrChildPath(trigger.trigger.groupPath, path)
      ? [trigger.trigger.id]
      : [],
  )
}

function getTriggersUnderPath(
  triggers: ResolvedSubscribedTrigger[],
  path: string[],
) {
  return triggers
    .filter((trigger) => isSameOrChildPath(trigger.trigger.groupPath, path))
    .map((trigger) => trigger.trigger)
    .sort(compareTriggersByPath)
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
      selectedTriggers.push(item.trigger.trigger)
    }
  })

  return selectedTriggers
}

function getEffectiveMenuSelection(
  item: TreeItem | null,
  selection: TreeSelection,
) {
  if (
    item?.type === 'trigger' &&
    (selection.type !== 'triggers' ||
      selection.subscriptionId !== item.subscriptionId ||
      !selection.ids.has(item.id))
  ) {
    return [item.id]
  }

  return selection.type === 'triggers' ? [...selection.ids] : []
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

function getSelectionAnchor(
  ids: Set<JenaTriggerId>,
  preferred: JenaTriggerId | null,
) {
  if (preferred && ids.has(preferred)) {
    return preferred
  }

  return [...ids][0] ?? null
}

function getAdoptMenuLabel(item: TreeItem | null, selectionCount: number) {
  if (selectionCount > 1) {
    return 'Adopt selection'
  }
  if (item?.type === 'group') {
    return 'Adopt this group'
  }
  if (item?.type === 'trigger' || selectionCount === 1) {
    return 'Adopt this trigger'
  }

  return 'Adopt selection'
}

function compareGroupItems(left: TreeGroupItem, right: TreeGroupItem) {
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
}

function compareTriggerItems(left: TreeTriggerItem, right: TreeTriggerItem) {
  return left.trigger.trigger.name.localeCompare(
    right.trigger.trigger.name,
    undefined,
    { sensitivity: 'base' },
  )
}

function compareTriggersByPath(left: JenaTrigger, right: JenaTrigger) {
  const pathComparison = left.groupPath
    .join('\0')
    .localeCompare(right.groupPath.join('\0'), undefined, { sensitivity: 'base' })

  if (pathComparison !== 0) {
    return pathComparison
  }

  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
}

function getSubscriptionGroupId(subscriptionId: string, path: string[]) {
  return `${subscriptionId}\0${path.join('\0')}`
}

function getCharacterRecordKey(
  subscriptionId: string,
  character: JenaCharacterServer,
) {
  return `${subscriptionId}\0${getJenaCharacterServerKey(character)}`
}

function getTriggerRecordKey(
  subscriptionId: string,
  triggerId: JenaTriggerId,
  character: JenaCharacterServer,
) {
  return `${subscriptionId}\0${triggerId}\0${getJenaCharacterServerKey(character)}`
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

function areStringArraysEqual(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((part, index) => part === right[index])
  )
}

function toCharacterServer(character: CharacterPresence): JenaCharacterServer {
  return {
    characterName: character.characterName,
    serverName: character.serverName,
  }
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

function getAdoptStatus(session: AdoptSession) {
  switch (session.phase) {
    case 'complete':
      return 'Adopted subscribed triggers'
    case 'error':
      return 'Unable to adopt subscribed triggers'
    case 'running':
      return 'Adopting subscribed triggers'
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function readExpandedGroups() {
  const database = await openDatabase()

  try {
    return await readCachedStringArray(database, expandedGroupsCacheKey)
  } finally {
    database.close()
  }
}

async function writeExpandedGroups(ids: string[]) {
  const database = await openDatabase()

  try {
    await writeCachedStringArray(database, expandedGroupsCacheKey, ids)
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

function readCachedStringArray(database: IDBDatabase, key: string) {
  return new Promise<string[]>((resolve, reject) => {
    const transaction = database.transaction(userTriggerCacheStoreName, 'readonly')
    const store = transaction.objectStore(userTriggerCacheStoreName)
    const request = store.get(key)

    request.onsuccess = () => {
      resolve(Array.isArray(request.result) ? request.result : [])
    }
    request.onerror = () => reject(request.error ?? new Error('Read failed.'))
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Transaction failed.'))
  })
}

function writeCachedStringArray(
  database: IDBDatabase,
  key: string,
  values: string[],
) {
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(userTriggerCacheStoreName, 'readwrite')
    const store = transaction.objectStore(userTriggerCacheStoreName)
    store.put(values, key)

    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Transaction failed.'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Transaction aborted.'))
  })
}
