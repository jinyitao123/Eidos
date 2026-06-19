import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchOntologyDoc, fetchHealth } from '../../api/rest'
import { fetchOntology } from '../../api/ontology'
import { mcpCall } from '../../api/mcp'
import type { Ontology } from '../../types/ontology'
import { ChatPanel } from './ChatPanel'
import { GraphTab } from './GraphTab'
import { InstancesTab, EvalTab } from './tabs'
import { RulesTab, MetricsTab, ActionsTab } from './LogicTabs'
import { Drawer, type DrawerKind } from './Drawer'
import styles from './Studio.module.css'

type Tab = 'graph' | 'instances' | 'rules' | 'metrics' | 'actions' | 'eval'
const TABS: { key: Tab; label: string }[] = [
  { key: 'graph', label: '图谱' },
  { key: 'instances', label: '实例' },
  { key: 'rules', label: '规则' },
  { key: 'metrics', label: '指标' },
  { key: 'actions', label: '动作' },
  { key: 'eval', label: '评估' },
]

export function Studio() {
  const { projectId } = useParams()
  const id = projectId || ''
  const [ontology, setOntology] = useState<Ontology | null>(null)
  const [score, setScore] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>('graph')
  const [drawer, setDrawer] = useState<DrawerKind>(null)
  const [refreshSeq, setRefreshSeq] = useState(0)

  const refresh = useCallback(async () => {
    if (!id) return
    try {
      setOntology(await fetchOntologyDoc(id))
    } catch {
      // 版本化库还没有这份本体 → 尝试从旧库(projects/stage_outputs)懒迁移一次。
      const old = await fetchOntology(id).catch(() => null)
      if (old && ((old.classes?.length ?? 0) > 0 || (old.relationships?.length ?? 0) > 0)) {
        try {
          await mcpCall('save_ontology_doc', { ontology_json: JSON.stringify({ ...old, id, name: old.name || id }) })
          setOntology(await fetchOntologyDoc(id))
        } catch { setOntology(null) }
      } else {
        setOntology(null)
      }
    }
    fetchHealth(id).then(r => setScore(r.score)).catch(() => setScore(null))
    setRefreshSeq(s => s + 1)
  }, [id])

  useEffect(() => { refresh() }, [refresh])

  const healthLevel = score == null ? 'none' : score >= 80 ? 'good' : score >= 60 ? 'warn' : 'bad'

  return (
    <div className={styles.studio}>
      <div className={styles.left}>
        <ChatPanel ontologyId={id} onChanged={refresh} />
      </div>
      <div className={styles.right}>
        <div className={styles.topbar}>
          <span className={styles.ontName}>{ontology?.name || '本体'}</span>
          <button
            className={`${styles.healthBadge} ${styles[`health_${healthLevel}`]}`}
            onClick={() => setTab('eval')}
            title="健康分"
          >{score == null ? '健康 —' : `健康 ${score}`}</button>
          <div className={styles.tabs}>
            {TABS.map(t => (
              <button key={t.key}
                className={`${styles.tab} ${tab === t.key ? styles.tabActive : ''}`}
                onClick={() => setTab(t.key)}>{t.label}</button>
            ))}
          </div>
          <div className={styles.topbarRight}>
            <button className={styles.drawerBtn} onClick={() => setDrawer('versions')}>版本</button>
            <button className={styles.drawerBtn} onClick={() => setDrawer('inheritance')}>继承</button>
          </div>
        </div>
        <div className={styles.body}>
          {tab === 'graph' && <GraphTab ontology={ontology} ontologyId={id} onChanged={refresh} />}
          {tab === 'instances' && <InstancesTab />}
          {tab === 'rules' && <RulesTab ontology={ontology} onChanged={refresh} />}
          {tab === 'metrics' && <MetricsTab ontology={ontology} onChanged={refresh} />}
          {tab === 'actions' && <ActionsTab ontology={ontology} onChanged={refresh} />}
          {tab === 'eval' && <EvalTab id={id} refreshSeq={refreshSeq} />}
        </div>
      </div>
      <Drawer kind={drawer} id={id} onClose={() => setDrawer(null)} onChanged={refresh} />
    </div>
  )
}
