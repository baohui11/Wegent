// SPDX-License-Identifier: Apache-2.0

import {
  chipLabel,
  countPlaceholdersInJson,
  injectPlaceholders,
} from '@/features/bid/canvas/placeholders'

const text = (t: string) => ({ type: 'text', text: t })
const para = (content: unknown[]) => ({ type: 'paragraph', content })

describe('injectPlaceholders', () => {
  it('splits {{...}} out of surrounding text into a chip node', () => {
    const out = injectPlaceholders([para([text('公司 {{bidder}} 承诺')])])
    const inline = (out[0] as { content: unknown[] }).content
    expect(inline).toEqual([
      { type: 'text', text: '公司 ' },
      { type: 'bidPlaceholder', attrs: { raw: '{{bidder}}' } },
      { type: 'text', text: ' 承诺' },
    ])
  })

  it('recognizes [待填…], {{qual:…}} and 待填(来源:…)', () => {
    const out = injectPlaceholders([
      para([text('见 {{qual:资质证书}}、[待填项目名称] 与 待填(来源:企业营业执照)。')]),
    ])
    const raws = (out[0] as { content: { attrs?: { raw: string } }[] }).content
      .filter(n => n.attrs)
      .map(n => n.attrs!.raw)
    expect(raws).toEqual(['{{qual:资质证书}}', '[待填项目名称]', '待填(来源:企业营业执照)'])
  })

  it('preserves marks on the text parts, never on the chip', () => {
    const out = injectPlaceholders([
      para([{ type: 'text', text: 'a {{x}} b', marks: [{ type: 'bold' }] }]),
    ])
    const inline = (out[0] as { content: { type: string; marks?: unknown }[] }).content
    expect(inline[0]).toEqual({ type: 'text', text: 'a ', marks: [{ type: 'bold' }] })
    expect(inline[1]).toEqual({ type: 'bidPlaceholder', attrs: { raw: '{{x}}' } })
    expect(inline[2]).toEqual({ type: 'text', text: ' b', marks: [{ type: 'bold' }] })
  })

  it('recurses into nested blocks (lists) and leaves plain text untouched', () => {
    const out = injectPlaceholders([
      {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [para([text('no marker here')])] }],
      },
    ])
    const item = (out[0] as { content: { content: { content: unknown[] }[] }[] }).content[0]
    expect(item.content[0].content).toEqual([{ type: 'text', text: 'no marker here' }])
  })

  it('is a no-op when there is nothing to split', () => {
    const input = [para([text('plain')])]
    expect(injectPlaceholders(input)).toEqual(input)
  })
})

describe('countPlaceholdersInJson', () => {
  it('counts chips across nested content', () => {
    const doc = injectPlaceholders([
      para([text('{{a}} and {{b}}')]),
      { type: 'bulletList', content: [{ type: 'listItem', content: [para([text('[待填c]')])] }] },
    ])
    expect(countPlaceholdersInJson(doc)).toBe(3)
  })
})

describe('chipLabel', () => {
  it('derives a readable label but keeps raw for serialization', () => {
    expect(chipLabel('{{qual:资质证书}}')).toBe('资质证书')
    expect(chipLabel('{{bidder}}')).toBe('bidder')
    expect(chipLabel('[待填项目名称]')).toBe('待填项目名称')
    expect(chipLabel('待填(来源:企业营业执照)')).toBe('待填')
  })
})
