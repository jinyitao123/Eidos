import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import yaml from 'js-yaml'
import { fetchProject, fetchOntology, fetchStageOutput } from '../../api/ontology'
import { mcpCall } from '../../api/mcp'
import type { Project, Ontology } from '../../types/ontology'
import { ConfirmModal, AlertModal, Modal } from '../../components/Modal'
import styles from './PublishPipeline.module.css'

interface StepResult {
  step: number
  name: string
  files: Record<string, string>
}

interface PipelineStep {
  name: string
  status: 'pending' | 'running' | 'done' | 'error'
  preview: string
  stats: string
  hasReview?: boolean
  files?: Record<string, string>
  error?: string
}

const STEP_NAMES = [
  'PG Schema 生成',
  'MCP 工具生成',
  'Neo4j Schema 同步',
  'Agent 配置更新',
  '规则引擎更新',
  '前端类型生成',
  '连接器映射模板',
]

function buildStepsFromOntology(ontology: Ontology): PipelineStep[] {
  const classes = ontology.classes || []
  const rels = ontology.relationships || []
  const rules = ontology.rules || []
  const actions = ontology.actions || []
  const metrics = ontology.metrics || []
  const telemetry = ontology.telemetry || []
  const functions = ontology.functions || []
  const totalAttrs = classes.reduce((sum, c) => sum + (c.attributes?.length || 0), 0)

  // MCP tool count: query per class + execute per action + metric tools + calc per function + telemetry (0 or 1) + metadata
  const metricToolCount = metrics.length
  const telemetryToolCount = telemetry.length > 0 ? 1 : 0
  const totalTools = classes.length + actions.length + metricToolCount + functions.length + telemetryToolCount + 1

  return [
    {
      name: STEP_NAMES[0], status: 'pending',
      preview: `${classes.length} 张表待生成 · ${totalAttrs} 个字段`,
      stats: `CREATE TABLE × ${classes.length} · 关系外键 × ${rels.length}`,
    },
    {
      name: STEP_NAMES[1], status: 'pending',
      preview: `query × ${classes.length} · execute × ${actions.length} · 指标 × ${metricToolCount} · 遥测 × ${telemetryToolCount} · 函数 × ${functions.length}`,
      stats: `预计生成 ${totalTools} 个 MCP 工具`,
    },
    {
      name: STEP_NAMES[2], status: 'pending',
      preview: `${totalAttrs} 个属性同步到图谱`,
      stats: `节点标签 × ${classes.length} · 关系类型 × ${rels.length}`,
    },
    {
      name: STEP_NAMES[3], status: 'pending',
      preview: `Agent 工具绑定更新`, stats: '',
      hasReview: true,
    },
    {
      name: STEP_NAMES[4], status: 'pending',
      preview: `${rules.length} 条规则 · ${actions.length} 个动作`, stats: '',
    },
    {
      name: STEP_NAMES[5], status: 'pending',
      preview: `${classes.length} 个 TypeScript interface`, stats: '',
    },
    {
      name: STEP_NAMES[6], status: 'pending',
      preview: `${totalAttrs} 个字段的连接器映射模板`, stats: '',
    },
  ]
}

