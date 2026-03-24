import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchProject, fetchStageOutput } from '../../api/ontology'
import { mcpCall } from '../../api/mcp'
import { weavePost } from '../../api/client'
import type { Project } from '../../types/ontology'
import { ConfirmModal, AlertModal } from '../../components/Modal'
import styles from './AgentBuild.module.css'

interface ChatMessage {
  role: 'user' | 'agent'
  agentId?: string
  agentName?: string
  content: string
  timestamp: string
}

interface WeaveResp {
  output?: string
  session_id?: string
  run_id?: string
  stop_reason?: string
}

const STAGES = [
  { id: 'scene_analysis', name: '场景分析', agent: 'scene-analyst', color: '#993C1D' },
  { id: 'ontology_structure', name: '本体架构', agent: 'ontology-architect', color: '#0F6E56' },
  { id: 'rules_actions', name: '规则设计', agent: 'rule-designer', color: '#534AB7' },
  { id: 'review_report', name: '审核', agent: 'ontology-reviewer', color: '#6B6560' },
]

function stageIndex(stage: string) {
  return STAGES.findIndex(s => s.id === stage)
}

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

  // File upload
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadExistingOutputs = useCallback(async (proj: Project) => {
    const idx = stageIndex(proj.current_stage)
    const confirmed = [false, false, false, false]

    for (let i = 0; i < Math.min(idx, 4); i++) {
      const content = await fetchStageOutput(projectId!, STAGES[i].id)
      if (content) {
        confirmed[i] = true
        setMessages(prev => [...prev, {
          role: 'agent',
          agentId: STAGES[i].agent,
          agentName: STAGES[i].name,
          content: `${STAGES[i].name}已完成。输出已保存。`,
          timestamp: new Date().toISOString(),
        }])
      }
    }
    setStageConfirmed(confirmed)
  }, [projectId])

  useEffect(() => {
    if (!projectId) return

    fetchProject(projectId)
      .then(p => {
        setProject(p)
        setCurrentStage(Math.max(0, stageIndex(p.current_stage)))
        loadExistingOutputs(p)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId, loadExistingOutputs])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function callAgent(message: string): Promise<string> {
    const stage = STAGES[currentStage]
    const resp = await weavePost<WeaveResp>('/v1/chat', {
      agent: stage.agent,
      session_id: sessionIds.current[currentStage] || '',
      message,
      profile: `project_id=${projectId}`,
    })

    // Store session_id for conversation continuity
    if (resp.session_id) {
      sessionIds.current[currentStage] = resp.session_id
    }

    return resp.output || '(无响应)'
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
      // Save the document to MCP for the agent to read via read_document tool
      try {
        await mcpCall('save_output', {
          project_id: projectId,
          stage: 'document',
          content: text,
        })
      } catch {
        // document stage may not exist, continue anyway
      }

      addAgentMessage(`正在分析文档 "${file.name}"…`)

      const output = await callAgent(
        `请分析以下调研文档，项目ID为 ${projectId}:\n\n${text.slice(0, 10000)}`
      )
      addAgentMessage(output)
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
      const output = await callAgent(msg)
      addAgentMessage(output)
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      setAlertState({ message: `Agent 调用失败: ${errMsg}`, type: 'error' })
      addAgentMessage(`调用失败: ${errMsg}`)
    } finally {
      setSending(false)
    }
  }

  async function handleConfirmStage() {
    if (currentStage >= STAGES.length - 1) {
      // Last stage (review), navigate to visual review
      navigate(`/project/${projectId}/graph`)
      return
    }

    // Update project stage on the server
    try {
      const nextStageId = STAGES[currentStage + 1].id
      await mcpCall('save_output', {
        project_id: projectId,
        stage: STAGES[currentStage].id,
        content: `stage_confirmed_at: ${new Date().toISOString()}`,
      })
      // Advance project current_stage (if server supports it)
      // For now, just advance locally
      void nextStageId
    } catch {
      // Continue even if save fails
    }

    const newConfirmed = [...stageConfirmed]
    newConfirmed[currentStage] = true
    setStageConfirmed(newConfirmed)
    setCurrentStage(currentStage + 1)

    const nextStage = STAGES[currentStage + 1]
    setMessages(prev => [...prev, {
      role: 'agent',
      agentId: nextStage.agent,
      agentName: nextStage.name,
      content: `${nextStage.name}阶段已启动。请发送消息开始。`,
      timestamp: new Date().toISOString(),
    }])
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
            className={`${styles.progressStage} ${i === currentStage ? styles.progressCurrent : ''} ${stageConfirmed[i] ? styles.progressDone : ''}`}
            onClick={() => handleClickStage(i)}
          >
            <div className={styles.progressDot} style={{ background: i <= currentStage ? stage.color : undefined }} />
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
              {msg.content.split('\n').map((line, j) => (
                <span key={j}>{line}{j < msg.content.split('\n').length - 1 && <br />}</span>
              ))}
            </div>
          </div>
        ))}
        {sending && (
          <div className={`${styles.message} ${styles.messageAgent}`}>
            <div className={styles.agentHeader}>
              <span
                className={styles.agentAvatar}
                style={{ background: STAGES[currentStage]?.color || '#6B6560' }}
              >
                {STAGES[currentStage].name[0]}
              </span>
              <span className={styles.agentName}>{STAGES[currentStage].name}</span>
            </div>
            <div className={styles.messageContent}>
              <span className={styles.thinking}>思考中…</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Bottom bar */}
      <div className={styles.bottomBar}>
        {messages.length > 0 && !stageConfirmed[currentStage] && !sending && (
          <button className={styles.confirmBtn} onClick={handleConfirmStage}>
            {currentStage < STAGES.length - 1 ? `确认，进入${STAGES[currentStage + 1].name}` : '进入可视化审核'}
          </button>
        )}
        <div className={styles.inputRow}>
          <button className={styles.attachBtn} onClick={handleUploadDocument} title="上传文档">📎</button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.txt,.docx"
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
            {sending ? '…' : '发送'}
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
    </div>
  )
}
