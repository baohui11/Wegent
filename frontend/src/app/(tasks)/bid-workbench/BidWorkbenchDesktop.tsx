// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import { bidThemeVars } from '@/features/bid/theme'
import { useBidProject } from '@/features/bid/hooks/useBidProject'
import type { BidProject } from '@/apis/bid'
import { ProjectListScreen } from '@/features/bid/components/ProjectListScreen'
import { WorkbenchShell } from '@/features/bid/components/WorkbenchShell'
import { UploadScreen } from '@/features/bid/components/UploadScreen'
import { ParsingScreen } from '@/features/bid/components/ParsingScreen'
import { TenderResultView } from '@/features/bid/components/TenderResultView'
import { OutlineCanvas } from '@/features/bid/components/OutlineCanvas'
import { MaterialsScreen } from '@/features/bid/components/MaterialsScreen'
import { DraftingScreen } from '@/features/bid/components/DraftingScreen'
import { ReviewScreen } from '@/features/bid/components/ReviewScreen'
import { AuditScreen } from '@/features/bid/components/AuditScreen'
import { ExportScreen } from '@/features/bid/components/ExportScreen'

const SAMPLE_TENDER = `XX市政务数据中心信息化系统采购项目 招标文件

第一章 招标公告
项目名称：XX市政务数据中心信息化系统采购项目
项目编号：ZFCG-2026-0731
采购预算：人民币 8,000,000 元（最高限价）
投标截止时间：2026年9月30日 17:00
本项目不划分标包，为单一标包整体采购。本项目为明标（非暗标）。

第二章 投标人资格要求
1. 投标人须具备独立法人资格，具有有效的营业执照。
2. 投标人须具有 ISO9001 质量管理体系认证证书，且在投标截止日仍在有效期内。
3. 投标人须具有 CMMI3 及以上软件能力成熟度集成模型评估证书。
4. 投标人近三年（2023-2025）至少完成 2 个合同金额 500 万元以上的政务信息化项目。
5. 投标人须提供近三年财务审计报告。

第三章 评分办法（技术分 70 分，商务分 30 分）
评分项 T1：总体技术方案的完整性与先进性（20分）——须覆盖系统架构、技术选型、部署方案。
评分项 T2：数据安全与等级保护方案（15分）——须响应等保三级要求。
评分项 T3：项目实施与进度管理方案（15分）——须含 WBS 分解与里程碑。
评分项 T4：运维与售后服务方案（10分）——须承诺 7×24 响应，故障 2 小时内到场。
评分项 T5：类似项目业绩（10分）——每个 500 万以上政务项目得 5 分。
评分项 B1：投标报价（30分）——采用低价优先法。

第四章 实质性要求（★ 号为废标条款，不满足作废标处理）
★ 条款 M1：投标有效期不少于 90 天，不满足的作废标处理。
★ 条款 M2：投标保证金人民币 16 万元，未按时足额缴纳的作废标处理。
★ 条款 M3：必须对本项目全部技术需求作出实质性响应，出现负偏离核心指标的作废标处理。
★ 条款 M4：投标文件须由法定代表人或授权代表签字并加盖公章，否则作废标处理。

第五章 投标文件格式要求
投标文件须包含：投标函、法定代表人授权书、资格证明文件、技术方案、商务报价表、业绩证明。
技术标与商务标分册装订。响应文件须提供偏离表与响应索引表。`

