// SPDX-License-Identifier: Apache-2.0

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ProjectListScreen } from '@/features/bid/components/ProjectListScreen'
import { bidApis, type BidProject } from '@/apis/bid'

jest.mock('@/apis/bid')
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}))
jest.mock('@/features/common/UserContext', () => ({
  useUser: () => ({ user: { user_name: 'tester', real_name: '测试用户', department_name: null } }),
}))

const proj = (over: Partial<BidProject>): BidProject => ({
  id: 1,
  title: '政务数据中心',
  current_phase: 4,
  max_phase_reached: 4,
  status: 'drafting',
  created_at: '2026-07-03T09:00:00Z',
  ...over,
})

beforeEach(() => jest.clearAllMocks())

it('renders projects and opens one on click', async () => {
  ;(bidApis.listProjects as jest.Mock).mockResolvedValue([proj({ id: 1 }), proj({ id: 2 })])
  const onOpen = jest.fn()
  render(<ProjectListScreen onOpen={onOpen} onNew={jest.fn()} />)
  await screen.findByTestId('bid-project-card-1')
  fireEvent.click(screen.getByTestId('bid-project-card-2'))
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
})

it('deletes a project after confirm and removes its card', async () => {
  ;(bidApis.listProjects as jest.Mock).mockResolvedValue([proj({ id: 1 }), proj({ id: 2 })])
  ;(bidApis.deleteProject as jest.Mock).mockResolvedValue({ status: 'deleted' })
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)
  render(<ProjectListScreen onOpen={jest.fn()} onNew={jest.fn()} />)
  await screen.findByTestId('bid-project-card-2')
  fireEvent.click(screen.getByTestId('bid-project-delete-2'))
  await waitFor(() => expect(bidApis.deleteProject).toHaveBeenCalledWith(2))
  await waitFor(() => expect(screen.queryByTestId('bid-project-card-2')).not.toBeInTheDocument())
  expect(screen.getByTestId('bid-project-card-1')).toBeInTheDocument()
  confirmSpy.mockRestore()
})

it('does not delete when confirm is cancelled', async () => {
  ;(bidApis.listProjects as jest.Mock).mockResolvedValue([proj({ id: 1 })])
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)
  render(<ProjectListScreen onOpen={jest.fn()} onNew={jest.fn()} />)
  await screen.findByTestId('bid-project-card-1')
  fireEvent.click(screen.getByTestId('bid-project-delete-1'))
  expect(bidApis.deleteProject).not.toHaveBeenCalled()
  confirmSpy.mockRestore()
})

it('shows empty state when there are no projects', async () => {
  ;(bidApis.listProjects as jest.Mock).mockResolvedValue([])
  render(<ProjectListScreen onOpen={jest.fn()} onNew={jest.fn()} />)
  await screen.findByTestId('bid-projects-empty')
})

it('fires onNew from the new button', async () => {
  ;(bidApis.listProjects as jest.Mock).mockResolvedValue([])
  const onNew = jest.fn()
  render(<ProjectListScreen onOpen={jest.fn()} onNew={onNew} />)
  await screen.findByTestId('bid-projects-empty')
  fireEvent.click(screen.getByTestId('bid-new-project-button'))
  expect(onNew).toHaveBeenCalled()
})

it('shows error + retry, and retries on click', async () => {
  ;(bidApis.listProjects as jest.Mock)
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValueOnce([proj({ id: 3 })])
  render(<ProjectListScreen onOpen={jest.fn()} onNew={jest.fn()} />)
  await screen.findByTestId('bid-projects-error')
  fireEvent.click(screen.getByTestId('bid-projects-retry'))
  await screen.findByTestId('bid-project-card-3')
})
