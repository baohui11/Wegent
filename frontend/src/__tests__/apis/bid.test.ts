// SPDX-License-Identifier: Apache-2.0

import { bidApis } from '@/apis/bid'
import { apiClient } from '@/apis/client'

jest.mock('@/apis/client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
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

  it('buildOutline posts to /outline', async () => {
    ;(apiClient.post as jest.Mock).mockResolvedValue({
      outline: { sections: [] },
      coverage: {},
    })
    await bidApis.buildOutline(5)
    expect(apiClient.post).toHaveBeenCalledWith('/bid/projects/5/outline')
  })

  it('saveOutline puts outline', async () => {
    ;(apiClient.put as jest.Mock).mockResolvedValue({ outline: {}, coverage: {} })
    await bidApis.saveOutline(5, { sections: [] })
    expect(apiClient.put).toHaveBeenCalledWith('/bid/projects/5/outline', {
      outline: { sections: [] },
    })
  })

  it('declarePackage posts package', async () => {
    ;(apiClient.post as jest.Mock).mockResolvedValue({ status: 'declared' })
    await bidApis.declarePackage(5, '包件二')
    expect(apiClient.post).toHaveBeenCalledWith('/bid/projects/5/package', {
      package: '包件二',
    })
  })

  it('saveKnowledgeBase puts wrapped body', async () => {
    ;(apiClient.put as jest.Mock).mockResolvedValue({ knowledge_base: {} })
    await bidApis.saveKnowledgeBase(5, { bidder_knowledge_base: { a: 1 } })
    expect(apiClient.put).toHaveBeenCalledWith('/bid/projects/5/materials/knowledge-base', {
      knowledge_base: { bidder_knowledge_base: { a: 1 } },
    })
  })

  it('listAttachments gets items', async () => {
    ;(apiClient.get as jest.Mock).mockResolvedValue({ items: [{ name: 'a.pdf', size: 3 }] })
    const r = await bidApis.listAttachments(5)
    expect(apiClient.get).toHaveBeenCalledWith('/bid/projects/5/materials/attachments')
    expect(r.items[0].name).toBe('a.pdf')
  })

  it('uploadAttachment posts multipart via fetch', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'a.pdf', size: 3 }),
    })
    ;(global as unknown as { fetch: jest.Mock }).fetch = fetchMock
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    const info = await bidApis.uploadAttachment(5, file)
    expect(info).toEqual({ name: 'a.pdf', size: 3 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/bid/projects/5/materials/attachments')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
  })
})
