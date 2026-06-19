import { useEffect, useState } from 'react'
import { fetchHealth } from '../../api/rest'
import type { HealthReport } from '../../types/ontology'
import styles from './Studio.module.css'

// 实例 tab(02 §5.2):版本化库无实例数据 → 能力态(不道歉不造假,02 §12)。
export function InstancesTab() {
  return (
    <div className={styles.capability}>
      实例视图在接入数据源后显示。<br />
      当前为结构构建期,版本化库只存"是什么"。
    </div>
  )
}

// 规则/指标深度表单已移到 LogicTabs.tsx(读—改—整存)。

// 评估 tab(02 §7.1):健康环 + findings(可视化,非文字墙)。
export function EvalTab({ id, refreshSeq }: { id: string; refreshSeq: number }) {
  const [report, setReport] = useState<HealthReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    setLoading(true)
    fetchHealth(id).then(setReport).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [id, refreshSeq])

  if (loading) return <div className={styles.capability}>评估中…</div>
  if (error || !report) return <div className={styles.capability}>还没有可评估的本体,先在左边建模。</div>

  const level = report.score >= 80 ? 'good' : report.score >= 60 ? 'warn' : 'bad'
  return (
    <div className={styles.evalWrap}>
      <div className={`${styles.ring} ${styles[`health_${level}`]}`}>
        <span className={styles.ringNum}>{report.score}</span>
        <span className={styles.ringUnit}>/ 100</span>
      </div>
      <div>
        {report.findings.map((f, i) => <div key={i} className={styles.findingItem}>{f}</div>)}
      </div>
    </div>
  )
}
