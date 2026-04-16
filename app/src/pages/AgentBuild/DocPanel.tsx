import type { DocInfo } from './types'
import styles from './AgentBuild.module.css'

interface Props {
  documents: DocInfo[]
  onUpload: () => void
  onPreview?: (doc: DocInfo) => void
}

export function DocPanel({ documents, onUpload, onPreview }: Props) {
  const newCount = documents.filter(d => !d.analyzed).length

  return (
    <div className={styles.docPanel}>
      <div className={styles.docHeader}>
        <span className={styles.docTitle}>调研文档</span>
        {newCount > 0 && <span className={styles.docBadge}>{newCount} 新</span>}
      </div>

      <div className={styles.docList}>
        {documents.map(doc => (
          <div
            key={doc.id}
            className={styles.docItem}
            onClick={() => onPreview?.(doc)}
            title={doc.name}
          >
            <span className={styles.docIcon}>
              {doc.analyzed ? '📄' : '📄'}
            </span>
            <div className={styles.docInfo}>
              <span className={styles.docName}>{doc.name}</span>
              <span className={doc.analyzed ? styles.docAnalyzed : styles.docNew}>
                {doc.analyzed ? '已分析' : '待分析'}
              </span>
            </div>
          </div>
        ))}
      </div>

      <button className={styles.docUploadBtn} onClick={onUpload}>
        + 上传文档
      </button>

      {documents.length > 0 && (
        <div className={styles.docStats}>
          {documents.length} 份文档
          {newCount > 0 && ` · ${newCount} 待分析`}
        </div>
      )}
    </div>
  )
}
