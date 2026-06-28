import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import {
  ControlledMenu,
  MenuDivider,
  MenuItem,
  useMenuState,
} from '@szhsin/react-menu'
import { Radio, RadioOff, X } from 'lucide-react'
import Alert from 'react-bootstrap/Alert'
import Button from 'react-bootstrap/Button'
import ButtonGroup from 'react-bootstrap/ButtonGroup'
import Card from 'react-bootstrap/Card'
import Dropdown from 'react-bootstrap/Dropdown'
import Modal from 'react-bootstrap/Modal'
import ProgressBar from 'react-bootstrap/ProgressBar'
import toast from 'react-hot-toast'
import type {
  CharacterPresence,
  SubscribedTriggerEnablementMode,
  SubscriptionDefaultEnablementMode,
} from '../../shared/messages'
import {
  FourStateCheckbox,
  type FourStateCheckboxState,
} from '../../shared/widgets/FourStateCheckbox'
import { BINARY } from '../../shared/widgets/fourStateCheckboxModes'
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
import type { TriggerRevealRequest } from '../model/types'
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
const collapsedGroupSymbol = '\u229e'
const expandedGroupSymbol = '\u229f'

interface SubscribedTriggersViewProps {
  revealRequest?: TriggerRevealRequest | null
  selectedCharacter: CharacterPresence | null
}

