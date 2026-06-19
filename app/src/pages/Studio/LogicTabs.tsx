import { useState } from 'react'
import { mcpCall } from '../../api/mcp'
import type { Ontology, OntologyRule, OntologyMetric, OntologyAction } from '../../types/ontology'
import styles from './Studio.module.css'

// 规则/指标/动作 深度表单。三者都在版本化库的同一份 Ontology doc 里(Rules/Metrics/Actions),
// 没有粒度工具,所以"读—改—整存"经 save_ontology_doc 回写;改完 onChanged() 刷新。

type SaveProps = { ontology: Ontology | null; onChanged: () => void }

function useDocSaver(ontology: Ontology | null, onChanged: () => void) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function save(next: Ontology) {
    setBusy(true); setErr('')
    try {
      await mcpCall('save_ontology_doc', { ontology_json: JSON.stringify(next) })
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return { save, busy, err, ready: !!ontology }
}

function genId(prefix: string, existing: string[]): string {
  for (let i = 1; i < 999; i++) {
    const id = `${prefix}_${i}`
    if (!existing.includes(id)) return id
  }
  return `${prefix}_x`
}

function EmptyHint({ text }: { text: string }) {
  return <div className={styles.capability}>{text}</div>
}

// ─────────── 规则 ───────────
const TRIGGER_TYPES = ['before_action', 'after_action', 'schedule'] as const

export function RulesTab({ ontology, onChanged }: SaveProps) {
  const { save, err } = useDocSaver(ontology, onChanged)
  if (!ontology) return <EmptyHint text="先在左边对话建模,再来配规则。" />
  const rules = ontology.rules || []
  const classes = ontology.classes || []

  const commit = (next: OntologyRule[]) => save({ ...ontology, rules: next })
  const update = (i: number, patch: Partial<OntologyRule>) => commit(rules.map((r, j) => j === i ? { ...r, ...patch } : r))
  const add = () => commit([...rules, {
    id: genId('rule', rules.map(r => r.id)), name: '新规则',
    trigger: { type: 'after_action' }, condition: { entity: classes[0]?.id || '', expression: '' },
    action: { type: 'notify' },
  }])

  return (
    <div>
      {err && <div className={styles.errLine}>⚠ {err}</div>}
      {rules.length === 0 && <EmptyHint text="暂无规则。规则 = 什么条件下怎么办(ECA)。" />}
      {rules.map((r, i) => (
        <div key={r.id} className={styles.logicCard}>
          <div className={styles.logicHead}>
            <input className={styles.logicName} defaultValue={r.name} onBlur={e => e.target.value !== r.name && update(i, { name: e.target.value })} />
            <span className={styles.logicId}>{r.id}</span>
            <button className={styles.delBtn} title="删除" onClick={() => commit(rules.filter((_, j) => j !== i))}>×</button>
          </div>
          <div className={styles.formGrid}>
            <label className={styles.fLabel}>触发</label>
            <select className={styles.fInput} value={r.trigger?.type || 'after_action'} onChange={e => update(i, { trigger: { ...r.trigger, type: e.target.value as typeof TRIGGER_TYPES[number] } })}>
              {TRIGGER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <label className={styles.fLabel}>触发源</label>
            <input className={styles.fInput} defaultValue={(r.trigger?.source || []).join(', ')} placeholder="A01, A02 或 cron" onBlur={e => update(i, { trigger: { ...r.trigger, type: r.trigger?.type || 'after_action', source: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } })} />
            <label className={styles.fLabel}>条件对象</label>
            <select className={styles.fInput} value={r.condition?.entity || ''} onChange={e => update(i, { condition: { ...r.condition, entity: e.target.value } })}>
              <option value="">(选对象)</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}（{c.id}）</option>)}
            </select>
            <label className={styles.fLabel}>条件表达式</label>
            <input className={styles.fInput} defaultValue={r.condition?.expression || ''} placeholder="如 amount > 100000" onBlur={e => update(i, { condition: { ...r.condition, expression: e.target.value } })} />
            <label className={styles.fLabel}>动作类型</label>
            <input className={styles.fInput} defaultValue={r.action?.type || ''} placeholder="notify / set_attribute …" onBlur={e => update(i, { action: { ...r.action, type: e.target.value } })} />
            <label className={styles.fLabel}>动作目标</label>
            <input className={styles.fInput} defaultValue={r.action?.target || ''} onBlur={e => update(i, { action: { ...r.action, type: r.action?.type || '', target: e.target.value } })} />
            <label className={styles.fLabel}>提示文案</label>
            <input className={styles.fInput} defaultValue={r.action?.message_template || ''} onBlur={e => update(i, { action: { ...r.action, type: r.action?.type || '', message_template: e.target.value } })} />
          </div>
        </div>
      ))}
      <button className={styles.addAttrBtn} onClick={add}>+ 新增规则</button>
    </div>
  )
}

// ─────────── 指标 ───────────
const METRIC_KINDS = ['aggregate', 'composite', 'classification'] as const
const METRIC_STATUS = ['implemented', 'designed', 'undefined'] as const

