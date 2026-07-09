// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '@/hooks/useTranslation'
import { bidThemeVars } from '@/features/bid/theme'
import { useBidProject, phaseToStage } from '@/features/bid/hooks/useBidProject'
import { bidApis, type BidProject, type LlmCall } from '@/apis/bid'
import { ProjectListScreen } from '@/features/bid/components/ProjectListScreen'
import { WorkbenchShell } from '@/features/bid/components/WorkbenchShell'
import { UploadScreen } from '@/features/bid/components/UploadScreen'
import { OutlineCanvas } from '@/features/bid/components/OutlineCanvas'
import { MaterialsScreen } from '@/features/bid/components/MaterialsScreen'
import { GenerateRefineScreen } from '@/features/bid/components/GenerateRefineScreen'
import { AuditScreen } from '@/features/bid/components/AuditScreen'
import { ConfirmDialog } from '@/features/bid/components/ConfirmDialog'

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
  // Highest stage reached (drives clickable stepper), whether drafting finished
  // (drives the Stage-3 header action), and the "proceed to drafting" confirm.
  const [maxStage, setMaxStage] = useState(1)
  const [draftState, setDraftState] = useState<'running' | 'done'>('running')
  const [confirmDraft, setConfirmDraft] = useState(false)
  // 🅓 proceed gate: unfilled placeholder count from the drafting screen, and
  // whether the "still unfilled — continue?" confirm dialog is open.
  const [placeholderCount, setPlaceholderCount] = useState(0)
  const [confirmProceed, setConfirmProceed] = useState(false)
  // Header "enter generation" must persist the current materials briefs before
  // the confirm dialog opens; MaterialsScreen registers its persist here.
  const materialsPersist = useRef<(() => Promise<void>) | null>(null)
  // Real LLM call log for the outline canvas' parse-log panel (B3 endpoint).
  const [llmLog, setLlmLog] = useState<LlmCall[]>([])
  // Current real backend parse stage (segmenting/extracting/merging/…) shown in
  // the canvas' parsing panel instead of a fake timer.
  const [parseStage, setParseStage] = useState('segmenting')
  const {
    phase,
    projectId,
    outline,
    stage3Outline,
    stage3Differs,
    maxPhaseReached,
    coverage,
    error,
    startFromText,
    parseExisting,
    startNew,
    open,
    saveOutline,
    renameSection,
    addChapter,
    deleteChapter,
    moveChapter,
    reset,
    enterMaterials,
    completeMaterials,
    completeReview,
    finalizeBid,
    goStage,
  } = useBidProject()

  // Refresh the LLM call log whenever the project or phase changes (the parse
  // panel shows real usage once parsing settles).
  useEffect(() => {
    if (projectId == null) {
      setLlmLog([])
      return
    }
    bidApis
      .getLlmLog(projectId)
      .then(res => setLlmLog(res.items ?? []))
      .catch(() => {
        /* not all backends have llm-log yet; leave empty */
      })
  }, [projectId, phase])

  // While parsing, poll the real backend stage + refresh the call log so the
  // canvas shows which step is actually running (not a fake timer).
  useEffect(() => {
    const parsingPhase = phase === 'creating' || phase === 'parsing' || phase === 'outline_building'
    if (projectId == null || !parsingPhase) return
    let alive = true
    const tick = () => {
      bidApis
        .getParseStage(projectId)
        .then(res => alive && setParseStage(res.stage))
        .catch(() => {})
      bidApis
        .getLlmLog(projectId)
        .then(res => alive && setLlmLog(res.items ?? []))
        .catch(() => {})
    }
    tick()
    const id = setInterval(tick, 1500)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [projectId, phase])

  // Track the furthest stage reached so the stepper can jump back to it.
  useEffect(() => {
    setMaxStage(m => Math.max(m, phaseToStage(phase)))
  }, [phase])
  // Drafting state is scoped to the drafting phase.
  useEffect(() => {
    if (phase !== 'drafting') setDraftState('running')
  }, [phase])

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
    setMaxStage(1)
    setView('workbench')
    await open(p)
  }
  const newProject = () => {
    setTitle(t('projects.new'))
    setMaxStage(1)
    startNew()
    setView('workbench')
  }
  const backToList = () => {
    reset()
    setMaxStage(1)
    setView('list')
  }

  if (view === 'list') {
    return (
      <div style={bidThemeVars} className="h-screen bg-base" data-testid="bid-workbench-desktop">
        <ProjectListScreen onOpen={openProject} onNew={newProject} />
      </div>
    )
  }

  // New-project / import: standalone full-page (own back button + gradient),
  // rendered outside the workbench shell/stepper to match the mockup. Once the
  // user hits create ('creating' → 'parsing'), the flow moves into the shell's
  // Stage 1 canvas in its parsing state.
  if (phase === 'import') {
    return (
      <div style={bidThemeVars} className="h-screen bg-base" data-testid="bid-workbench-desktop">
        <UploadScreen
          sampleText={SAMPLE_TENDER}
          onBack={backToList}
          onCreate={(text, name, model) =>
            projectId != null
              ? parseExisting(projectId, text)
              : startFromText(text, name, undefined, model)
          }
        />
      </div>
    )
  }

  // Re-drafting overwrites the body (and stage-3 outline edits); warn only when
  // the project has already reached drafting (max_phase_reached >= 4 => sections
  // exist), per spec §4. A first-time draft (never reached stage 3) is silent.
  const maxStageReachedDraft = maxPhaseReached >= 4

  // Stage action shown in the shell header (unified action area).
  const headerAction =
    phase === 'outline_ready' && outline && coverage ? (
      <HeaderButton onClick={enterMaterials} testid="outline-next-button">
        {t('outline.confirm')}
      </HeaderButton>
    ) : phase === 'materials' ? (
      <HeaderButton
        onClick={async () => {
          await materialsPersist.current?.()
          setConfirmDraft(true)
        }}
        testid="materials-next-button"
      >
        {t('phase2.header_action')}
      </HeaderButton>
    ) : phase === 'drafting' ? (
      // Merged generate-refine screen: only the terminal "done" state exposes a
      // single header action — proceed to check. Refinements happen in place on
      // the same screen; there is no full-document restart (removed — it
      // conflicted with proceed and let users wipe the whole draft).
      draftState === 'done' ? (
        <HeaderButton
          onClick={() => (placeholderCount > 0 ? setConfirmProceed(true) : completeReview())}
          testid="review-next-button"
        >
          {t('review.header_action')}
        </HeaderButton>
      ) : undefined
    ) : undefined

  return (
    <div style={bidThemeVars} className="h-screen bg-base" data-testid="bid-workbench-desktop">
      <WorkbenchShell
        phase={phase}
        title={title}
        maxStage={maxStage}
        onStageClick={goStage}
        onBack={backToList}
        headerAction={headerAction}
      >
        {(phase === 'creating' || phase === 'parsing' || phase === 'outline_building') && (
          <OutlineCanvas title={title} parsing parseStage={parseStage} llmLog={llmLog} />
        )}
        {phase === 'outline_ready' && outline && coverage && (
          <OutlineCanvas
            outline={outline}
            coverage={coverage}
            title={title}
            onSave={saveOutline}
            llmLog={llmLog}
          />
        )}
        {phase === 'materials' && (
          <MaterialsScreen
            projectId={projectId}
            outline={outline ?? undefined}
            onComplete={() => setConfirmDraft(true)}
            persistRef={materialsPersist}
          />
        )}
        {phase === 'drafting' && projectId != null && (
          <GenerateRefineScreen
            projectId={projectId}
            outline={stage3Outline ?? outline ?? undefined}
            onStateChange={setDraftState}
            onPlaceholderCountChange={setPlaceholderCount}
            onRenameSection={renameSection}
            onAddChapter={addChapter}
            onDeleteChapter={deleteChapter}
            onMoveChapter={moveChapter}
          />
        )}
        {(phase === 'audit' || phase === 'finalizing' || phase === 'done') && projectId != null && (
          <AuditScreen
            projectId={projectId}
            finalized={phase === 'done'}
            finalizing={phase === 'finalizing'}
            onRework={() => goStage(3)}
            onFinalize={finalizeBid}
            onLocate={() => goStage(3)}
          />
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

      {confirmDraft && (
        <ConfirmDialog
          title={t('phase2.confirm_title')}
          desc={
            maxStageReachedDraft
              ? stage3Differs
                ? t('phase2.regen_overwrite_desc_outline')
                : t('phase2.regen_overwrite_desc')
              : t('phase2.confirm_desc')
          }
          cancel={t('outline.delete_cancel')}
          confirm={t('phase2.confirm_ok')}
          onCancel={() => setConfirmDraft(false)}
          onConfirm={() => {
            setConfirmDraft(false)
            void completeMaterials()
          }}
        />
      )}
      {confirmProceed && (
        // 🅓 gate: warn before entering the check stage with unfilled placeholders.
        <ConfirmDialog
          title={t('editor.placeholder_gate_title')}
          desc={t('editor.placeholder_gate_desc', { count: placeholderCount })}
          cancel={t('editor.placeholder_gate_cancel')}
          confirm={t('editor.placeholder_gate_confirm')}
          onCancel={() => setConfirmProceed(false)}
          onConfirm={() => {
            setConfirmProceed(false)
            void completeReview()
          }}
        />
      )}
    </div>
  )
}

function HeaderButton({
  onClick,
  testid,
  children,
}: {
  onClick: () => void
  testid: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className="whitespace-nowrap rounded-lg px-4 py-2 text-xs font-bold text-white"
      style={{ background: 'var(--bid-primary)' }}
    >
      {children}
    </button>
  )
}
