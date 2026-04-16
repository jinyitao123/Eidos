import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchProject, fetchStageOutput } from '../../api/ontology'
import { mcpCall } from '../../api/mcp'
import { weaveStream } from '../../api/client'
import ReactMarkdown from 'react-markdown'
import type { Project } from '../../types/ontology'
import { AlertModal } from '../../components/Modal'
import type { ChatMessage, ToolStatus, StepProgress, DocInfo } from './types'
import { STAGES, TOOL_LABELS, getStagePrompt, getS2Prompts } from './stages'
import { DocPanel } from './DocPanel'
import { ProgressBar } from './ProgressBar'
import { BottomBar } from './BottomBar'
import styles from './AgentBuild.module.css'

export function AgentBuild() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [currentStage, setCurrentStage] = useState(0)
  const [stageVersions, setStageVersions] = useState<number[]>([0, 0, 0, 0])
  const [stageDirty, setStageDirty] = useState<boolean[]>([false, false, false, false])
  const [documents, setDocuments] = useState<DocInfo[]>([])
  const [currentRound, setCurrentRound] = useState(1)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const newDocCount = documents.filter(d => !d.analyzed).length

  // Session IDs per stage for conversation continuity
  const sessionIds = useRef<Record<number, string>>({})

  // Modal state
  const [alertState, setAlertState] = useState<{ message: string; type: 'error' } | null>(null)
  const [previewContent, setPreviewContent] = useState<{ title: string; content: string } | null>(null)

  // File upload
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Load existing outputs + documents ──

  const loadExistingOutputs = useCallback(async (_proj: Project) => {
    const versions = [0, 0, 0, 0]
    const loaded: ChatMessage[] = []

    for (let i = 0; i < STAGES.length; i++) {
      const content = await fetchStageOutput(projectId!, STAGES[i].id)
      if (content) {
        versions[i] = 1
        const preview = content.length > 500 ? content.slice(0, 500) + '\n...' : content
        const truncNote = content.length > 500 ? `\n\n*共 ${content.length} 字符，点击 👁 预览完整内容*` : ''
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
    setStageVersions(versions)
    const firstUnfinished = versions.findIndex(v => v === 0)
    setCurrentStage(firstUnfinished === -1 ? STAGES.length - 1 : firstUnfinished)

    // Load document list
    try {
      const result = await mcpCall<{ count: number; documents: { document_id: string; filename: string }[] }>('list_documents', { project_id: projectId })
      const docs = result?.documents || []
      if (docs.length > 0) {
        setDocuments(docs.map(d => ({ id: d.document_id, name: d.filename, analyzed: versions[0] > 0 })))
      }
    } catch { /* no docs yet */ }
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    fetchProject(projectId)
      .then(p => { setProject(p); loadExistingOutputs(p) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId, loadExistingOutputs])

  useEffect(() => {
    if (sending) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  // ── Helpers ──

  function withProjectContext(message: string): string {
    if (!projectId) return message
    if (message.includes(projectId)) return message
    return `${message}\n\n重要：调用任何工具时，project_id 参数的值是 "${projectId}"。`
  }

  function cleanAgentOutput(text: string): string {
    const noisePatterns = [
      /让我[检查修正修复重新尝试简化].*?[：。\n]/g,
      /我需要[修正修复检查调整].*?[：。\n]/g,
      /我看到验证.*?[：。\n]/g,
      /看起来验证.*?[：。\n]/g,
      /我注意到.*?不存在.*?[。\n]/g,
      /可能.*?字段需要.*?[。\n]/g,
    ]
    let cleaned = text
    for (const p of noisePatterns) cleaned = cleaned.replace(p, '')
    return cleaned.replace(/\n{3,}/g, '\n\n').trim()
  }

  function addAgentMessage(content: string) {
    const stage = STAGES[currentStage]
    setMessages(prev => [...prev, {
      role: 'agent', agentId: stage.agent, agentName: stage.name,
      content, timestamp: new Date().toISOString(), round: currentRound,
    }])
  }

  function handleDownload(stageId: string, content: string) {
    const blob = new Blob([content], { type: 'text/yaml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${stageId}.yaml`; a.click()
    URL.revokeObjectURL(url)
  }

  /** Mark current stage and all downstream stages as dirty */
  function markDirtyFrom(fromIdx: number) {
    setStageDirty(prev => prev.map((d, i) => i >= fromIdx ? true : d))
  }

  /** After a stage completes, bump its version and clear dirty, mark downstream dirty */
  function completeStage(idx: number) {
    setStageVersions(prev => {
      const next = [...prev]
      next[idx] = prev[idx] + 1
      return next
    })
    setStageDirty(prev => {
      const next = [...prev]
      next[idx] = false
      // Mark downstream dirty
      for (let i = idx + 1; i < next.length; i++) {
        if (prev[i] !== false || stageVersions[i] > 0) next[i] = true
      }
      return next
    })
  }

  // ── Agent streaming ──

  async function callAgentStream(message: string): Promise<string> {
    const stage = STAGES[currentStage]
    const ts = new Date().toISOString()

    setMessages(prev => [...prev, {
      role: 'agent', agentId: stage.agent, agentName: stage.name,
      content: '', timestamp: ts, toolCalls: [], round: currentRound,
    }])

    let accumulated = ''
    const tools: ToolStatus[] = []

    const updateMsg = (content?: string, tc?: ToolStatus[]) => {
      setMessages(prev => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last && last.timestamp === ts) {
          updated[updated.length - 1] = { ...last, content: content ?? last.content, toolCalls: tc ?? last.toolCalls }
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
        const args = evt.data.args as string || ''
        if (name === 'save_output') {
          try {
            const parsed = JSON.parse(args)
            if (parsed.content) accumulated += '\n\n```yaml\n' + parsed.content + '\n```\n'
          } catch { /* skip */ }
        }
        const existing = tools.find(t => t.name === name && t.status === 'done')
        if (existing) { existing.status = 'running'; existing.label = TOOL_LABELS[name] || name }
        else tools.push({ name, label: TOOL_LABELS[name] || name, status: 'running' })
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

    if (done.session_id) sessionIds.current[currentStage] = done.session_id as string

    const rawOutput = (done.output as string) || accumulated || '(无响应)'
    const finalOutput = cleanAgentOutput(rawOutput)

    for (const t of tools) { if (t.status === 'running') t.status = 'done' }

    setMessages(prev => {
      const updated = [...prev]
      const last = updated[updated.length - 1]
      if (last && last.timestamp === ts) {
        updated[updated.length - 1] = { ...last, content: finalOutput, toolCalls: [...tools], stageId: STAGES[currentStage]?.id, fullContent: rawOutput }
      }
      return updated
    })

    // Auto-confirm stage if output was saved
    if (projectId) {
      try {
        const stageOutput = await fetchStageOutput(projectId, STAGES[currentStage].id)
        if (stageOutput) completeStage(currentStage)
      } catch { /* ignore */ }
    }

    return finalOutput
  }

  async function callAgentStreamSilent(message: string, agentName?: string, stageIdx?: number): Promise<string> {
    const idx = stageIdx ?? currentStage
    const agent = agentName ?? STAGES[idx].agent
    let accumulated = ''
    const done = await weaveStream('/v1/chat', {
      agent, session_id: sessionIds.current[idx] || '',
      message: withProjectContext(message), profile: `project_id=${projectId}`,
    }, (evt) => {
      if (evt.event === 'chunk') accumulated += (evt.data.content as string) || ''
    })
    if (done.session_id) sessionIds.current[idx] = done.session_id as string
    return (done.output as string) || accumulated || ''
  }

  // ── S2 multi-step ──

  async function runS2MultiStep(pid: string) {
    const stage = STAGES[1]
    const ts = new Date().toISOString()
    const s2Agent = 'ontology-architect'
    const s2Idx = 1
    const prompts = getS2Prompts(pid, stageVersions)

    const steps: StepProgress[] = [
      { label: '类与关系设计', status: 'running' },
      { label: '指标设计', status: 'pending' },
      { label: '遥测设计', status: 'pending' },
    ]
    setMessages(prev => [...prev, {
      role: 'agent', agentId: stage.agent, agentName: stage.name,
      content: '', timestamp: ts, steps: [...steps], round: currentRound,
    }])

    const updateSteps = (s: StepProgress[], content?: string) => {
      setMessages(prev => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last && last.timestamp === ts) updated[updated.length - 1] = { ...last, steps: [...s], ...(content !== undefined ? { content } : {}) }
        return updated
      })
    }

    setSending(true)
    try {
      await callAgentStreamSilent(prompts.round1, s2Agent, s2Idx)
      steps[0].status = 'done'; steps[1].status = 'running'
      updateSteps(steps, stageVersions[1] > 0 ? '类与关系增量更新完成' : '类与关系设计完成')

      await callAgentStreamSilent(prompts.round2, s2Agent, s2Idx)
      steps[1].status = 'done'; steps[2].status = 'running'
      updateSteps(steps, '指标设计完成')

      await callAgentStreamSilent(prompts.round3, s2Agent, s2Idx)
      steps[2].status = 'done'
      updateSteps(steps, '遥测设计完成')

      // Load and display the saved output
      try {
        const saved = await fetchStageOutput(pid, 'ontology_structure')
        if (saved) {
          const preview = saved.length > 500 ? saved.slice(0, 500) + '\n...' : saved
          setMessages(prev => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last && last.timestamp === ts) {
              updated[updated.length - 1] = {
                ...last, steps: [...steps],
                content: `**本体架构${stageVersions[1] > 0 ? '增量更新' : '设计'}完成** ✅\n\n\`\`\`yaml\n${preview}\n\`\`\``,
                stageId: 'ontology_structure', fullContent: saved,
              }
            }
            return updated
          })
          completeStage(1)
        }
      } catch { /* ignore */ }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const running = steps.find(s => s.status === 'running')
      if (running) running.status = 'error'
      updateSteps(steps, `设计失败: ${errMsg}`)
      setAlertState({ message: `本体架构设计失败: ${errMsg}`, type: 'error' })
    } finally {
      setSending(false)
    }
  }

  // ── File upload ──

  async function handleUploadDocument() { fileInputRef.current?.click() }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()

    setMessages(prev => [...prev, {
      role: 'user', content: `上传文档: ${file.name}`, timestamp: new Date().toISOString(), round: currentRound,
    }])

    setSending(true)
    try {
      let docId = ''
      try {
        const uploadResult = await mcpCall<{ document_id: string }>('upload_document', {
          project_id: projectId, filename: file.name, content: text,
        })
        docId = uploadResult.document_id
      } catch { /* continue */ }

      // Add to local document list as unanalyzed
      setDocuments(prev => [...prev, { id: docId || `local-${Date.now()}`, name: file.name, analyzed: false }])

      // Mark S1 and downstream dirty
      markDirtyFrom(0)

      // If S1 hasn't run yet, auto-start analysis
      if (stageVersions[0] === 0) {
        setCurrentStage(0)
        await callAgentStream(
          withProjectContext(`已上传文档「${file.name}」(document_id=${docId})。请调用 list_documents 获取文档列表，然后用 read_document 读取全文并开始分析。`)
        )
        // Mark docs as analyzed after S1 completes
        setDocuments(prev => prev.map(d => ({ ...d, analyzed: true })))
      } else {
        // S1 already has output — just inform user, don't auto-run
        addAgentMessage(`文档「${file.name}」已上传。场景分析需要更新以纳入新文档内容。`)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setAlertState({ message: `上传失败: ${msg}`, type: 'error' })
    } finally {
      setSending(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // ── Stage actions ──

  async function handleRunStage() {
    const pid = projectId!
    const targetStage = STAGES[currentStage]

    if (targetStage.id === 'ontology_structure') {
      runS2MultiStep(pid).catch(err => {
        setAlertState({ message: `本体架构设计失败: ${err instanceof Error ? err.message : String(err)}`, type: 'error' })
        setSending(false)
      })
      return
    }

    const prompt = getStagePrompt(targetStage.id, pid, stageVersions, newDocCount)
    setSending(true)
    try {
      await callAgentStream(withProjectContext(prompt))
      // After S1 completes, mark all docs as analyzed
      if (currentStage === 0) {
        setDocuments(prev => prev.map(d => ({ ...d, analyzed: true })))
        setCurrentRound(r => r + 1)
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      setAlertState({ message: `Agent 调用失败: ${errMsg}`, type: 'error' })
      addAgentMessage(`调用失败: ${errMsg}`)
    } finally {
      setSending(false)
    }
  }

  function handleSkip() {
    // Skip current dirty stage, advance to next
    const next = Math.min(currentStage + 1, STAGES.length - 1)
    setCurrentStage(next)
  }

  function handleClickStage(idx: number) {
    if (sending) return
    if (stageVersions[idx] > 0 || idx <= currentStage) {
      setCurrentStage(idx)
    }
  }

  async function handleSend() {
    if (!input.trim() || sending) return
    const msg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: msg, timestamp: new Date().toISOString(), round: currentRound }])
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

  // ── Render ──

  if (loading) return <div className={styles.loading}>加载中…</div>

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <div className={styles.back} onClick={() => navigate('/')}>← 返回</div>
        <div className={styles.projectTitle}>{project?.name || projectId} · 本体构建</div>
        {currentRound > 1 && <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>Round {currentRound}</span>}
      </div>

      <div className={styles.mainLayout}>
        {/* Left: Document panel */}
        <DocPanel
          documents={documents}
          onUpload={handleUploadDocument}
        />

        {/* Right: Progress + Chat + Bottom */}
        <div className={styles.rightContent}>
          <div style={{ padding: '12px 16px 0' }}>
            <ProgressBar
              stages={STAGES}
              stageVersions={stageVersions}
              stageDirty={stageDirty}
              currentStage={currentStage}
              sending={sending}
              onClickStage={handleClickStage}
            />
          </div>

          {/* Chat area */}
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
                    <span className={styles.agentAvatar} style={{ background: STAGES.find(s => s.agent === msg.agentId)?.color || '#6B6560' }}>
                      {msg.agentName?.[0] || 'A'}
                    </span>
                    <span className={styles.agentName}>{msg.agentName || msg.agentId}</span>
                  </div>
                )}
                <div className={styles.messageContent}>
                  {msg.fullContent && (
                    <div className={styles.stageActions}>
                      <button className={styles.stageActionBtn} title="预览完整内容"
                        onClick={() => setPreviewContent({ title: msg.agentName || '', content: msg.fullContent! })}>
                        👁
                      </button>
                      <button className={styles.stageActionBtn} title="下载 YAML"
                        onClick={() => handleDownload(msg.stageId || 'output', msg.fullContent!)}>
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
          <BottomBar
            stages={STAGES}
            stageVersions={stageVersions}
            stageDirty={stageDirty}
            currentStage={currentStage}
            sending={sending}
            input={input}
            newDocCount={newDocCount}
            onInputChange={setInput}
            onSend={handleSend}
            onUpload={handleUploadDocument}
            onRunStage={handleRunStage}
            onSkip={handleSkip}
            onGoToGraph={() => navigate(`/project/${projectId}/graph`)}
          />
        </div>
      </div>

      <input ref={fileInputRef} type="file" style={{ display: 'none' }}
        accept=".md,.txt,.docx,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={handleFileChange} />

      {/* Preview modal */}
      {previewContent && (
        <div className={styles.previewOverlay} onClick={() => setPreviewContent(null)}>
          <div className={styles.previewModal} onClick={e => e.stopPropagation()}>
            <div className={styles.previewHeader}>
              <span className={styles.previewTitle}>{previewContent.title}</span>
              <button className={styles.previewClose} onClick={() => setPreviewContent(null)}>&times;</button>
            </div>
            <pre className={styles.previewCode}>{previewContent.content}</pre>
          </div>
        </div>
      )}

      <AlertModal open={!!alertState} type={alertState?.type || 'error'} message={alertState?.message || ''} onClose={() => setAlertState(null)} />
    </div>
  )
}