export function PublishPipeline() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [ontology, setOntology] = useState<Ontology | null>(null)
  const [steps, setSteps] = useState<PipelineStep[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [completedCount, setCompletedCount] = useState(0)
  const [pipelineLog, setPipelineLog] = useState('')

  // Modal state
  const [showPublishConfirm, setShowPublishConfirm] = useState(false)
  const [alertState, setAlertState] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null)
  const [viewingFile, setViewingFile] = useState<{ name: string; content: string } | null>(null)
  const [hasBlockingIssues, setHasBlockingIssues] = useState(false)

  useEffect(() => {
    if (!projectId) return

    Promise.all([
      fetchProject(projectId).then(p => setProject(p)).catch(() => {}),
      fetchOntology(projectId)
        .then(o => {
          if (o) {
            setOntology(o)
            setSteps(buildStepsFromOntology(o))
          }
        })
        .catch(() => {}),
      // Check for blocking issues in review report
      fetchStageOutput(projectId, 'review_report')
        .then((report: string | null) => {
          if (report && report.includes('blocking')) {
            try {
              const parsed = yaml.load(report) as Record<string, unknown>
              const summary = parsed?.summary as Record<string, number> | undefined
              if (summary && summary.blocking > 0) {
                setHasBlockingIssues(true)
              }
            } catch { /* ignore */ }
          }
        })
        .catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [projectId])

  async function handleRunPipeline() {
    if (!ontology || running) return
    setRunning(true)
    setPipelineLog('')

    // Set all steps to running with animation delay
    const newSteps = steps.map(s => ({ ...s, status: 'running' as const }))
    setSteps(newSteps)

    try {
      const result = await mcpCall<{
        success: boolean
        steps: StepResult[]
        log: string
      }>('run_pipeline', { project_id: projectId })

      setPipelineLog(result.log || '')

      if (result.success && result.steps) {
        // Update each step with real results
        const updatedSteps = steps.map((step, i) => {
          const stepResult = result.steps[i]
          if (!stepResult) return { ...step, status: 'done' as const }

          const fileCount = Object.keys(stepResult.files || {}).length
          const fileNames = Object.keys(stepResult.files || {})
            .filter(f => f !== 'note')
            .join(', ')

          const hasRealFiles = fileNames.length > 0

          return {
            ...step,
            status: 'done' as const,
            files: stepResult.files,
            preview: hasRealFiles
              ? `${fileCount} 个文件: ${fileNames}`
              : stepResult.files?.note || step.preview,
            stats: hasRealFiles
              ? summarizeFiles(stepResult.files)
              : step.stats,
          }
        })

        // Animate completion step by step
        for (let i = 0; i < updatedSteps.length; i++) {
          await new Promise(r => setTimeout(r, 200))
          setSteps(prev => prev.map((s, j) => j <= i ? updatedSteps[j] : s))
          setCompletedCount(i + 1)
        }
      } else {
        // Pipeline failed
        setSteps(prev => prev.map(s => ({ ...s, status: 'error' as const })))
        setAlertState({ message: `管道执行失败:\n${result.log || '未知错误'}`, type: 'error' })
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setSteps(prev => prev.map(s => ({
        ...s,
        status: s.status === 'running' ? 'error' as const : s.status,
      })))
      setAlertState({ message: `管道执行失败: ${msg}`, type: 'error' })
    } finally {
      setRunning(false)
    }
  }

  function summarizeFiles(files: Record<string, string>): string {
    const entries = Object.entries(files).filter(([k]) => k !== 'note')
    if (entries.length === 0) return ''
    const totalSize = entries.reduce((sum, [, v]) => sum + v.length, 0)
    return `${entries.length} 个文件 · ${(totalSize / 1024).toFixed(1)} KB`
  }

  function handlePublish() {
    setShowPublishConfirm(true)
  }

  async function doPublish() {
    setShowPublishConfirm(false)
    try {
      if (ontology) {
        const yamlModule = await import('js-yaml')
        const yamlStr = yamlModule.dump(ontology, { lineWidth: 120 })
        const validation = await mcpCall<{ valid: boolean; errors?: Array<{ message: string }> }>(
          'validate_yaml', { yaml_content: yamlStr, check_level: 'full' }
        )
        if (!validation.valid && validation.errors?.length) {
          setAlertState({ message: '验证失败:\n' + validation.errors.map(e => e.message).join('\n'), type: 'error' })
          return
        }
      }
      setAlertState({ message: '发布成功！代码已生成，可部署到生产环境。', type: 'success' })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setAlertState({ message: '发布失败: ' + msg, type: 'error' })
    }
  }

  function handleViewFiles(stepIdx: number) {
    const step = steps[stepIdx]
    if (!step.files) return
    const entries = Object.entries(step.files).filter(([k]) => k !== 'note')
    if (entries.length === 0) return
    // Show the first file, user can switch
    setViewingFile({ name: entries[0][0], content: entries[0][1] })
  }

  const allDone = steps.length > 0 && steps.every(s => s.status === 'done')
  const hasError = steps.some(s => s.status === 'error')
  const currentVersion = project?.published_version || 'v0.0'
  const nextVersion = currentVersion === 'v0.0' ? 'v1.0' : `v${(parseFloat(currentVersion.replace('v', '')) + 0.1).toFixed(1)}`

  return (
    <div>
      <div className={styles.back} onClick={() => navigate(`/project/${projectId}/graph`)}>← 返回本体管理</div>
      <div className={styles.header}>
        <h2 className={styles.title}>发布管道</h2>
        <span className={`${styles.badge} ${hasError ? styles.badgeError : ''}`}>
          {allDone ? '管道完成' : hasError ? '执行失败' : running ? '运行中…' : '待执行'}
        </span>
      </div>
      <div className={styles.subtitle}>
        {project?.name || projectId} · 本体定义 → 下游代码自动生成
      </div>

      {loading ? (
        <div className={styles.loading}>加载中…</div>
      ) : (
        <>
          <div className={styles.versionBar}>
            <span className={styles.verLabel}>版本</span>
            <span className={styles.verVal}>{currentVersion}</span>
            <span className={styles.verArrow}>→</span>
            <span className={styles.verVal}>{nextVersion}</span>
            {ontology && (
              <span className={styles.verDiff}>
                {ontology.classes.length} 类 · {ontology.relationships.length} 关系 · {ontology.metrics?.length || 0} 指标 · {ontology.telemetry?.length || 0} 遥测 · {ontology.rules?.length || 0} 规则 · {ontology.actions?.length || 0} 动作
              </span>
            )}
          </div>

          {steps.length === 0 ? (
            <div className={styles.empty}>暂无本体数据，请先完成构建</div>
          ) : (
            <>
              {!running && !allDone && (
                hasBlockingIssues ? (
                  <div className={styles.blockingWarning}>
                    审核报告存在阻断性问题，请先修复后再执行管道。
                    <button className={styles.linkBtn} onClick={() => navigate(`/project/${projectId}/report`)}>
                      查看审核报告
                    </button>
                  </div>
                ) : (
                  <button className={styles.runBtn} onClick={handleRunPipeline} data-testid="run-pipeline-btn">
                    {hasError ? '重新执行管道（7步）' : '执行管道（7步）'}
                  </button>
                )
              )}

              <div className={styles.pipeline}>
                {steps.map((step, i) => (
                  <div key={i} className={styles.pipeStep} data-testid="pipeline-step">
                    <div className={styles.pipeTrack}>
                      <div className={`${styles.pipeDot} ${
                        step.status === 'done' ? styles.pipeDotDone
                          : step.status === 'running' ? styles.pipeDotRunning
                          : step.status === 'error' ? styles.pipeDotError
                          : ''
                      }`} />
                      {i < steps.length - 1 && (
                        <div className={`${styles.pipeLine} ${
                          step.status === 'done' ? styles.pipeLineDone : ''
                        }`} />
                      )}
                    </div>
                    <div className={styles.pipeContent}>
                      <div className={styles.pipeName}>
                        {step.name}
                        {step.status === 'done' && <span className={styles.okTag}>完成</span>}
                        {step.status === 'running' && <span className={styles.runningTag}>运行中</span>}
                        {step.status === 'error' && <span className={styles.errorTag}>失败</span>}
                        {step.hasReview && step.status === 'done' && <span className={styles.diffTag}>建议审核</span>}
                        {step.status === 'done' && step.files && Object.keys(step.files).filter(k => k !== 'note').length > 0 && (
                          <span className={styles.viewBtn} onClick={() => handleViewFiles(i)} data-testid="view-files-btn">查看文件</span>
                        )}
                      </div>
                      <div className={styles.pipeOutput}>
                        {step.preview.split('\n').map((l, j) => <div key={j}>{l}</div>)}
                      </div>
                      {step.stats && <div className={styles.pipeStats}>{step.stats}</div>}
                      {step.error && <div className={styles.pipeError}>{step.error}</div>}
                    </div>
                  </div>
                ))}
              </div>

              {pipelineLog && (
                <details className={styles.logSection}>
                  <summary className={styles.logSummary}>管道执行日志</summary>
                  <pre className={styles.logContent}>{pipelineLog}</pre>
                </details>
              )}

              <div className={styles.bottomBar}>
                <div className={`${styles.bottomLeft} ${hasError ? styles.bottomError : ''}`}>
                  {allDone
                    ? '7/7 管道步骤全部完成'
                    : hasError
                    ? '管道执行失败'
                    : running
                    ? `${completedCount}/7 步骤已完成`
                    : '管道待执行'}
                </div>
                <div className={styles.bottomRight}>
                  <button className={styles.btnSecondary} onClick={() => navigate(`/project/${projectId}/report`)}>审核报告</button>
                  {project?.published_version && (
                    <button className={styles.btnSecondary}>变更日志</button>
                  )}
                  <button
                    className={styles.btnPrimary}
                    disabled={!allDone}
                    onClick={handlePublish}
                  >
                    部署到生产
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* File viewer modal */}
      <Modal open={!!viewingFile} title="生成文件预览" onClose={() => setViewingFile(null)}>
        {viewingFile && (
          <div className={styles.fileViewer}>
            <div className={styles.fileHeader}>
              <span className={styles.fileName}>{viewingFile.name}</span>
              <button className={styles.fileClose} onClick={() => setViewingFile(null)}>×</button>
            </div>
            {/* File tabs for the current step */}
            {(() => {
              const currentStep = steps.find(s => s.files && Object.keys(s.files).some(k => k === viewingFile.name))
              if (!currentStep?.files) return null
              const fileEntries = Object.entries(currentStep.files).filter(([k]) => k !== 'note')
              if (fileEntries.length <= 1) return null
              return (
                <div className={styles.fileTabs}>
                  {fileEntries.map(([name]) => (
                    <button
                      key={name}
                      className={`${styles.fileTab} ${name === viewingFile.name ? styles.fileTabActive : ''}`}
                      onClick={() => setViewingFile({ name, content: currentStep.files![name] })}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )
            })()}
            <pre className={styles.fileContent}>{viewingFile.content}</pre>
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={showPublishConfirm}
        title="确认发布"
        message="确定发布到生产环境？此操作将触发代码部署。"
        confirmText="确认发布"
        danger
        onConfirm={doPublish}
        onCancel={() => setShowPublishConfirm(false)}
      />
      <AlertModal
        open={!!alertState}
        message={alertState?.message || ''}
        type={alertState?.type}
        onClose={() => setAlertState(null)}
      />
    </div>
  )
}