export function BidWorkbenchDesktop() {
  const { t } = useTranslation('bidWorkbench')
  const [view, setView] = useState<'list' | 'workbench'>('list')
  const [title, setTitle] = useState('')
  const {
    phase,
    projectId,
    tender,
    outline,
    coverage,
    error,
    startFromText,
    parseExisting,
    startNew,
    open,
    buildOutline,
    saveOutline,
    reset,
    enterMaterials,
    completeMaterials,
    startDrafting,
    enterReview,
    completeReview,
    enterAudit,
    finalizeBid,
  } = useBidProject()

  // Best-effort load of the mockup's Noto fonts; falls back to the theme's
  // system stack if the network/CSP blocks it.
  useEffect(() => {
    const id = 'bid-noto-fonts'
    if (document.getElementById(id)) return
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href =
      'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700;900&family=Noto+Serif+SC:wght@400;600;700&display=swap'
    document.head.appendChild(link)
  }, [])

  const openProject = async (p: BidProject) => {
    setTitle(p.title)
    setView('workbench')
    await open(p)
  }
  const newProject = () => {
    setTitle(t('projects.new'))
    startNew()
    setView('workbench')
  }
  const backToList = () => {
    reset()
    setView('list')
  }

  if (view === 'list') {
    return (
      <div style={bidThemeVars} className="h-full bg-base" data-testid="bid-workbench-desktop">
        <ProjectListScreen onOpen={openProject} onNew={newProject} />
      </div>
    )
  }

  return (
    <div style={bidThemeVars} className="h-full bg-base" data-testid="bid-workbench-desktop">
      <WorkbenchShell phase={phase} title={title} onBack={backToList}>
        {(phase === 'import' || phase === 'creating') && (
          <UploadScreen
            sampleText={SAMPLE_TENDER}
            onSubmit={(text, pkg) =>
              projectId != null
                ? parseExisting(projectId, text, pkg || undefined)
                : startFromText(text, pkg || undefined)
            }
            onUseSample={pkg =>
              projectId != null
                ? parseExisting(projectId, SAMPLE_TENDER, pkg || undefined)
                : startFromText(SAMPLE_TENDER, pkg || undefined)
            }
          />
        )}
        {phase === 'parsing' && <ParsingScreen />}
        {phase === 'ready' && tender && (
          <div className="flex h-full flex-col">
            <div className="flex-1 overflow-auto">
              <TenderResultView tender={tender} />
            </div>
            <div className="border-t border-border p-4 text-right">
              <button
                type="button"
                onClick={buildOutline}
                data-testid="bid-build-outline-button"
                className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white"
              >
                {t('phase2.build')}
              </button>
            </div>
          </div>
        )}
        {phase === 'outline_building' && <ParsingScreen />}
        {phase === 'outline_ready' && outline && coverage && (
          <OutlineCanvas
            outline={outline}
            coverage={coverage}
            title={title}
            onSave={saveOutline}
            onNext={enterMaterials}
          />
        )}
        {phase === 'materials' && projectId != null && (
          <MaterialsScreen projectId={projectId} onComplete={completeMaterials} />
        )}
        {phase === 'materials_done' && (
          <div
            className="flex h-full flex-col items-center justify-center gap-4"
            data-testid="bid-materials-done"
          >
            <div className="text-sm text-text-secondary">{t('phase3.complete')} ✓</div>
            <button
              type="button"
              onClick={startDrafting}
              data-testid="bid-start-drafting-button"
              className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white"
            >
              {t('phase4.start')}
            </button>
          </div>
        )}
        {phase === 'drafting' && projectId != null && (
          <DraftingScreen projectId={projectId} onNext={enterReview} />
        )}
        {phase === 'review' && projectId != null && (
          <ReviewScreen projectId={projectId} onComplete={completeReview} />
        )}
        {phase === 'review_done' && (
          <div
            className="flex h-full flex-col items-center justify-center gap-4"
            data-testid="bid-review-done"
          >
            <div className="text-sm text-text-secondary">{t('phase5.complete')} ✓</div>
            <button
              type="button"
              onClick={enterAudit}
              data-testid="bid-enter-audit-button"
              className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white"
            >
              {t('phase6.enter')}
            </button>
          </div>
        )}
        {phase === 'audit' && projectId != null && (
          <AuditScreen projectId={projectId} onRework={enterReview} onFinalize={finalizeBid} />
        )}
        {phase === 'finalizing' && (
          <div
            className="flex h-full items-center justify-center text-sm text-text-secondary"
            data-testid="bid-finalizing"
          >
            {t('phase6.finalizing')}
          </div>
        )}
        {phase === 'done' && projectId != null && (
          <ExportScreen projectId={projectId} onReaudit={enterAudit} />
        )}
        {phase === 'error' && (
          <div
            className="flex h-full flex-col items-center justify-center gap-4"
            data-testid="bid-error"
          >
            <div className="text-sm text-error">{t('errors.parse_failed')}</div>
            {error && <div className="text-xs text-text-muted">{error}</div>}
            <button
              type="button"
              onClick={startNew}
              data-testid="bid-retry-button"
              className="rounded-lg border border-primary px-4 py-2 text-sm text-primary"
            >
              {t('upload.use_sample')}
            </button>
          </div>
        )}
      </WorkbenchShell>
    </div>
  )
}
