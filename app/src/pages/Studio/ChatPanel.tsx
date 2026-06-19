import { useRef, useState } from 'react'
import { eidosChatStream } from '../../api/client'
import styles from './Studio.module.css'

interface ToolChip {
  name: string
  status: 'running' | 'done' | 'error'
}

interface Msg {
  role: 'user' | 'assistant'
  content: string
  tools?: ToolChip[]
  ts: string
}

// 写类工具:出现就说明本体被改了,触发右侧刷新。
const WRITE_PREFIXES = ['save_ontology', 'upsert_', 'realign_', 'restore_', 'approve_', 'reject_', 'publish_']
function isWriteTool(name: string) {
  return WRITE_PREFIXES.some(p => name.startsWith(p))
}

export function ChatPanel({ ontologyId, onChanged }: { ontologyId: string; onChanged: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    })
  }

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)
    const ts = new Date().toISOString()
    setMessages(prev => [
      ...prev,
      { role: 'user', content: text, ts },
      { role: 'assistant', content: '', tools: [], ts: ts + '-a' },
    ])
    scrollToBottom()

    let acc = ''
    const tools: ToolChip[] = []
    let changed = false
    const updateAssistant = () => {
      setMessages(prev => {
        const u = [...prev]
        const last = u[u.length - 1]
        if (last && last.role === 'assistant') {
          u[u.length - 1] = { ...last, content: acc, tools: [...tools] }
        }
        return u
      })
      scrollToBottom()
    }

    try {
      await eidosChatStream(
        { agent: 'ontology-architect', message: text, profile: `project_id=${ontologyId}` },
        (evt) => {
          if (evt.event === 'chunk') {
            acc += (evt.data.content as string) || ''
            updateAssistant()
          } else if (evt.event === 'tool_call') {
            const name = (evt.data.name as string) || ''
            tools.push({ name, status: 'running' })
            updateAssistant()
          } else if (evt.event === 'tool_result') {
            const name = (evt.data.name as string) || ''
            const status = (evt.data.status as string) === 'error' ? 'error' : 'done'
            for (let i = tools.length - 1; i >= 0; i--) {
              if (tools[i].name === name && tools[i].status === 'running') {
                tools[i] = { ...tools[i], status }
                break
              }
            }
            if (status === 'done' && isWriteTool(name)) {
              changed = true
              onChanged() // 实时刷新右侧
            }
            updateAssistant()
          } else if (evt.event === 'done') {
            const out = (evt.data.output as string) || ''
            if (out && !acc) { acc = out; updateAssistant() }
            if (evt.data.error) {
              acc = (acc ? acc + '\n\n' : '') + '⚠ ' + (evt.data.error as string)
              updateAssistant()
            }
          }
        },
      )
    } catch (e) {
      acc = (acc ? acc + '\n\n' : '') + '⚠ ' + (e instanceof Error ? e.message : String(e))
      updateAssistant()
    } finally {
      // 收尾兜底刷新一次,确保右侧最终一致。
      if (changed) onChanged()
      else onChanged()
      setBusy(false)
    }
  }

  return (
    <div className={styles.chatPanel}>
      <div className={styles.chatScroll} ref={scrollRef}>
        {messages.length === 0 && (
          <div className={styles.chatEmpty}>
            和本体架构师对话来建模型。<br />
            例如:「建一个客户对象,含名称和等级」「给订单加一个金额属性」
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? styles.msgUser : styles.msgAssistant}>
            {m.tools && m.tools.length > 0 && (
              <div className={styles.toolChips}>
                {m.tools.map((t, j) => (
                  <span key={j} className={`${styles.chip} ${styles[`chip_${t.status}`]}`}>
                    {t.status === 'running' ? '⚙' : t.status === 'error' ? '✗' : '✓'} {t.name}
                  </span>
                ))}
              </div>
            )}
            {m.content && <div className={styles.msgBody}>{m.content}</div>}
            {m.role === 'assistant' && !m.content && (!m.tools || m.tools.length === 0) && busy && (
              <div className={styles.msgBody}>思考中…</div>
            )}
          </div>
        ))}
      </div>
      <div className={styles.chatInput}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="描述你要的业务模型…(Enter 发送,Shift+Enter 换行)"
          rows={2}
          disabled={busy}
        />
        <button onClick={send} disabled={busy || !input.trim()}>{busy ? '…' : '发送'}</button>
      </div>
    </div>
  )
}
