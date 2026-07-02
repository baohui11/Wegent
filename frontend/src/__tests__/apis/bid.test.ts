// SPDX-License-Identifier: Apache-2.0

import { bidApis } from '@/apis/bid'
import { apiClient } from '@/apis/client'

jest.mock('@/apis/client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
}))

describe('bidApis', () => {
  it('createProject posts to /bid/projects', async () => {
    ;(apiClient.post as jest.Mock).mockResolvedValue({ id: 1, title: 'A' })
    const p = await bidApis.createProject('A')
    expect(apiClient.post).toHaveBeenCalledWith('/bid/projects', { title: 'A' })
    expect(p.id).toBe(1)
  })

  it('parse posts tender_text', async () => {
    ;(apiClient.post as jest.Mock).mockResolvedValue({ status: 'parsed' })
    await bidApis.parse(3, '正文')
    expect(apiClient.post).toHaveBeenCalledWith('/bid/projects/3/parse', {
      tender_text: '正文',
    })
  })

  it('getTender gets tender doc', async () => {
    ;(apiClient.get as jest.Mock).mockResolvedValue({ tender: { scoring: [] } })
    const r = await bidApis.getTender(3)
    expect(apiClient.get).toHaveBeenCalledWith('/bid/projects/3/tender')
    expect(r.tender.scoring).toEqual([])
  })
})
