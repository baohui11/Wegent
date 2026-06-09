// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Suspense, useState } from 'react'
import dynamic from 'next/dynamic'
import { teamService } from '@/features/tasks/service/teamService'
import TopNavigation from '@/features/layout/TopNavigation'
import { TaskSidebar } from '@/features/tasks/components/sidebar'
import { TaskParamSync, DeviceTaskSync } from '@/features/tasks/components/params'
import { TeamShareHandler } from '@/features/tasks/components/share'
import OidcTokenHandler from '@/features/login/components/OidcTokenHandler'
import '@/app/tasks/tasks.css'
import '@/features/common/scrollbar.css'
import { ThemeToggle } from '@/features/theme/ThemeToggle'
import { useIsMobile } from '@/features/layout/hooks/useMediaQuery'
import { Team } from '@/types/api'
import { UserProvider } from '@/features/common/UserContext'
import { TaskSessionProvider } from '@/features/tasks/session/TaskSession'
import { SocketProvider } from '@/contexts/SocketContext'
import { DeviceProvider } from '@/contexts/DeviceContext'
import { WebSearchResultsProvider } from '@/features/tasks/session/WebSearchResultsContext'
import { WebSearchResultsSync } from '@/features/tasks/components/web-search/WebSearchResultsSync'
import { WebSearchResultsPanel } from '@/features/tasks/components/web-search/WebSearchResultsPanel'
import { useWebSearchResults } from '@/features/tasks/session/WebSearchResultsContext'
import WebSearchPanelToggle from '@/features/layout/WebSearchPanelToggle'
import { useTaskSession } from '@/features/tasks/session/TaskSession'

const ChatArea = dynamic(() => import('@/features/tasks/components/chat/ChatArea'), {
  ssr: false,
})

function TasksPageContent() {
  // Team state from service
  const { teams, isTeamsLoading, refreshTeams } = teamService.useTeams()
  const { selectedTask, selectedTaskDetail } = useTaskSession()
  const {
    sessions: webSearchSessions,
    activeSession,
    hasSessions: hasWebSearchSessions,
    isPanelOpen: isWebSearchPanelOpen,
    openPanel: openWebSearchPanel,
    closePanel: closeWebSearchPanel,
    selectSession: selectWebSearchSession,
  } = useWebSearchResults()

  // Mobile detection
  const isMobile = useIsMobile()

  // Mobile sidebar state
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)

  const handleRefreshTeams = async (): Promise<Team[]> => {
    return await refreshTeams()
  }

  return (
    <>
      {/* Handle OIDC token from URL parameters */}
      <OidcTokenHandler />
      <Suspense>
        <TaskParamSync />
        <DeviceTaskSync />
      </Suspense>
      <Suspense>
        <TeamShareHandler teams={teams} onRefreshTeams={handleRefreshTeams} />
      </Suspense>
      <div className="flex smart-h-screen bg-base text-text-primary box-border">
        {/* Responsive sidebar */}
        <TaskSidebar
          isMobileSidebarOpen={isMobileSidebarOpen}
          setIsMobileSidebarOpen={setIsMobileSidebarOpen}
          pageType="code"
        />
        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top navigation */}
          <TopNavigation
            activePage="code"
            showLogo={false}
            onMobileSidebarToggle={() => setIsMobileSidebarOpen(true)}
          >
            {isMobile && <ThemeToggle />}
            {hasWebSearchSessions && (
              <WebSearchPanelToggle
                isOpen={isWebSearchPanelOpen}
                onOpen={openWebSearchPanel}
                onClose={closeWebSearchPanel}
              />
            )}
          </TopNavigation>
          <WebSearchResultsSync taskId={selectedTask?.id ?? selectedTaskDetail?.id ?? null} />
          <div className="flex flex-1 min-h-0">
            <div
              className="flex flex-col min-h-0 transition-all duration-300 ease-in-out"
              style={{
                width: hasWebSearchSessions && isWebSearchPanelOpen ? '60%' : '100%',
              }}
            >
              <ChatArea
                teams={teams}
                isTeamsLoading={isTeamsLoading}
                selectedTeamForNewTask={null}
                taskType="code"
              />
            </div>
            {hasWebSearchSessions && (
              <WebSearchResultsPanel
                isOpen={isWebSearchPanelOpen}
                onClose={closeWebSearchPanel}
                session={activeSession}
                sessions={webSearchSessions}
                onSelectSession={selectWebSearchSession}
              />
            )}
          </div>
        </div>
      </div>
    </>
  )
}

export default function TasksPage() {
  return (
    <UserProvider>
      <SocketProvider>
        <DeviceProvider>
          <TaskSessionProvider>
            <WebSearchResultsProvider>
              <TasksPageContent />
            </WebSearchResultsProvider>
          </TaskSessionProvider>
        </DeviceProvider>
      </SocketProvider>
    </UserProvider>
  )
}
