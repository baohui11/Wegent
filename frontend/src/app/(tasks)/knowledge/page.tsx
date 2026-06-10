// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Suspense, useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import TopNavigation from '@/features/layout/TopNavigation'
import {
  TaskSidebar,
  ResizableSidebar,
  CollapsedSidebarButtons,
} from '@/features/tasks/components/sidebar'
import { TaskParamSync } from '@/features/tasks/components/params'
import '@/app/tasks/tasks.css'
import '@/features/common/scrollbar.css'
import { ThemeToggle } from '@/features/theme/ThemeToggle'
import { saveLastTab } from '@/utils/userPreferences'
import { useIsMobile } from '@/features/layout/hooks/useMediaQuery'
import { useTaskSession } from '@/features/tasks/session/TaskSession'
import { paths } from '@/config/paths'
import { Spinner } from '@/components/ui/spinner'
import { KnowledgeTabs } from '@/features/knowledge/KnowledgeTabs'

const KnowledgeDocumentPage = dynamic(
  () =>
    import('@/features/knowledge/document/components/KnowledgeDocumentPage').then(mod => ({
      default: mod.KnowledgeDocumentPage,
    })),
  { ssr: false }
)

// Storage key for knowledge sidebar collapsed state
const KNOWLEDGE_SIDEBAR_COLLAPSED_KEY = 'knowledge-sidebar-collapsed'

// Main knowledge page content with URL parameter support
function KnowledgePageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { selectTask } = useTaskSession()
  const isMobile = useIsMobile()

  // Mobile sidebar state
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)

  // Collapsed sidebar state (task sidebar)
  const [isCollapsed, setIsCollapsed] = useState(false)

  // Knowledge sidebar collapsed state (for document tab)
  // This is synced with KnowledgeDocumentPageDesktop via localStorage and custom events
  const [isKnowledgeSidebarCollapsed, setIsKnowledgeSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(KNOWLEDGE_SIDEBAR_COLLAPSED_KEY) === 'true'
    }
    return false
  })

  // Listen for knowledge sidebar collapse changes from KnowledgeDocumentPageDesktop
  useEffect(() => {
    const handleCollapseChange = (event: CustomEvent<{ collapsed: boolean }>) => {
      setIsKnowledgeSidebarCollapsed(event.detail.collapsed)
    }

    window.addEventListener(
      'knowledge-sidebar-collapse-change',
      handleCollapseChange as EventListener
    )

    return () => {
      window.removeEventListener(
        'knowledge-sidebar-collapse-change',
        handleCollapseChange as EventListener
      )
    }
  }, [])

  // Handle expanding the knowledge sidebar from TopNavigation
  const handleExpandKnowledgeSidebar = useCallback(() => {
    setIsKnowledgeSidebarCollapsed(false)
    localStorage.setItem(KNOWLEDGE_SIDEBAR_COLLAPSED_KEY, 'false')
    // Dispatch event to notify KnowledgeDocumentPageDesktop
    window.dispatchEvent(
      new CustomEvent('knowledge-sidebar-collapse-change', { detail: { collapsed: false } })
    )
  }, [])

  // Redirect legacy code knowledge URLs to document tab
  useEffect(() => {
    if (searchParams.get('type') === 'code') {
      router.replace('?type=document')
    }
  }, [searchParams, router])

  // Handle knowledge type tab change with URL update
  const handleTabChange = useCallback(() => {
    router.replace('?type=document')
  }, [router])

  // Load collapsed state from localStorage
  useEffect(() => {
    const savedCollapsed = localStorage.getItem('task-sidebar-collapsed')
    if (savedCollapsed === 'true') {
      setIsCollapsed(true)
    }
  }, [])

  useEffect(() => {
    saveLastTab('wiki')
  }, [])

  const handleToggleCollapsed = () => {
    setIsCollapsed(prev => {
      const newValue = !prev
      localStorage.setItem('task-sidebar-collapsed', String(newValue))
      return newValue
    })
  }

  // Handle new task from collapsed sidebar button
  const handleNewTask = () => {
    // IMPORTANT: Clear selected task FIRST to ensure UI state is reset immediately
    // This prevents the UI from being stuck showing the previous task's messages
    selectTask(null)
    router.replace(paths.chat.getHref())
  }

  return (
    <div className="flex smart-h-screen bg-base text-text-primary box-border">
      {/* TaskParamSync handles URL taskId parameter synchronization with TaskSessionContext */}
      <Suspense>
        <TaskParamSync />
      </Suspense>

      {/* Collapsed sidebar floating buttons */}
      {isCollapsed && !isMobile && (
        <CollapsedSidebarButtons onExpand={handleToggleCollapsed} onNewTask={handleNewTask} />
      )}

      {/* Responsive resizable sidebar */}
      <ResizableSidebar isCollapsed={isCollapsed} onToggleCollapsed={handleToggleCollapsed}>
        <TaskSidebar
          isMobileSidebarOpen={isMobileSidebarOpen}
          setIsMobileSidebarOpen={setIsMobileSidebarOpen}
          pageType="knowledge"
          isCollapsed={isCollapsed}
          onToggleCollapsed={handleToggleCollapsed}
        />
      </ResizableSidebar>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top navigation with integrated knowledge tabs */}
        <TopNavigation
          activePage="wiki"
          variant="with-sidebar"
          centerContent={
            <KnowledgeTabs
              activeTab="document"
              onTabChange={handleTabChange}
              isKnowledgeSidebarCollapsed={isKnowledgeSidebarCollapsed}
              onExpandClick={handleExpandKnowledgeSidebar}
            />
          }
          onMobileSidebarToggle={() => setIsMobileSidebarOpen(true)}
          isSidebarCollapsed={isCollapsed}
        >
          {isMobile && <ThemeToggle />}
        </TopNavigation>

        {/* Document knowledge - no padding, full height */}
        <div className="flex-1 flex flex-col min-h-0">
          <KnowledgeDocumentPage />
        </div>
      </div>
    </div>
  )
}

// Page component with Suspense wrapper for useSearchParams
export default function KnowledgePage() {
  return (
    <Suspense
      fallback={
        <div className="flex smart-h-screen bg-base text-text-primary items-center justify-center">
          <Spinner />
        </div>
      }
    >
      <KnowledgePageContent />
    </Suspense>
  )
}