export function MetricsTab({ ontology, onChanged }: SaveProps) {
  const { save, err } = useDocSaver(ontology, onChanged)
  if (!ontology) return <EmptyHint text="先在左边对话建模,再来配指标。" />
  const metrics = ontology.metrics || []
  const classes = ontology.classes || []

  const commit = (next: OntologyMetric[]) => save({ ...ontology, metrics: next })
  const update = (i: number, patch: Partial<OntologyMetric>) => commit(metrics.map((m, j) => j === i ? { ...m, ...patch } : m))
  const add = () => commit([...metrics, {
    id: genId('metric', metrics.map(m => m.id)), name: '新指标', description: '',
    phase: 'alpha', kind: 'aggregate', source_entities: [], status: 'designed',
  }])

  return (
    <div>
      {err && <div className={styles.errLine}>⚠ {err}</div>}
      {metrics.length === 0 && <EmptyHint text="暂无指标。指标 = 怎么算出一个数(formula)。" />}
      {metrics.map((m, i) => (
        <div key={m.id} className={styles.logicCard}>
          <div className={styles.logicHead}>
            <input className={styles.logicName} defaultValue={m.name} onBlur={e => e.target.value !== m.name && update(i, { name: e.target.value })} />
            <select className={styles.fInputInline} value={m.kind} onChange={e => update(i, { kind: e.target.value as typeof METRIC_KINDS[number] })}>
              {METRIC_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <span className={styles.logicId}>{m.id}</span>
            <button className={styles.delBtn} title="删除" onClick={() => commit(metrics.filter((_, j) => j !== i))}>×</button>
          </div>
          <div className={styles.formGrid}>
            <label className={styles.fLabel}>说明</label>
            <input className={styles.fInput} defaultValue={m.description || ''} onBlur={e => update(i, { description: e.target.value })} />
            <label className={styles.fLabel}>计算口径</label>
            <input className={styles.fInput} defaultValue={m.formula || ''} placeholder="如 SUM(order.amount) / COUNT(customer)" onBlur={e => update(i, { formula: e.target.value })} />
            <label className={styles.fLabel}>来源对象</label>
            <div className={styles.chipPick}>
              {classes.map(c => {
                const on = (m.source_entities || []).includes(c.id)
                return <button key={c.id} className={`${styles.chipPickBtn} ${on ? styles.chipPickOn : ''}`}
                  onClick={() => update(i, { source_entities: on ? (m.source_entities || []).filter(x => x !== c.id) : [...(m.source_entities || []), c.id] })}>{c.name}</button>
              })}
            </div>
            <label className={styles.fLabel}>粒度</label>
            <input className={styles.fInput} defaultValue={m.granularity || ''} placeholder="system / warehouse …" onBlur={e => update(i, { granularity: e.target.value })} />
            <label className={styles.fLabel}>状态</label>
            <select className={styles.fInput} value={m.status} onChange={e => update(i, { status: e.target.value as typeof METRIC_STATUS[number] })}>
              {METRIC_STATUS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      ))}
      <button className={styles.addAttrBtn} onClick={add}>+ 新增指标</button>
    </div>
  )
}

// ─────────── 动作 ───────────
export function ActionsTab({ ontology, onChanged }: SaveProps) {
  const { save, err } = useDocSaver(ontology, onChanged)
  if (!ontology) return <EmptyHint text="先在左边对话建模,再来配动作。" />
  const actions = ontology.actions || []

  const commit = (next: OntologyAction[]) => save({ ...ontology, actions: next })
  const update = (i: number, patch: Partial<OntologyAction>) => commit(actions.map((a, j) => j === i ? { ...a, ...patch } : a))
  const add = () => commit([...actions, { id: genId('action', actions.map(a => a.id)), name: '新动作', params: [], writes: [] }])

  return (
    <div>
      {err && <div className={styles.errLine}>⚠ {err}</div>}
      {actions.length === 0 && <EmptyHint text="暂无动作。动作 = 规则触发后执行的副作用(写回属性等)。" />}
      {actions.map((a, i) => (
        <div key={a.id} className={styles.logicCard}>
          <div className={styles.logicHead}>
            <input className={styles.logicName} defaultValue={a.name} onBlur={e => e.target.value !== a.name && update(i, { name: e.target.value })} />
            <span className={styles.logicId}>{a.id}</span>
            <label className={styles.fCheck}>
              <input type="checkbox" checked={!!a.decision_log} onChange={e => update(i, { decision_log: e.target.checked })} /> 决策日志
            </label>
            <button className={styles.delBtn} title="删除" onClick={() => commit(actions.filter((_, j) => j !== i))}>×</button>
          </div>
          <div className={styles.formGrid}>
            <label className={styles.fLabel}>说明</label>
            <input className={styles.fInput} defaultValue={a.description || ''} onBlur={e => update(i, { description: e.target.value })} />
          </div>
          {/* 写回(writes):target + set(key=val,逗号分隔) */}
          <div className={styles.subTitle}>写回（{(a.writes || []).length}）</div>
          {(a.writes || []).map((w, wi) => (
            <div key={wi} className={styles.writeRow}>
              <input className={styles.fInput} defaultValue={w.target} placeholder="目标 如 order.status"
                onBlur={e => { const ws = [...(a.writes || [])]; ws[wi] = { ...w, target: e.target.value }; update(i, { writes: ws }) }} />
              <input className={styles.fInput} defaultValue={Object.entries(w.set || {}).map(([k, v]) => `${k}=${v}`).join(', ')} placeholder="status=已发货, qty=0"
                onBlur={e => {
                  const set: Record<string, string> = {}
                  e.target.value.split(',').map(s => s.trim()).filter(Boolean).forEach(kv => { const [k, ...r] = kv.split('='); if (k) set[k.trim()] = r.join('=').trim() })
                  const ws = [...(a.writes || [])]; ws[wi] = { ...w, set }; update(i, { writes: ws })
                }} />
              <button className={styles.delBtn} onClick={() => update(i, { writes: (a.writes || []).filter((_, j) => j !== wi) })}>×</button>
            </div>
          ))}
          <button className={styles.addAttrBtn} onClick={() => update(i, { writes: [...(a.writes || []), { target: '', set: {} }] })}>+ 写回</button>
        </div>
      ))}
      <button className={styles.addAttrBtn} onClick={add}>+ 新增动作</button>
    </div>
  )
}
