import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CockpitDashboard } from '@/components/cockpit/CockpitDashboard'
import { CockpitTopBar } from '@/components/cockpit/CockpitTopBar'
import { MobileCockpitTabs } from '@/components/cockpit/MobileCockpitTabs'
import type { CockpitMobileMode } from '@/components/cockpit/MobileCockpitTabs'
import { CreateIssueDialog } from '@/components/kanban/CreateIssueDialog'
import { ChatArea } from '@/components/issue-detail/ChatArea'
import { ListPanelGhost } from '@/components/issue-detail/ListPanelGhost'
import { ReviewListPanel } from '@/components/issue-detail/ReviewListPanel'
import { AppSidebar } from '@/components/kanban/AppSidebar'
import { MobileSidebar } from '@/components/kanban/MobileSidebar'
import { useReviewIssues } from '@/hooks/use-kanban'
import { useIsMobile } from '@/hooks/use-mobile'
import { useDockStore } from '@/stores/dock-store'
import { useViewModeStore } from '@/stores/view-mode-store'

const SIDEBAR_EXPANDED_WIDTH = 56
const SIDEBAR_COLLAPSED_WIDTH = 28
const MIN_CHAT_WIDTH = 300
const DEFAULT_LIST_WIDTH = 232
const MIN_LIST_WIDTH = 180
const MAX_LIST_WIDTH = 400

const DEFAULT_COCKPIT_STATUSES = ['working', 'review']

export default function ReviewPage() {
  const { projectAlias = '', issueId = '' } = useParams<{
    projectAlias: string
    issueId: string
  }>()

  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(DEFAULT_COCKPIT_STATUSES)
  const [mobileMode, setMobileMode] = useState<CockpitMobileMode>('list')
  const { data: reviewIssues } = useReviewIssues(selectedStatuses)

  // Find the matching issue to get its projectId (alias)
  const activeIssue = reviewIssues?.find(i => i.id === issueId)
  const projectId = activeIssue?.projectAlias ?? projectAlias

  const dockOpen = useDockStore(s => s.open)
  const dockCollapsed = useDockStore(s => s.collapsed)
  const dockWidth = useDockStore(s => s.width)
  const railSpace = dockOpen ? (dockCollapsed ? 48 : dockWidth) : 0
  const [listWidth, setListWidth] = useState(DEFAULT_LIST_WIDTH)
  const isResizingList = useRef(false)
  const isMobile = useIsMobile()
  const sidebarCollapsed = useViewModeStore(s => s.sidebarCollapsed)
  const sidebarWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH
  const listPanelCollapsed = useViewModeStore(s => s.listPanelCollapsed)
  const toggleListPanel = useViewModeStore(s => s.toggleListPanel)

  const handleListResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isResizingList.current = true
      const startX = e.clientX
      const startWidth = listWidth

      const onMouseMove = (ev: MouseEvent) => {
        if (!isResizingList.current) return
        const delta = ev.clientX - startX
        const viewport = typeof window !== 'undefined' ? window.innerWidth : 1600
        const dynamicMax = Math.min(
          MAX_LIST_WIDTH,
          viewport - sidebarWidth - railSpace - MIN_CHAT_WIDTH,
        )
        const newWidth = Math.min(dynamicMax, Math.max(MIN_LIST_WIDTH, startWidth + delta))
        setListWidth(newWidth)
      }

      const onMouseUp = () => {
        isResizingList.current = false
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [listWidth, railSpace, sidebarWidth],
  )

  const availableWidth = typeof window !== 'undefined' ? window.innerWidth - sidebarWidth : 1200
  const hideListPanel = (isMobile && !!issueId) || (railSpace > availableWidth * 0.5)
  const showMobileCockpit = isMobile && !issueId && mobileMode === 'cockpit'

  useEffect(() => {
    if (railSpace === 0) return
    const viewport = typeof window !== 'undefined' ? window.innerWidth : 1600
    const maxList = Math.min(MAX_LIST_WIDTH, viewport - sidebarWidth - railSpace - MIN_CHAT_WIDTH)
    setListWidth(prev => Math.max(MIN_LIST_WIDTH, Math.min(prev, maxList)))
  }, [railSpace, sidebarWidth])

  return (
    <div className="flex h-full text-foreground overflow-hidden animate-page-enter">
      {!isMobile ? <AppSidebar activeProjectId="" /> : null}

      {/* CreateIssueDialog mounted at cockpit root so the panel-store +
          ⌘N hooks can open it from any cockpit state (TopBar, RecentTabs,
          AssistantPanel etc.). The dialog itself reads `projectId` from
          useParams — falls back to "default" when none. */}
      <CreateIssueDialog />

      {!hideListPanel && !showMobileCockpit ?
          (isMobile || !listPanelCollapsed ?
              (
                <ReviewListPanel
                  activeIssueId={issueId}
                  width={isMobile ? undefined : listWidth}
                  onResizeStart={isMobile ? undefined : handleListResizeStart}
                  mobileNav={isMobile ? <MobileSidebar activeProjectId="" /> : undefined}
                  statuses={selectedStatuses}
                  onStatusesChange={setSelectedStatuses}
                  headerExtra={isMobile ?
                      <MobileCockpitTabs mode={mobileMode} onChange={setMobileMode} /> :
                    undefined}
                  onCollapse={isMobile ? undefined : toggleListPanel}
                />
              ) :
              <ListPanelGhost onExpand={toggleListPanel} />) :
        null}

      {showMobileCockpit ?
          (
            <div className="flex flex-1 flex-col min-w-0 h-full bg-background">
              <div className="flex items-center gap-2 px-2.5 py-2 border-b border-border/60 shrink-0">
                <MobileSidebar activeProjectId="" />
                <div className="flex-1">
                  <MobileCockpitTabs mode={mobileMode} onChange={setMobileMode} />
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                <CockpitDashboard />
              </div>
            </div>
          ) :
        null}

      {/* Main column: TopBar (desktop only) + chat/dashboard.
          Skipped when the mobile-cockpit branch already owns the main area.
          TopBar is desktop-only — mobile relies on segmented control + FAB
          cluster, adding TopBar would clutter further. RecentTabs was
          removed; the left ReviewListPanel already covers in-project
          navigation, and cross-project jumps go through ⌘K. */}
      {!showMobileCockpit ?
          (
            <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
              {!isMobile ? <CockpitTopBar /> : null}
              {issueId && projectId ?
                  (
                    <ChatArea
                      key={issueId}
                      projectId={projectId}
                      issueId={issueId}
                      showBackToList
                      backPath="/review"
                      // CockpitTopBar already owns the breadcrumb, title
                      // editor, copy-link, and back-to-cockpit action on
                      // desktop. Mobile cockpit has no TopBar, so keep the
                      // in-chat title bar as the only identity surface.
                      hideTitleBar={!isMobile}
                    />
                  ) :
                  !isMobile && !hideListPanel ?
                      <CockpitDashboard /> :
                    null}
            </div>
          ) :
        null}
    </div>
  )
}
