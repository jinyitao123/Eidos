import type { StageInfo } from './types'
import styles from './AgentBuild.module.css'

interface Props {
  stages: StageInfo[]
  stageVersions: number[]
  stageDirty: boolean[]
  currentStage: number
  sending: boolean
  onClickStage: (idx: number) => void
}

export function ProgressBar({ stages, stageVersions, stageDirty, currentStage, sending, onClickStage }: Props) {
  return (
    <div className={styles.progressBar}>
      {stages.map((stage, i) => {
        const version = stageVersions[i]
        const dirty = stageDirty[i]
        const isCurrent = i === currentStage
        const isDone = version > 0
        const isActive = isCurrent && sending

        let dotClass = styles.progressStage
        if (isDone && !dirty) dotClass += ' ' + styles.progressDone
        else if (isDone && dirty) dotClass += ' ' + styles.progressDirty
        else if (isCurrent) dotClass += ' ' + styles.progressCurrent

        return (
          <div key={stage.id} className={dotClass} onClick={() => !sending && onClickStage(i)}>
            <div
              className={styles.progressDot}
              style={{
                background: isActive ? stage.color
                  : isDone && !dirty ? '#0F6E56'
                  : isDone && dirty ? '#B85C1E'
                  : isCurrent ? stage.color
                  : undefined,
              }}
            >
              {isActive && <span className={styles.progressSpin}>●</span>}
            </div>
            <div className={styles.progressLabelGroup}>
              <span className={styles.progressLabel}>{stage.name}</span>
              {version > 0 && (
                <span className={styles.progressVersion}>
                  v{version}{dirty ? ' ⟳' : ''}
                </span>
              )}
            </div>
            {i < stages.length - 1 && (
              <div className={`${styles.progressLine} ${isDone && !dirty ? styles.progressLineDone : ''}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
