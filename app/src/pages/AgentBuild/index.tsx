import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchProject, fetchStageOutput } from '../../api/ontology'
import { mcpCall } from '../../api/mcp'
import { weaveStream } from '../../api/client'
import ReactMarkdown from 'react-markdown'
import type { Project } from '../../types/ontology'
import { ConfirmModal, AlertModal } from '../../components/Modal'
import styles from './AgentBuild.module.css'

interface ToolStatus {
  name: string
  label: string
  status: 'running' | 'done' | 'error'
}

interface StepProgress {
  label: string
  detail?: string
  status: 'pending' | 'running' | 'done' | 'error'
}

interface ChatMessage {
  role: 'user' | 'agent'
  agentId?: string
  agentName?: string
  content: string
  timestamp: string
  stageId?: string
  fullContent?: string
  toolCalls?: ToolStatus[]
  steps?: StepProgress[]
}

const STAGES = [
  { id: 'scene_analysis', name: '场景分析', agent: 'scene-analyst', color: '#993C1D' },
  { id: 'ontology_structure', name: '本体架构', agent: 'ontology-architect', color: '#0F6E56' },
  { id: 'rules_actions', name: '规则设计', agent: 'rule-designer', color: '#534AB7' },
  { id: 'review_report', name: '审核', agent: 'ontology-reviewer', color: '#6B6560' },
]

