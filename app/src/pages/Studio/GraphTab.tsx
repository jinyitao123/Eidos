import { useState } from 'react'
import { mcpCall } from '../../api/mcp'
import type { Ontology, OntologyClass, OntologyAttribute } from '../../types/ontology'
import { GraphCanvas } from './GraphCanvas'
import styles from './Studio.module.css'

const ATTR_TYPES = ['text', 'number', 'date', 'bool', 'enum', 'ref'] as const
const KIND_LABEL: Record<string, string> = { person: '人', event: '事', thing: '物' }

// 图谱 tab(02 §5.1):业务对象 + 属性 + 关系,内联编辑经版本化库工具回写。
export function GraphTab({
  ontology, ontologyId, onChanged,
}: { ontology: Ontology | null; ontologyId: string; onChanged: () => void }) {
  const [err, setErr] = useState('')
  const [busyKey, setBusyKey] = useState('')
  const [view, setView] = useState<'cards' | 'graph'>('cards')

  async function call(key: string, tool: string, args: Record<string, unknown>) {
    setBusyKey(key); setErr('')
    try { await mcpCall(tool, args); onChanged() }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setBusyKey('') }
  }
  const upsertEntity = (cls: OntologyClass) =>
    call(`e:${cls.id}`, 'upsert_entity', { ontology_id: ontologyId, entity_json: JSON.stringify(cls) })
  const upsertAttr = (classId: string, attr: OntologyAttribute) =>
    call(`a:${classId}.${attr.id}`, 'upsert_attribute', { ontology_id: ontologyId, entity_id: classId, attribute_json: JSON.stringify(attr) })

  if (!ontology || (ontology.classes || []).length === 0) {
    return (
      <div className={styles.empty}>
        版本化库里还没有内容。<br />
        在左边对话(如「建一个客户对象,含名称和等级」),业务对象会实时出现在这里。
      </div>
    )
  }

  const classes = ontology.classes || []
  const rels = ontology.relationships || []

  return (
    <div>
      {err && <div className={styles.errLine}>⚠ {err}</div>}
      <div className={styles.viewToggle}>
        <button className={view === 'cards' ? styles.viewOn : ''} onClick={() => setView('cards')}>卡片</button>
        <button className={view === 'graph' ? styles.viewOn : ''} onClick={() => setView('graph')}>图</button>
      </div>
      {view === 'graph' && <GraphCanvas ontology={ontology} onPick={() => setView('cards')} />}
      {view === 'cards' && classes.map(cls => (
        <div key={cls.id} className={styles.classCard}>
          <div className={styles.classHead}>
            <button
              className={`${styles.fcStar} ${cls.first_citizen ? styles.fcOn : ''}`}
              title="第一公民"
              onClick={() => upsertEntity({ ...cls, first_citizen: !cls.first_citizen })}
            >★</button>
            <input
              className={styles.classNameInput}
              defaultValue={cls.name}
              onBlur={e => { if (e.target.value !== cls.name) upsertEntity({ ...cls, name: e.target.value }) }}
            />
            {cls.kind && <span className={styles.kindBadge}>{KIND_LABEL[cls.kind] || cls.kind}</span>}
            {cls.status && cls.status !== 'confirmed' && <span className={styles.pendingBadge}>待确认</span>}
            <span className={styles.classId}>{cls.id}</span>
            {busyKey === `e:${cls.id}` && <span className={styles.spin}>…</span>}
          </div>
          <table className={styles.attrTable}>
            <tbody>
              {(cls.attributes || []).map(attr => (
                <tr key={attr.id}>
                  <td>
                    <input className={styles.attrName} defaultValue={attr.name}
                      onBlur={e => { if (e.target.value !== attr.name) upsertAttr(cls.id, { ...attr, name: e.target.value }) }} />
                  </td>
                  <td className={styles.attrIdCell}>{attr.id}{attr.unit ? ` · ${attr.unit}` : ''}</td>
                  <td>
                    <select className={styles.attrType}
                      value={ATTR_TYPES.includes(attr.type as typeof ATTR_TYPES[number]) ? attr.type : 'text'}
                      onChange={e => upsertAttr(cls.id, { ...attr, type: e.target.value as OntologyAttribute['type'] })}>
                      {ATTR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td>
                    <button className={styles.delBtn} title="删除属性"
                      onClick={() => upsertEntity({ ...cls, attributes: (cls.attributes || []).filter(a => a.id !== attr.id) })}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <AddAttr onAdd={a => upsertAttr(cls.id, a)} />
        </div>
      ))}

      {view === 'cards' && rels.length > 0 && (
        <div className={styles.relSection}>
          <div className={styles.relTitle}>关系（{rels.length}）</div>
          {rels.map(r => (
            <div key={r.id} className={styles.relRow}>
              <span>{nameOf(classes, r.from)}</span>
              <span className={styles.relArrow}>—{r.name}→</span>
              <span>{nameOf(classes, r.to)}</span>
              {r.cardinality && <span className={styles.relCard}>{r.cardinality}</span>}
            </div>
          ))}
          <div className={styles.relHint}>关系的增改在左边对话里说一句即可。</div>
        </div>
      )}
    </div>
  )
}

function nameOf(classes: OntologyClass[], id: string) {
  return classes.find(c => c.id === id)?.name || id
}

function AddAttr({ onAdd }: { onAdd: (a: OntologyAttribute) => void }) {
  const [open, setOpen] = useState(false)
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState<OntologyAttribute['type']>('text')
  if (!open) return <button className={styles.addAttrBtn} onClick={() => setOpen(true)}>+ 属性</button>
  return (
    <div className={styles.addAttrForm}>
      <input placeholder="id" value={id} onChange={e => setId(e.target.value)} />
      <input placeholder="名称" value={name} onChange={e => setName(e.target.value)} />
      <select value={type} onChange={e => setType(e.target.value as OntologyAttribute['type'])}>
        {ATTR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <button disabled={!id || !name} onClick={() => { onAdd({ id, name, type }); setOpen(false); setId(''); setName('') }}>加</button>
      <button onClick={() => setOpen(false)}>取消</button>
    </div>
  )
}
