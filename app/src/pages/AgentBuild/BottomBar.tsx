import { useRef } from 'react'
import type { StageInfo } from './types'
import styles from './AgentBuild.module.css'

interface Props {
  stages: StageInfo[]
  stageVersions: number[]
  stageDirty: boolean[]
  currentStage: number
  sending: boolean
  input: string
  newDocCount: number
  onInputChange: (val: string) => void
  onSend: () => void
  onUpload: () => void
  onRunStage: () => void
  onSkip: () => void
  onGoToGraph: () => void
}

export function BottomBar({
  stages, stageVersions, stageDirty, currentStage, sending, input, newDocCount,
  onInputChange, onSend, onUpload, onRunStage, onSkip, onGoToGraph,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const stage = stages[currentStage]
  const version = stageVersions[currentStage]
  const dirty = stageDirty[currentStage]
  const allDone = stageVersions.every(v => v > 0) && !stageDirty.some(d => d)
  const isLast = currentStage >= stages.length - 1

  // Determine hint and action buttons
  let hint = ''
  let primaryLabel = ''
  let showSkip = false

  if (allDone) {
    // All stages complete, no dirty
    hint = ''
    primaryLabel = '进入可视化审核'
  } else if (version === 0) {
    // Never run
    primaryLabel = `开始${stage.name}`
  } else if (dirty && currentStage === 0 && newDocCount > 0) {
    // S1 dirty because new docs
    hint = `有 ${newDocCount} 份新文档未分析`
    primaryLabel = `重新分析场景 (增量)`
    showSkip = true
  } else if (dirty) {
    // Stage dirty because upstream changed
    const upstreamName = currentStage > 0 ? stages[currentStage - 1].name : '场景分析'
    hint = `${upstreamName}已更新到 v${stageVersions[currentStage - 1]}，${stage.name}基于旧版本`
    primaryLabel = `更新${stage.name} (增量)`
    showSkip = true
  } else if (version > 0 && !isLast) {
    // Done, not dirty, can advance
    primaryLabel = `确认，进入${stages[currentStage + 1].name}`
  } else if (version > 0 && isLast) {
    primaryLabel = '进入可视化审核'
  }

  return (
    <div className={styles.bottomBar}>
      {hint && (
        <div className={styles.bottomHint}>
          <span className={styles.hintIcon}>⚠</span> {hint}
        </div>
      )}

      {!sending && primaryLabel && (
        <div className={styles.bottomActions}>
          <button
            className={styles.confirmBtn}
            onClick={allDone || (version > 0 && isLast) ? onGoToGraph : onRunStage}
          >
            {primaryLabel}
          </button>
          {showSkip && (
            <button className={styles.skipBtn} onClick={onSkip}>
              跳过 →
            </button>
          )}
        </div>
      )}

      <div className={styles.inputRow}>
        <button className={styles.attachBtn} onClick={onUpload} title="上传文档">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
        </button>
        <input
          type="file"
          ref={fileInputRef}
          accept=".md,.txt,.docx,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          style={{ display: 'none' }}
        />
        <input
          className={styles.chatInput}
          value={input}
          onChange={e => onInputChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && onSend()}
          placeholder={`跟 ${stage?.name || ''} Agent 对话…`}
          disabled={sending}
        />
        <button className={styles.sendBtn} onClick={onSend} disabled={sending || !input.trim()}>
          {sending ? '处理中' : '发送'}
        </button>
      </div>
    </div>
  )
}
