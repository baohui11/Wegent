// SPDX-License-Identifier: Apache-2.0
import { bidMockApis } from '@/apis/bid.mock'
import type { OutlineDoc } from '@/apis/bid'

describe('bid.mock stage-3 outline', () => {
  it('seeds stage3 from the project outline (no diff), then diffs after save', async () => {
    const fresh = await bidMockApis.getOutlineStage3(102)
    expect(fresh.differs_from_stage1).toBe(false)
    expect(fresh.outline.sections?.length).toBeGreaterThan(0)

    const edited: OutlineDoc = {
      ...fresh.outline,
      sections: [{ id: 's1', title: '改过' }],
    }
    const saved = await bidMockApis.saveOutlineStage3(102, edited)
    expect(saved.differs_from_stage1).toBe(true)
    expect((await bidMockApis.getOutlineStage3(102)).differs_from_stage1).toBe(true)
  })
})