export function AgentBuild() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [currentStage, setCurrentStage] = useState(0)
  const [stageConfirmed, setStageConfirmed] = useState<boolean[]>([false, false, false, false])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Session IDs per stage for conversation continuity
  const sessionIds = useRef<Record<number, string>>({})

  // Modal state
  const [rollbackConfirm, setRollbackConfirm] = useState<{ idx: number; name: string } | null>(null)
  const [alertState, setAlertState] = useState<{ message: string; type: 'error' } | null>(null)

  // Stage output preview modal
  const [previewContent, setPreviewContent] = useState<{ title: string; content: string } | null>(null)

  function handleDownload(stageId: string, content: string) {
    const blob = new Blob([content], { type: 'text/yaml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${stageId}.yaml`
    a.click()
    URL.revokeObjectURL(url)
  }

  // File upload
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadExistingOutputs = useCallback(async (_proj: Project) => {
    const confirmed = [false, false, false, false]
    const loaded: ChatMessage[] = []

    // Check ALL stages for saved outputs (not just up to current_stage)
    for (let i = 0; i < STAGES.length; i++) {
      const content = await fetchStageOutput(projectId!, STAGES[i].id)
      if (content) {
        confirmed[i] = true
        // Show a summary with expandable full content
        const preview = content.length > 500
          ? content.slice(0, 500) + '\n...'
          : content
        const truncNote = content.length > 500
          ? `\n\n*共 ${content.length} 字符，点击 👁 预览完整内容*`
          : ''
        loaded.push({
          role: 'agent',
          agentId: STAGES[i].agent,
          agentName: STAGES[i].name,
          content: `**${STAGES[i].name}已完成** ✅\n\n\`\`\`yaml\n${preview}\n\`\`\`${truncNote}`,
          timestamp: new Date(Date.now() + i).toISOString(),
          stageId: STAGES[i].id,
          fullContent: content,
        })
      }
    }
    setMessages(loaded)
    setStageConfirmed(confirmed)
    // Set current stage to the first unfinished stage, or last if all done
    const firstUnfinished = confirmed.findIndex(c => !c)
    setCurrentStage(firstUnfinished === -1 ? STAGES.length - 1 : firstUnfinished)
  }, [projectId])

  useEffect(() => {
    if (!projectId) return

    fetchProject(projectId)
      .then(p => {
        setProject(p)
        loadExistingOutputs(p)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId, loadExistingOutputs])

  // Only auto-scroll when sending (not on initial load of existing outputs)
  useEffect(() => {
    if (sending) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, sending])

  /** Prepend project_id so Agent passes it to every tool call. */
  function withProjectContext(message: string): string {
    if (!projectId) return message
    if (message.includes(projectId)) return message
    return `${message}\n\n重要：调用任何工具时，project_id 参数的值是 "${projectId}"。`
  }

  const TOOL_LABELS: Record<string, string> = {
    list_documents: '获取文档列表',
    read_document: '读取调研文档',
    read_scene_analysis: '读取场景分析',
    read_ontology_structure: '读取本体结构',
    read_full_ontology_yaml: '读取完整本体',
    query_published_ontologies: '查询已发布本体',
    validate_yaml: '验证 YAML',
    validate_rule_references: '验证规则引用',
    save_output: '保存输出',
    import_class: '导入共享类',
    delegate: '委托任务',
  }

  /** Stream an agent call, updating the last message incrementally. */
  async function callAgentStream(message: string): Promise<string> {
    const stage = STAGES[currentStage]
    const ts = new Date().toISOString()

    setMessages(prev => [...prev, {
      role: 'agent',
      agentId: stage.agent,
      agentName: stage.name,
      content: '',
      timestamp: ts,
      toolCalls: [],
    }])

    let accumulated = ''
    const tools: ToolStatus[] = []

    const updateMsg = (content?: string, tc?: ToolStatus[]) => {
      setMessages(prev => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last && last.timestamp === ts) {
          updated[updated.length - 1] = {
            ...last,
            content: content ?? last.content,
            toolCalls: tc ?? last.toolCalls,
          }
        }
        return updated
      })
    }

    const done = await weaveStream('/v1/chat', {
      agent: stage.agent,
      session_id: sessionIds.current[currentStage] || '',
      message,
      profile: `project_id=${projectId}`,
    }, (evt) => {
      if (evt.event === 'chunk') {
        accumulated += (evt.data.content as string) || ''
        updateMsg(accumulated, [...tools])
      } else if (evt.event === 'tool_call') {
        const name = evt.data.name as string
        // For repeated tools (like validate_yaml retries), update existing entry instead of adding new
        const existing = tools.find(t => t.name === name && t.status === 'done')
        if (existing) {
          existing.status = 'running'
          existing.label = TOOL_LABELS[name] || name
        } else {
          tools.push({ name, label: TOOL_LABELS[name] || name, status: 'running' })
        }
        updateMsg(accumulated, [...tools])
      } else if (evt.event === 'tool_result') {
        const name = (evt.data.name as string) || ''
        const status = evt.data.status as string
        for (let i = tools.length - 1; i >= 0; i--) {
          if (tools[i].name === name && tools[i].status === 'running') {
            tools[i] = { ...tools[i], status: status === 'error' ? 'error' : 'done' }
            break
          }
        }
        updateMsg(accumulated, [...tools])
      }
    })

    if (done.session_id) {
      sessionIds.current[currentStage] = done.session_id as string
    }

    const rawOutput = (done.output as string) || accumulated || '(无响应)'
    const finalOutput = cleanAgentOutput(rawOutput)

    // Add fullContent + stageId so preview/download buttons work on new messages too
    setMessages(prev => {
      const updated = [...prev]
      const last = updated[updated.length - 1]
      if (last && last.timestamp === ts) {
        updated[updated.length - 1] = {
          ...last,
          content: finalOutput,
          toolCalls: [...tools],
          stageId: STAGES[currentStage]?.id,
          fullContent: rawOutput,
        }
      }
      return updated
    })

    return finalOutput
  }

  /** Remove Agent's internal thinking noise from output */
  function cleanAgentOutput(text: string): string {
    // Remove sentences that expose internal thinking
    const noisePatterns = [
      /让我[检查修正修复重新尝试简化].*?[：。\n]/g,
      /我需要[修正修复检查调整].*?[：。\n]/g,
      /我看到验证.*?[：。\n]/g,
      /看起来验证.*?[：。\n]/g,
      /我注意到.*?不存在.*?[。\n]/g,
      /可能.*?字段需要.*?[。\n]/g,
    ]
    let cleaned = text
    for (const p of noisePatterns) {
      cleaned = cleaned.replace(p, '')
    }
    // Collapse multiple newlines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n')
    return cleaned.trim()
  }

  function addAgentMessage(content: string) {
    const stage = STAGES[currentStage]
    setMessages(prev => [...prev, {
      role: 'agent',
      agentId: stage.agent,
      agentName: stage.name,
      content,
      timestamp: new Date().toISOString(),
    }])
  }

  async function handleUploadDocument() {
    fileInputRef.current?.click()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const text = await file.text()
    setMessages(prev => [...prev, {
      role: 'user',
      content: `上传文档: ${file.name}`,
      timestamp: new Date().toISOString(),
    }])

    setSending(true)
    try {
      // Upload document to MCP so agents can read it via read_document tool
      let docId = ''
      try {
        const uploadResult = await mcpCall<{ document_id: string }>('upload_document', {
          project_id: projectId,
          filename: file.name,
          content: text,
        })
        docId = uploadResult.document_id
      } catch {
        // Continue even if upload fails — content is sent inline below
      }

      await callAgentStream(
        withProjectContext(`已上传文档「${file.name}」(document_id=${docId})。请调用 list_documents 获取文档列表，然后用 read_document 读取全文并开始分析。`)
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setAlertState({ message: `Agent 调用失败: ${msg}`, type: 'error' })
      addAgentMessage(`调用失败: ${msg}`)
    } finally {
      setSending(false)
      // Reset file input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleSend() {
    if (!input.trim() || sending) return

    const msg = input.trim()
    setInput('')
    setMessages(prev => [...prev, {
      role: 'user',
      content: msg,
      timestamp: new Date().toISOString(),
    }])

    setSending(true)
    try {
      await callAgentStream(withProjectContext(msg))
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      setAlertState({ message: `Agent 调用失败: ${errMsg}`, type: 'error' })
      addAgentMessage(`调用失败: ${errMsg}`)
    } finally {
      setSending(false)
    }
  }

  /**
   * S2 task-split orchestration: 3 rounds instead of 1 big generation.
   * Round 1: Classes + Relationships (no metrics/telemetry)
   * Round 2: Read existing structure, add Metrics
   * Round 3: Read existing structure, add Telemetry
   *
   * Each round saves via save_output → Guards validate at each step.
   * DeepSeek generates ~2000 tokens per round instead of ~8000, cutting time 3-4x.
   */
  async function runS2MultiStep(pid: string) {
    const stage = STAGES[1]
    const ts = new Date().toISOString()
    const s2Agent = 'ontology-architect'
    const s2Idx = 1

    const steps: StepProgress[] = [
      { label: '类与关系设计', status: 'running' },
      { label: '指标设计', status: 'pending' },
      { label: '遥测设计', status: 'pending' },
    ]
    setMessages(prev => [...prev, {
      role: 'agent', agentId: stage.agent, agentName: stage.name,
      content: '', timestamp: ts, steps: [...steps],
    }])

    const updateSteps = (s: StepProgress[], content?: string) => {
      setMessages(prev => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last && last.timestamp === ts) {
          updated[updated.length - 1] = { ...last, steps: [...s], ...(content !== undefined ? { content } : {}) }
        }
        return updated
      })
    }

    setSending(true)
    try {
      // Round 1: Classes + Relationships
      await callAgentStreamSilent(
        `请根据场景分析设计本体的 classes 和 relationships。\n` +
        `要求：\n` +
        `- 只设计 classes（含完整 attributes）和 relationships\n` +
        `- 不要添加 metrics 和 telemetry（后续步骤会单独添加）\n` +
        `- 第一公民类的属性要最丰富（>=15个），包含基础属性、派生属性和状态属性\n` +
        `- 派生属性的 formula 只能引用同类中已定义的属性\n` +
        `- 完成后调用 save_output(project_id="${pid}", stage="ontology_structure", content=YAML)`,
        s2Agent, s2Idx
      )
      steps[0].status = 'done'
      updateSteps(steps, '类与关系设计完成')

      // Round 2: Metrics
      steps[1].status = 'running'
      updateSteps(steps)

      await callAgentStreamSilent(
        `请在已有的本体结构上添加 metrics（指标）。\n` +
        `先调用 read_ontology_structure(project_id="${pid}") 读取当前结构，然后在其基础上添加 metrics 部分。\n\n` +
        `每个 metric 必须包含：\n` +
        `- kind: aggregate（聚合）/ composite（复合）/ classification（分类）\n` +
        `- status: designed / implemented / undefined\n` +
        `- source_entities: 列表格式如 [class_id1, class_id2]\n` +
        `- formula: 计算公式\n` +
        `- description: 业务含义\n\n` +
        `注意：kind 不能用 gauge/counter/kpi/ratio 等非标准值，status 不能用 active/enabled/live 等非标准值。\n` +
        `完成后调用 save_output 保存完整的 YAML（包含已有的 classes + relationships + 新增的 metrics）。`,
        s2Agent, s2Idx
      )
      steps[1].status = 'done'
      updateSteps(steps, '指标设计完成')

      // Round 3: Telemetry
      steps[2].status = 'running'
      updateSteps(steps)

      await callAgentStreamSilent(
        `请在已有的本体结构上添加 telemetry（遥测数据流）。\n` +
        `先调用 read_ontology_structure(project_id="${pid}") 读取当前结构，然后在其基础上添加 telemetry 部分。\n\n` +
        `每个 telemetry 必须包含：\n` +
        `- source_class: 数据来源类（注意：字段名是 source_class 不是 source）\n` +
        `- value_type: decimal / integer / boolean / string（不能用 float/gauge/percentage 等）\n` +
        `- sampling: 采样频率如 1s / 10s / 1min（注意：字段名是 sampling 不是 interval）\n` +
        `- aggregations: 列表格式如 [avg, max, min]（注意：字段名是 aggregations 复数，不是 aggregation）\n` +
        `- status: designed / implemented / undefined\n` +
        `- context_strategy: 必须是对象格式，包含 default_window / max_window / default_aggregation / default_granularity\n\n` +
        `完成后调用 save_output 保存完整的 YAML（包含已有的 classes + relationships + metrics + 新增的 telemetry）。`,
        s2Agent, s2Idx
      )
      steps[2].status = 'done'
      updateSteps(steps, '本体架构设计完成（类 + 关系 + 指标 + 遥测）')

    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error('runS2MultiStep error:', err)
      const running = steps.find(s => s.status === 'running')
      if (running) running.status = 'error'
      updateSteps(steps, `设计失败: ${errMsg}`)
      setAlertState({ message: `本体架构设计失败: ${errMsg}`, type: 'error' })
    } finally {
      setSending(false)
    }
  }

  /** Call agent without adding a new message bubble — used by multi-step orchestration. */
  async function callAgentStreamSilent(message: string, agentName?: string, stageIdx?: number): Promise<string> {
    const idx = stageIdx ?? currentStage
    const agent = agentName ?? STAGES[idx].agent
    let accumulated = ''

    const done = await weaveStream('/v1/chat', {
      agent,
      session_id: sessionIds.current[idx] || '',
      message: withProjectContext(message),
      profile: `project_id=${projectId}`,
    }, (evt) => {
      if (evt.event === 'chunk') {
        accumulated += (evt.data.content as string) || ''
      }
    })

    if (done.session_id) {
      sessionIds.current[idx] = done.session_id as string
    }

    return (done.output as string) || accumulated || ''
  }

  async function handleConfirmStage() {
    const pid = projectId!

    // Determine which stage to run next
    let targetIdx: number
    if (stageConfirmed[currentStage]) {
      // Current stage done → advance to next
      if (currentStage >= STAGES.length - 1) {
        navigate(`/project/${projectId}/graph`)
        return
      }
      targetIdx = currentStage + 1
    } else {
      // Current stage not done → run it
      targetIdx = currentStage
    }

    // Mark previous stages as confirmed
    const newConfirmed = [...stageConfirmed]
    for (let i = 0; i < targetIdx; i++) newConfirmed[i] = true
    setStageConfirmed(newConfirmed)
    setCurrentStage(targetIdx)

    const targetStage = STAGES[targetIdx]

    if (targetStage.id === 'ontology_structure') {
      // Don't await — let it run in background so UI updates immediately
      runS2MultiStep(pid).catch(err => {
        console.error('S2 multi-step failed:', err)
        setAlertState({ message: `本体架构设计失败: ${err instanceof Error ? err.message : String(err)}`, type: 'error' })
        setSending(false)
      })
      return
    } else {
      const autoPrompts: Record<string, string> = {
        scene_analysis: `请调用 list_documents(project_id="${pid}") 获取文档列表，然后用 read_document 读取文档全文，再按六步框架分析并保存。`,
        rules_actions: `调用 read_scene_analysis(project_id="${pid}") 和 read_ontology_structure(project_id="${pid}")，然后设计规则和动作。完成后 save_output(project_id="${pid}", stage="rules_actions", content=YAML)。`,
        review_report: `调用 read_full_ontology_yaml(project_id="${pid}")，审核本体并生成报告。完成后 save_output(project_id="${pid}", stage="review_report", content=YAML)。`,
      }
      const autoMsg = autoPrompts[targetStage.id] || `开始${targetStage.name}。`
      setSending(true)
      try {
        await callAgentStream(withProjectContext(autoMsg))
        // After agent completes, check if stage output was saved.
        // S1 saves via its own tool call (not auto_save), so we verify
        // by reading the stage output and auto-confirming if it exists.
        try {
          const stageOutput = await fetchStageOutput(pid, targetStage.id)
          if (stageOutput) {
            setStageConfirmed(prev => {
              const next = [...prev]
              next[targetIdx] = true
              return next
            })
          }
        } catch {
          // Stage output not found — user needs to retry or confirm manually
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err)
        addAgentMessage(`自动启动失败: ${errMsg}`)
      } finally {
        setSending(false)
      }
    }
  }

  function handleClickStage(idx: number) {
    if (idx >= currentStage) return
    setRollbackConfirm({ idx, name: STAGES[idx].name })
  }

  function doRollback() {
    if (!rollbackConfirm) return
    setCurrentStage(rollbackConfirm.idx)
    const newConfirmed = stageConfirmed.map((c, i) => i < rollbackConfirm.idx ? c : false)
    setStageConfirmed(newConfirmed)
    setRollbackConfirm(null)
  }

  if (loading) return <div className={styles.loading}>加载中…</div>

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <div className={styles.back} onClick={() => navigate('/')}>← 返回</div>
        <div className={styles.projectTitle}>{project?.name || projectId} · 本体构建</div>
      </div>

      {/* Stage progress bar */}
      <div className={styles.progressBar}>
        {STAGES.map((stage, i) => (
          <div
            key={stage.id}
            className={`${styles.progressStage} ${stageConfirmed[i] ? styles.progressDone : i === currentStage ? styles.progressCurrent : ''}`}
            onClick={() => handleClickStage(i)}
          >
            <div className={styles.progressDot} style={{ background: stageConfirmed[i] ? '#0F6E56' : i === currentStage ? stage.color : undefined }} />
            <span className={styles.progressLabel}>{stage.name}</span>
            {i < STAGES.length - 1 && (
              <div className={`${styles.progressLine} ${stageConfirmed[i] ? styles.progressLineDone : ''}`} />
            )}
          </div>
        ))}
      </div>

      {/* Chat messages */}
      <div className={styles.chatArea}>
        {messages.length === 0 && (
          <div className={styles.emptyChat}>
            <p>上传调研文档开始构建本体</p>
            <button className={styles.uploadBtn} onClick={handleUploadDocument}>
              上传调研文档 (.md / .txt / .docx)
            </button>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`${styles.message} ${msg.role === 'user' ? styles.messageUser : styles.messageAgent}`}>
            {msg.role === 'agent' && (
              <div className={styles.agentHeader}>
                <span
                  className={styles.agentAvatar}
                  style={{ background: STAGES.find(s => s.agent === msg.agentId)?.color || '#6B6560' }}
                >
                  {msg.agentName?.[0] || 'A'}
                </span>
                <span className={styles.agentName}>{msg.agentName || msg.agentId}</span>
              </div>
            )}
            <div className={styles.messageContent}>
              {msg.fullContent && (
                <div className={styles.stageActions}>
                  <button
                    className={styles.stageActionBtn}
                    title="预览完整内容"
                    onClick={() => setPreviewContent({ title: msg.agentName || '', content: msg.fullContent! })}
                  >
                    👁
                  </button>
                  <button
                    className={styles.stageActionBtn}
                    title="下载 YAML"
                    onClick={() => handleDownload(msg.stageId || 'output', msg.fullContent!)}
                  >
                    ⬇
                  </button>
                </div>
              )}
              {msg.role === 'agent' ? (
                <>
                  {msg.content ? (
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  ) : (
                    <span className={styles.thinking}>{STAGES[currentStage]?.name || 'Agent'} 正在处理中…</span>
                  )}
                  {msg.steps && msg.steps.length > 0 && (
                    <div className={styles.toolList}>
                      {msg.steps.map((step, si) => (
                        <div key={si} className={`${styles.toolItem} ${styles[`tool_${step.status}`]}`}>
                          <span className={styles.toolIcon}>
                            {step.status === 'running' ? '◆' : step.status === 'done' ? '✓' : step.status === 'error' ? '✗' : '○'}
                          </span>
                          <span className={styles.toolLabel}>
                            {step.label}
                            {step.detail && <span className={styles.toolDetail}> ({step.detail})</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className={styles.toolList}>
                      {msg.toolCalls.map((tc, ti) => (
                        <div key={ti} className={`${styles.toolItem} ${styles[`tool_${tc.status}`]}`}>
                          <span className={styles.toolIcon}>
                            {tc.status === 'running' ? '◆' : tc.status === 'done' ? '✓' : '✗'}
                          </span>
                          <span className={styles.toolLabel}>{tc.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                msg.content.split('\n').map((line, j) => (
                  <span key={j}>{line}{j < msg.content.split('\n').length - 1 && <br />}</span>
                ))
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Bottom bar */}
      <div className={styles.bottomBar}>
        {messages.length > 0 && !sending && (
          stageConfirmed[currentStage] ? (
            currentStage < STAGES.length - 1 ? (
              <button className={styles.confirmBtn} onClick={handleConfirmStage}>
                确认，进入{STAGES[currentStage + 1].name}
              </button>
            ) : (
              <button className={styles.confirmBtn} onClick={handleConfirmStage}>
                进入可视化审核
              </button>
            )
          ) : (
            <button className={styles.confirmBtn} onClick={handleConfirmStage}>
              开始{STAGES[currentStage].name}
            </button>
          )
        )}
        <div className={styles.inputRow}>
          <button className={styles.attachBtn} onClick={handleUploadDocument} title="上传文档">📎</button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.txt,.docx,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <input
            className={styles.chatInput}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder={`跟 ${STAGES[currentStage].name} Agent 对话…`}
            disabled={sending}
            data-testid="chat-input"
          />
          <button className={styles.sendBtn} onClick={handleSend} disabled={sending || !input.trim()}>
            {sending ? '处理中' : '发送'}
          </button>
        </div>
      </div>

      <ConfirmModal
        open={!!rollbackConfirm}
        title="回退阶段"
        message={`回退到"${rollbackConfirm?.name}"阶段？该阶段及后续阶段的输出将被清空。`}
        confirmText="确认回退"
        danger
        onConfirm={doRollback}
        onCancel={() => setRollbackConfirm(null)}
      />
      <AlertModal
        open={!!alertState}
        message={alertState?.message || ''}
        type={alertState?.type}
        onClose={() => setAlertState(null)}
      />

      {/* Stage output preview modal */}
      {previewContent && (
        <div className={styles.previewOverlay} onClick={() => setPreviewContent(null)}>
          <div className={styles.previewModal} onClick={e => e.stopPropagation()}>
            <div className={styles.previewHeader}>
              <span className={styles.previewTitle}>{previewContent.title} — 完整输出</span>
              <button className={styles.previewClose} onClick={() => setPreviewContent(null)}>×</button>
            </div>
            <pre className={styles.previewCode}>{previewContent.content}</pre>
          </div>
        </div>
      )}
    </div>
  )
}