interface TreeSelection {
  anchorKey: string | null
  itemKeys: Set<string>
  subscriptionId: string | null
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
  scope: 'selection' | 'subscription'
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

type InheritBadgeState = 'all' | 'none' | 'some'

export function SubscribedTriggersView({
  revealRequest,
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
  const handledRevealRequestIdRef = useRef<number | null>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set())
  const [expandedGroupsLoaded, setExpandedGroupsLoaded] = useState(false)
  const [selection, setSelection] = useState<TreeSelection>(
    createEmptySelection,
  )
  const [pendingScrollItemKey, setPendingScrollItemKey] = useState<string | null>(
    null,
  )
  const [menuTarget, setMenuTarget] = useState<MenuTarget>({
    item: null,
    scope: 'selection',
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

  useEffect(() => {
    if (!revealRequest || revealRequest.target !== 'subscription') {
      return
    }
    if (handledRevealRequestIdRef.current === revealRequest.id) {
      return
    }
    handledRevealRequestIdRef.current = revealRequest.id

    const subscription = snapshots.find(
      (snapshot) => snapshot.id === revealRequest.subscriptionId,
    )
    if (!subscription) {
      toast.error('Subscription is no longer available.')
      return
    }

    const trigger = subscription.triggers.find(
      (candidate) => candidate.trigger.id === revealRequest.triggerId,
    )
    if (!trigger) {
      toast.error('Trigger is no longer available in that subscription.')
      return
    }

    const itemKey = getSubscribedTriggerItemKey(
      revealRequest.subscriptionId,
      revealRequest.triggerId,
    )
    setExpandedGroupIds((current) => {
      const next = new Set(current)
      getSubscriptionAncestorGroupIds(
        revealRequest.subscriptionId,
        trigger.trigger.groupPath,
      ).forEach((groupId) => next.add(groupId))
      return next
    })
    setSelection({
      anchorKey: itemKey,
      itemKeys: new Set([itemKey]),
      subscriptionId: revealRequest.subscriptionId,
    })
    setPendingScrollItemKey(itemKey)
  }, [revealRequest, snapshots])

  useEffect(() => {
    if (!pendingScrollItemKey) {
      return
    }

    const frameId = requestAnimationFrame(() => {
      const row = rowRefs.current.get(pendingScrollItemKey)
      if (!row) {
        return
      }

      row.scrollIntoView({ block: 'center' })
      row.focus({ preventScroll: true })
      setPendingScrollItemKey(null)
    })

    return () => {
      cancelAnimationFrame(frameId)
    }
  }, [pendingScrollItemKey, treeItemsBySubscription])

  function openContextMenu(
    event: MouseEvent,
    subscription: SubscribedTriggerSnapshot,
    item: TreeItem | null,
  ) {
    event.preventDefault()
    event.stopPropagation()
    setMenuTarget({ item, scope: 'selection', subscription })
    setAnchorPoint({ x: event.clientX, y: event.clientY })

    if (item) {
      setSelection((current) => {
        if (
          current.subscriptionId === item.subscriptionId &&
          current.itemKeys.has(getTreeItemKey(item))
        ) {
          return current
        }

        return {
          anchorKey: getTreeItemKey(item),
          itemKeys: new Set([getTreeItemKey(item)]),
          subscriptionId: item.subscriptionId,
        }
      })
    }

    setMenuOpen(true)
  }

  function openSubscriptionContextMenu(
    event: MouseEvent,
    subscription: SubscribedTriggerSnapshot,
  ) {
    event.preventDefault()
    event.stopPropagation()
    setMenuTarget({ item: null, scope: 'subscription', subscription })
    setAnchorPoint({ x: event.clientX, y: event.clientY })
    setMenuOpen(true)
  }

  function handleTreeItemClick(event: MouseEvent, item: TreeItem) {
    setSelection((current) => {
      const itemKey = getTreeItemKey(item)
      if (
        event.shiftKey &&
        current.subscriptionId === item.subscriptionId &&
        current.anchorKey
      ) {
        return {
          anchorKey: current.anchorKey,
          itemKeys: selectItemRange(
            treeItemsBySubscription.get(item.subscriptionId) ?? [],
            current.anchorKey,
            itemKey,
          ),
          subscriptionId: item.subscriptionId,
        }
      }

      if (event.ctrlKey || event.metaKey) {
        const nextItemKeys =
          current.subscriptionId === item.subscriptionId
            ? new Set(current.itemKeys)
            : new Set<string>()

        if (nextItemKeys.has(itemKey)) {
          nextItemKeys.delete(itemKey)
        } else {
          nextItemKeys.add(itemKey)
        }

        if (nextItemKeys.size === 0) {
          return createEmptySelection()
        }

        return {
          anchorKey: getSelectionAnchorKey(nextItemKeys, itemKey),
          itemKeys: nextItemKeys,
          subscriptionId: item.subscriptionId,
        }
      }

      return {
        anchorKey: itemKey,
        itemKeys: new Set([itemKey]),
        subscriptionId: item.subscriptionId,
      }
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

  function collapseAllGroups() {
    setExpandedGroupIds(new Set())
  }

  function collapseSubscriptionGroups(subscriptionId: string) {
    setExpandedGroupIds((current) => {
      const next = new Set(current)
      const prefix = `${subscriptionId}\0`

      next.forEach((groupId) => {
        if (groupId.startsWith(prefix)) {
          next.delete(groupId)
        }
      })

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
    if (!selectedCharacterRecord || state === 'mixed' || state === 'inherit') {
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
    if (!selectedCharacterRecord || state === 'mixed' || state === 'inherit') {
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

  async function handleSelectionEnablement(
    mode: SubscribedTriggerEnablementMode,
  ) {
    if (!selectedCharacterRecord || !menuTarget.subscription) {
      return
    }

    const triggerIds = getTriggerIdsForSelection(
      menuTarget.subscription,
      effectiveMenuSelection,
    )
    for (const triggerId of triggerIds) {
      await setSubscribedTriggerEnablement(
        menuTarget.subscription.id,
        triggerId,
        selectedCharacterRecord,
        mode,
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

    const itemKeys = getEffectiveMenuSelection(menuTarget, selection)
    if (itemKeys.length > 0) {
      void adoptTriggers(
        getAdoptDialogTitle(menuTarget, itemKeys),
        getTriggersForSelection(
          menuTarget.subscription,
          itemKeys,
        ),
      )
    }
  }

  function getSubscriptionDefaultMode(
    subscriptionId: string,
  ): SubscriptionDefaultEnablementMode {
    if (!selectedCharacterKey) {
      return 'disabled'
    }

    return (
      defaultEnablementByKey.get(`${subscriptionId}\0${selectedCharacterKey}`) ===
      'enabled'
        ? 'enabled'
        : 'disabled'
    )
  }

  function getTriggerOverrideMode(
    item: TreeTriggerItem,
  ): SubscribedTriggerEnablementMode {
    return getTriggerOverrideModeById(item.subscriptionId, item.id)
  }

  function getTriggerEffectiveState(
    item: TreeTriggerItem,
  ): FourStateCheckboxState {
    return getTriggerEffectiveStateById(item.subscriptionId, item.id)
  }

  function getTriggerEffectiveStateById(
    subscriptionId: string,
    triggerId: JenaTriggerId,
  ): FourStateCheckboxState {
    const overrideMode = getTriggerOverrideModeById(subscriptionId, triggerId)
    if (overrideMode !== 'inherit') {
      return overrideMode
    }

    return getSubscriptionDefaultMode(subscriptionId) === 'enabled'
      ? 'enabled'
      : 'disabled'
  }

  function getTriggerOverrideModeById(
    subscriptionId: string,
    triggerId: JenaTriggerId,
  ): SubscribedTriggerEnablementMode {
    if (!selectedCharacterKey) {
      return 'inherit'
    }

    return (
      triggerEnablementByKey.get(
        `${subscriptionId}\0${triggerId}\0${selectedCharacterKey}`,
      ) ?? 'inherit'
    )
  }

  function getGroupEffectiveState(
    subscription: SubscribedTriggerSnapshot,
    item: TreeGroupItem,
  ): FourStateCheckboxState {
    if (!selectedCharacterKey) {
      return 'disabled'
    }

    const triggerIds = getTriggerIdsUnderPath(subscription.triggers, item.path)
    if (triggerIds.length === 0) {
      return 'disabled'
    }

    const states = new Set(
      triggerIds.map((triggerId) =>
        getTriggerEffectiveStateById(subscription.id, triggerId),
      ),
    )

    return states.size === 1 ? ([...states][0] as FourStateCheckboxState) : 'mixed'
  }

  function getTriggerInheritBadgeState(item: TreeTriggerItem): InheritBadgeState {
    return getTriggerOverrideMode(item) === 'inherit' ? 'all' : 'none'
  }

  function getGroupInheritBadgeState(
    subscription: SubscribedTriggerSnapshot,
    item: TreeGroupItem,
  ): InheritBadgeState {
    if (!selectedCharacterKey) {
      return 'all'
    }

    const triggerIds = getTriggerIdsUnderPath(subscription.triggers, item.path)
    if (triggerIds.length === 0) {
      return 'none'
    }

    const inheritCount = triggerIds.filter((triggerId) => {
      return (
        (triggerEnablementByKey.get(
          `${subscription.id}\0${triggerId}\0${selectedCharacterKey}`,
        ) ?? 'inherit') === 'inherit'
      )
    }).length

    if (inheritCount === 0) {
      return 'none'
    }

    return inheritCount === triggerIds.length ? 'all' : 'some'
  }

  const menuTrigger =
    menuTarget.item?.type === 'trigger' ? menuTarget.item : null
  const menuGroup =
    menuTarget.item?.type === 'group' ? menuTarget.item : null
  const effectiveMenuSelection = getEffectiveMenuSelection(
    menuTarget,
    selection,
  )

  return (
    <section className="subscribed-triggers-view" aria-label="Subscribed triggers">
      <header className="subscribed-triggers-header">
        <h2>Subscriptions</h2>
        <Button
          className="subscribed-triggers-collapse-all"
          disabled={expandedGroupIds.size === 0}
          onClick={collapseAllGroups}
          size="sm"
          variant="outline-secondary"
        >
          Collapse all
        </Button>
      </header>

      <div className="subscribed-triggers-body">
        {orderedSnapshots.length === 0 ? (
          <div className="subscribed-triggers-empty">No subscriptions</div>
        ) : (
          <div className="subscribed-triggers-list">
            {orderedSnapshots.map((subscription) => {
              const treeItems = treeItemsBySubscription.get(subscription.id) ?? []
              const defaultMode = getSubscriptionDefaultMode(subscription.id)
              const trustPublisher = defaultMode === 'enabled'

              return (
                <Card className="subscribed-triggers-card" key={subscription.id}>
                  <Card.Header
                    className="subscribed-triggers-card-header"
                    onContextMenu={(event) =>
                      openSubscriptionContextMenu(event, subscription)
                    }
                  >
                    <Dropdown as={ButtonGroup} className="subscribed-triggers-policy">
                      <Dropdown.Toggle
                        disabled={!selectedCharacterRecord}
                        id={`subscription-policy-${subscription.id}`}
                        size="sm"
                        title={
                          selectedCharacterRecord
                            ? trustPublisher
                              ? 'New triggers from this publisher are enabled automatically unless you turn them off.'
                              : 'New triggers from this publisher stay off until you enable them.'
                            : 'Select a character to change enablement'
                        }
                        variant="outline-secondary"
                      >
                        Trust: {trustPublisher ? 'Trust publisher' : 'Review first'}
                      </Dropdown.Toggle>
                      <Dropdown.Menu>
                        <Dropdown.Item
                          active={!trustPublisher}
                          onClick={() => {
                            void handleDefaultToggle(subscription, false)
                          }}
                        >
                          Review first
                        </Dropdown.Item>
                        <Dropdown.Item
                          active={trustPublisher}
                          onClick={() => {
                            void handleDefaultToggle(subscription, true)
                          }}
                        >
                          Trust publisher
                        </Dropdown.Item>
                      </Dropdown.Menu>
                    </Dropdown>
                    <span className="subscribed-triggers-publisher-name">
                      {subscription.ownerDisplayName || 'Anonymous publisher'}
                    </span>
                    <span className="subscribed-triggers-card-actions">
                      <Button
                        disabled={!hasExpandedSubscriptionGroup(
                          expandedGroupIds,
                          subscription.id,
                        )}
                        onClick={() => collapseSubscriptionGroups(subscription.id)}
                        size="sm"
                        title="Collapse this subscription"
                        variant="outline-secondary"
                      >
                        Collapse all
                      </Button>
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
                    </span>
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
                              checkboxState={getGroupEffectiveState(
                                subscription,
                                item,
                              )}
                              collapsed={!expandedGroupIds.has(item.id)}
                              inheritBadgeState={getGroupInheritBadgeState(
                                subscription,
                                item,
                              )}
                              item={item}
                              key={item.id}
                              onContextMenu={(event, rowItem) =>
                                openContextMenu(event, subscription, rowItem)
                              }
                              onSelect={handleTreeItemClick}
                              onToggle={toggleGroup}
                              onToggleChecked={(state) => {
                                void handleGroupEnablement(
                                  subscription,
                                  item,
                                  state,
                                )
                              }}
                              selected={
                                isItemSelected(selection, item)
                              }
                            />
                          ) : (
                            <SubscribedTriggerRow
                              checkboxDisabled={!selectedCharacterRecord}
                              checkboxState={getTriggerEffectiveState(item)}
                              inheritBadgeState={getTriggerInheritBadgeState(item)}
                              item={item}
                              key={item.id}
                              onClick={handleTreeItemClick}
                              onContextMenu={(event, rowItem) =>
                                openContextMenu(event, subscription, rowItem)
                              }
                              onDoubleClick={(trigger) => setViewTrigger(trigger)}
                              onToggleChecked={(state) => {
                                void handleTriggerEnablement(item, state)
                              }}
                              rowRef={(node) => {
                                setSubscribedRowRef(
                                  rowRefs.current,
                                  getTreeItemKey(item),
                                  node,
                                )
                              }}
                              selected={
                                isItemSelected(selection, item)
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
          {getAdoptMenuLabel(menuTarget, effectiveMenuSelection)}
        </MenuItem>
        <MenuDivider />
        <MenuItem
          className="subscribed-triggers-menu-heading"
          disabled
        >
          {getTriggerSettingsHeading(menuTarget, effectiveMenuSelection)}
        </MenuItem>
        <MenuItem
          disabled={
            !selectedCharacterRecord ||
            !menuTarget.subscription ||
            effectiveMenuSelection.length === 0
          }
          onClick={() => {
            void handleSelectionEnablement('inherit')
          }}
        >
          Follow trust setting
        </MenuItem>
        <MenuItem
          disabled={
            !selectedCharacterRecord ||
            !menuTarget.subscription ||
            effectiveMenuSelection.length === 0
          }
          onClick={() => {
            void handleSelectionEnablement('enabled')
          }}
        >
          {getEnablementMenuLabel(
            menuTarget,
            effectiveMenuSelection,
            'enabled',
          )}
        </MenuItem>
        <MenuItem
          disabled={
            !selectedCharacterRecord ||
            !menuTarget.subscription ||
            effectiveMenuSelection.length === 0
          }
          onClick={() => {
            void handleSelectionEnablement('disabled')
          }}
        >
          {getEnablementMenuLabel(
            menuTarget,
            effectiveMenuSelection,
            'disabled',
          )}
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
  inheritBadgeState,
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
  inheritBadgeState: InheritBadgeState
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
          {item.childCount > 0 ? (collapsed ? collapsedGroupSymbol : expandedGroupSymbol) : ''}
        </button>
        <FourStateCheckbox
          ariaLabel={`Enable triggers in ${item.name}`}
          disabled={checkboxDisabled || item.triggerCount === 0}
          mode={BINARY}
          onChange={onToggleChecked}
          state={checkboxState}
          title={getEffectiveCheckboxTitle(checkboxState, true)}
        />
        <span className="subscribed-triggers-group-name">{item.name}</span>
        <InheritBadge state={inheritBadgeState} />
      </span>
    </div>
  )
}

function SubscribedTriggerRow({
  checkboxDisabled,
  checkboxState,
  inheritBadgeState,
  item,
  onClick,
  onContextMenu,
  onDoubleClick,
  onToggleChecked,
  rowRef,
  selected,
}: {
  checkboxDisabled: boolean
  checkboxState: FourStateCheckboxState
  inheritBadgeState: InheritBadgeState
  item: TreeTriggerItem
  onClick: (event: MouseEvent, item: TreeTriggerItem) => void
  onContextMenu: (event: MouseEvent, item: TreeItem) => void
  onDoubleClick: (trigger: JenaTrigger) => void
  onToggleChecked: (state: FourStateCheckboxState) => void
  rowRef: (node: HTMLDivElement | null) => void
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
      ref={rowRef}
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
          mode={BINARY}
          onChange={onToggleChecked}
          state={checkboxState}
          title={getEffectiveCheckboxTitle(checkboxState, false)}
        />
        <span className="subscribed-triggers-trigger-name">
          {item.trigger.trigger.name || '(unnamed trigger)'}
        </span>
        <InheritBadge state={inheritBadgeState} />
      </span>
      <span className="subscribed-triggers-row-side">
        <BroadcastIndicator broadcastToSubscribers={item.trigger.broadcastToSubscribers} />
      </span>
    </div>
  )
}

function InheritBadge({ state }: { state: InheritBadgeState }) {
  if (state === 'none') {
    return null
  }

  return (
    <span
      className="subscribed-triggers-auto-badge"
      title={
        state === 'all'
          ? 'Following subscription setting'
          : 'Some triggers are following the subscription setting'
      }
    >
      {state === 'all' ? 'auto' : 'some auto'}
    </span>
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

function getTriggersForSelection(
  subscription: SubscribedTriggerSnapshot,
  itemKeys: string[],
) {
  const selectedTriggerIds = getTriggerIdsForSelection(subscription, itemKeys)

  return subscription.triggers
    .map((trigger) => trigger.trigger)
    .filter((trigger) => selectedTriggerIds.includes(trigger.id))
    .sort(compareTriggersByPath)
}

function getTriggerIdsForSelection(
  subscription: SubscribedTriggerSnapshot,
  itemKeys: string[],
) {
  const selectedTriggerIds = new Set<JenaTriggerId>()
  const selectedGroupPaths: string[][] = []

  itemKeys.forEach((itemKey) => {
    const triggerId = getTriggerIdFromItemKey(itemKey, subscription.id)
    if (triggerId) {
      selectedTriggerIds.add(triggerId)
      return
    }

    const groupPath = getGroupPathFromItemKey(itemKey, subscription.id)
    if (groupPath) {
      selectedGroupPaths.push(groupPath)
    }
  })

  return subscription.triggers
    .filter(
      (trigger) =>
        selectedTriggerIds.has(trigger.trigger.id) ||
        selectedGroupPaths.some((path) =>
          isSameOrChildPath(trigger.trigger.groupPath, path),
        ),
    )
    .map((trigger) => trigger.trigger.id)
}

function getEffectiveMenuSelection(
  menuTarget: MenuTarget,
  selection: TreeSelection,
) {
  const { item, subscription } = menuTarget

  if (item) {
    const itemKey = getTreeItemKey(item)
    if (
      selection.subscriptionId === item.subscriptionId &&
      selection.itemKeys.has(itemKey)
    ) {
      return [...selection.itemKeys]
    }

    return [itemKey]
  }

  if (!subscription) {
    return []
  }

  if (menuTarget.scope === 'subscription') {
    return subscription.triggers.map((trigger) =>
      getSubscribedTriggerItemKey(subscription.id, trigger.trigger.id),
    )
  }

  if (selection.subscriptionId !== subscription.id) {
    return []
  }

  return [...selection.itemKeys]
}

function selectItemRange(
  treeItems: TreeItem[],
  anchorKey: string,
  targetKey: string,
) {
  const itemOrder = treeItems.map(getTreeItemKey)
  const anchorIndex = itemOrder.indexOf(anchorKey)
  const targetIndex = itemOrder.indexOf(targetKey)

  if (anchorIndex < 0 || targetIndex < 0) {
    return new Set([targetKey])
  }

  const start = Math.min(anchorIndex, targetIndex)
  const end = Math.max(anchorIndex, targetIndex)

  return new Set(itemOrder.slice(start, end + 1))
}

function getSelectionAnchorKey(
  itemKeys: Set<string>,
  preferred: string | null,
) {
  if (preferred && itemKeys.has(preferred)) {
    return preferred
  }

  return [...itemKeys][0] ?? null
}

function getAdoptDialogTitle(menuTarget: MenuTarget, itemKeys: string[]) {
  if (menuTarget.scope === 'subscription') {
    return 'Adopt Subscription'
  }

  if (itemKeys.length === 1 && itemKeys[0]?.startsWith('group\0')) {
    return 'Adopt Group'
  }

  if (itemKeys.length === 1 && itemKeys[0]?.startsWith('trigger\0')) {
    return 'Adopt Trigger'
  }

  return 'Adopt Selection'
}

function getAdoptMenuLabel(menuTarget: MenuTarget, itemKeys: string[]) {
  const { item } = menuTarget

  if (menuTarget.scope === 'subscription') {
    return "Adopt all this subscription's triggers"
  }

  if (itemKeys.length === 1) {
    const itemKey = itemKeys[0]
    if (itemKey?.startsWith('group\0') || item?.type === 'group') {
      return 'Adopt this group'
    }
    if (itemKey?.startsWith('trigger\0') || item?.type === 'trigger') {
      return 'Adopt this trigger'
    }
  }

  return 'Adopt selected triggers'
}

function getTriggerSettingsHeading(
  menuTarget: MenuTarget,
  itemKeys: string[],
) {
  if (isSingleTriggerMenuTarget(menuTarget, itemKeys)) {
    return 'Trigger setting:'
  }

  return 'Trigger settings:'
}

function isSingleTriggerMenuTarget(
  menuTarget: MenuTarget,
  itemKeys: string[],
) {
  if (itemKeys.length !== 1) {
    return false
  }

  const itemKey = itemKeys[0]
  return itemKey?.startsWith('trigger\0') || menuTarget.item?.type === 'trigger'
}

function getEnablementMenuLabel(
  menuTarget: MenuTarget,
  itemKeys: string[],
  mode: Extract<SubscribedTriggerEnablementMode, 'disabled' | 'enabled'>,
) {
  const { item } = menuTarget

  if (menuTarget.scope === 'subscription') {
    return mode === 'enabled' ? 'Force enable all' : 'Force disable all'
  }

  const action = mode === 'enabled' ? 'Always enable' : 'Always disable'

  if (itemKeys.length === 1) {
    const itemKey = itemKeys[0]
    if (itemKey?.startsWith('group\0') || item?.type === 'group') {
      return `${action} group`
    }
    if (itemKey?.startsWith('trigger\0') || item?.type === 'trigger') {
      return `${action} trigger`
    }
  }

  return `${action} selected`
}

function getEffectiveCheckboxTitle(
  state: FourStateCheckboxState,
  group: boolean,
) {
  switch (state) {
    case 'disabled':
      return group
        ? 'Disabled. Click to always enable all triggers in this group.'
        : 'Disabled. Click to always enable this trigger.'
    case 'enabled':
      return group
        ? 'Enabled. Click to always disable all triggers in this group.'
        : 'Enabled. Click to always disable this trigger.'
    case 'mixed':
      return 'Some triggers are enabled and some are disabled. Click to always enable all.'
    case 'inherit':
      return 'Following subscription setting.'
  }
}

function createEmptySelection(): TreeSelection {
  return {
    anchorKey: null,
    itemKeys: new Set(),
    subscriptionId: null,
  }
}

function isItemSelected(selection: TreeSelection, item: TreeItem) {
  return (
    selection.subscriptionId === item.subscriptionId &&
    selection.itemKeys.has(getTreeItemKey(item))
  )
}

function getTreeItemKey(item: TreeItem) {
  if (item.type === 'group') {
    return `group\0${item.id}`
  }

  return getSubscribedTriggerItemKey(item.subscriptionId, item.id)
}

function getSubscribedTriggerItemKey(
  subscriptionId: string,
  triggerId: JenaTriggerId,
) {
  return `trigger\0${subscriptionId}\0${triggerId}`
}

function getTriggerIdFromItemKey(itemKey: string, subscriptionId: string) {
  const prefix = `trigger\0${subscriptionId}\0`
  if (!itemKey.startsWith(prefix)) {
    return null
  }

  return itemKey.slice(prefix.length) as JenaTriggerId
}

function getGroupPathFromItemKey(itemKey: string, subscriptionId: string) {
  const prefix = `group\0${subscriptionId}\0`
  if (!itemKey.startsWith(prefix)) {
    return null
  }

  const pathText = itemKey.slice(prefix.length)
  return pathText ? pathText.split('\0') : null
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

function getSubscriptionAncestorGroupIds(
  subscriptionId: string,
  path: string[],
) {
  return path.map((_, index) =>
    getSubscriptionGroupId(subscriptionId, path.slice(0, index + 1)),
  )
}

function hasExpandedSubscriptionGroup(
  expandedGroupIds: Set<string>,
  subscriptionId: string,
) {
  const prefix = `${subscriptionId}\0`
  return [...expandedGroupIds].some((groupId) => groupId.startsWith(prefix))
}

function setSubscribedRowRef(
  refs: Map<string, HTMLDivElement>,
  itemKey: string,
  node: HTMLDivElement | null,
) {
  if (node) {
    refs.set(itemKey, node)
  } else {
    refs.delete(itemKey)
  }
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
