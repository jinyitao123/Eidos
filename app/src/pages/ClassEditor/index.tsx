import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchOntology, fetchProject } from '../../api/ontology'
import { mcpCall } from '../../api/mcp'
import { weaveStream } from '../../api/client'
import type { Ontology, OntologyClass, OntologyAttribute, OntologyMetric } from '../../types/ontology'
import { ConfirmModal, AlertModal } from '../../components/Modal'
import styles from './ClassEditor.module.css'

const ATTR_TYPES = ['integer', 'decimal', 'string', 'text', 'boolean', 'date', 'datetime', 'enum'] as const

export function ClassEditor() {
  const { projectId, classId } = useParams()
  const navigate = useNavigate()
  const [ontology, setOntology] = useState<Ontology | null>(null)
  const [cls, setCls] = useState<OntologyClass | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'attributes' | 'relationships' | 'referenced' | 'metrics' | 'telemetry'>('attributes')
  const [projectName, setProjectName] = useState('')
  const [dirty, setDirty] = useState(false)
  const [editingHeader, setEditingHeader] = useState(false)

  // Edit state
  const [editingAttr, setEditingAttr] = useState<string | null>(null)

  // New attribute form
  const [showNewAttr, setShowNewAttr] = useState(false)
  const [newAttr, setNewAttr] = useState<Partial<OntologyAttribute>>({ id: '', name: '', type: 'string' })

  // New metric form
  const [showNewMetric, setShowNewMetric] = useState(false)
  const [newMetric, setNewMetric] = useState({ id: '', name: '', kind: 'aggregate' as string, description: '' })

  // New telemetry form
  const [showNewTelemetry, setShowNewTelemetry] = useState(false)
  const [newTelemetry, setNewTelemetry] = useState({ id: '', name: '', value_type: 'decimal' as string, unit: '', description: '' })

  // Drag-to-reorder state
  const [dragAttrIdx, setDragAttrIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  // AI assistant state
  const [showAI, setShowAI] = useState(false)
  const [aiInput, setAiInput] = useState('')
  const [aiResponse, setAiResponse] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  // Modal state
  const [deleteConfirm, setDeleteConfirm] = useState<{ attrId: string } | null>(null)
  const [alertState, setAlertState] = useState<{ message: string; type: 'error' | 'success' } | null>(null)

  useEffect(() => {
    if (!projectId) return
    fetchProject(projectId).then(p => setProjectName(p.name || '')).catch(() => {})

    fetchOntology(projectId)
      .then(o => {
        if (o) {
          setOntology(o)
          const found = o.classes.find(c => c.id === classId)
          setCls(found || null)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId, classId])

  // Get relationships where this class is the source
  const outRels = ontology?.relationships?.filter(r => r.from === classId) || []
  // Get relationships where this class is the target
  const inRels = ontology?.relationships?.filter(r => r.to === classId) || []
  // Get metrics related to this class (via source_entities)
  const classMetrics = ontology?.metrics?.filter(m => m.source_entities?.includes(classId!)) || []
  // Get telemetry streams sourced from this class
  const classTelemetry = ontology?.telemetry?.filter(t => t.source_class === classId) || []

  function getClassName(id: string) {
    return ontology?.classes.find(c => c.id === id)?.name || id
  }

  function handleAttrChange(attrId: string, field: keyof OntologyAttribute, value: unknown) {
    if (!cls) return
    const attrs = (cls.attributes || []).map(a =>
      a.id === attrId ? { ...a, [field]: value } : a
    )
    setCls({ ...cls, attributes: attrs })
    setDirty(true)
  }

  function handleDeleteAttr(attrId: string) {
    setDeleteConfirm({ attrId })
  }

  function doDeleteAttr() {
    if (!deleteConfirm || !cls) return
    const attrs = (cls.attributes || []).filter(a => a.id !== deleteConfirm.attrId)
    setCls({ ...cls, attributes: attrs })
    setDirty(true)
    setDeleteConfirm(null)
  }

  function handleAddAttr() {
    if (!newAttr.id || !newAttr.name || !cls) return
    const attr: OntologyAttribute = {
      id: newAttr.id!,
      name: newAttr.name!,
      type: (newAttr.type as OntologyAttribute['type']) || 'string',
    }
    setCls({ ...cls, attributes: [...(cls.attributes || []), attr] })
    setShowNewAttr(false)
    setNewAttr({ id: '', name: '', type: 'string' })
    setDirty(true)
  }

  function handleMetricChange(metricId: string, field: keyof OntologyMetric, value: unknown) {
    if (!ontology) return
    const metrics = (ontology.metrics || []).map(m =>
      m.id === metricId ? { ...m, [field]: value } : m
    )
    setOntology({ ...ontology, metrics })
    setDirty(true)
  }

  function handleAddMetric() {
    if (!ontology || !newMetric.id || !newMetric.name) return
    const metric: OntologyMetric = {
      id: newMetric.id,
      name: newMetric.name,
      description: newMetric.description,
      phase: 'alpha',
      kind: newMetric.kind as OntologyMetric['kind'],
      source_entities: [classId!],
      status: 'designed',
    }
    setOntology({ ...ontology, metrics: [...(ontology.metrics || []), metric] })
    setShowNewMetric(false)
    setNewMetric({ id: '', name: '', kind: 'aggregate', description: '' })
    setDirty(true)
  }

  function handleDeleteMetric(metricId: string) {
    if (!ontology) return
    setOntology({ ...ontology, metrics: (ontology.metrics || []).filter(m => m.id !== metricId) })
    setDirty(true)
  }

  function handleAddTelemetry() {
    if (!ontology || !newTelemetry.id || !newTelemetry.name) return
    const tel: NonNullable<Ontology['telemetry']>[number] = {
      id: newTelemetry.id,
      name: newTelemetry.name,
      description: newTelemetry.description,
      phase: 'alpha',
      source_class: classId!,
      value_type: newTelemetry.value_type as 'decimal' | 'integer' | 'boolean' | 'string',
      unit: newTelemetry.unit,
      sampling: '1min',
      aggregations: ['avg', 'max', 'min'],
      status: 'designed' as const,
      context_strategy: { default_window: '1h', max_window: '24h', default_aggregation: 'avg', default_granularity: '5min' },
    }
    setOntology({ ...ontology, telemetry: [...(ontology.telemetry || []), tel] })
    setShowNewTelemetry(false)
    setNewTelemetry({ id: '', name: '', value_type: 'decimal', unit: '', description: '' })
    setDirty(true)
  }

  function handleDeleteTelemetry(telId: string) {
    if (!ontology) return
    setOntology({ ...ontology, telemetry: (ontology.telemetry || []).filter(t => t.id !== telId) })
    setDirty(true)
  }

  function handleTelemetryChange(telId: string, field: string, value: unknown) {
    if (!ontology) return
    const telemetry = (ontology.telemetry || []).map(t => {
      if (t.id !== telId) return t
      if (field.startsWith('context_strategy.')) {
        const csField = field.split('.')[1]
        return { ...t, context_strategy: { ...t.context_strategy, [csField]: value } }
      }
      return { ...t, [field]: value }
    })
    setOntology({ ...ontology, telemetry })
    setDirty(true)
  }

  async function handleSave() {
    if (!ontology || !cls) return
    try {
      const updated: Ontology = {
        ...ontology,
        classes: ontology.classes.map(c => c.id === cls.id ? cls : c),
      }
      const yamlModule = await import('js-yaml')
      const yamlStr = yamlModule.dump(updated, { lineWidth: 120 })
      await mcpCall('update_ontology_yaml', {
        project_id: projectId,
        yaml_content: yamlStr,
      })
      setOntology(updated)
      setDirty(false)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setAlertState({ message: '保存失败: ' + msg, type: 'error' })
    }
  }

  function handleReorderAttr(fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx || !cls) return
    const attrs = [...(cls.attributes || [])]
    const [moved] = attrs.splice(fromIdx, 1)
    attrs.splice(toIdx, 0, moved)
    setCls({ ...cls, attributes: attrs })
    setDirty(true)
    setDragAttrIdx(null)
    setDragOverIdx(null)
  }

  async function handleAISend() {
    if (!aiInput.trim() || aiLoading) return
    setAiLoading(true)
    setAiResponse('')
    const userMsg = aiInput.trim()
    setAiInput('')
    try {
      let accumulated = ''
      await weaveStream('/v1/chat', {
        agent: 'ontology-editor-assist',
        message: `当前编辑的类: ${cls?.id || classId}\n用户指令: ${userMsg}`,
        profile: `project_id=${projectId}`,
      }, (evt) => {
        if (evt.event === 'chunk') {
          accumulated += (evt.data.content as string) || ''
          setAiResponse(accumulated)
        }
      })
      if (!accumulated) setAiResponse('(无响应)')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setAiResponse('Error: ' + msg)
    } finally {
      setAiLoading(false)
    }
  }

  if (loading) return <div className={styles.loading}>加载中…</div>
  if (!cls) return (
    <div>
      <div className={styles.back} onClick={() => navigate(`/project/${projectId}/graph`)}>← 返回图谱视图</div>
      <div className={styles.empty}>未找到类 "{classId}"</div>
    </div>
  )

  const attrs = cls.attributes || []

  return (
    <div>
      <div className={styles.back} onClick={() => navigate(`/project/${projectId}/graph`)}>← 返回图谱视图</div>

      <div className={styles.classHeader}>
        <div className={styles.classIcon} style={{
          background: cls.first_citizen ? '#FAECE7' : '#E1F5EE',
          color: cls.first_citizen ? '#993C1D' : '#0F6E56',
        }}>●</div>
        <div style={{ flex: 1 }}>
          {editingHeader ? (
            <>
              <input
                className={styles.headerInput}
                value={cls.name}
                onChange={e => { setCls({ ...cls, name: e.target.value }); setDirty(true) }}
                placeholder="类名称"
              />
              <input
                className={styles.headerInputSmall}
                value={cls.description || ''}
                onChange={e => { setCls({ ...cls, description: e.target.value }); setDirty(true) }}
                placeholder="类描述（一句话）"
              />
            </>
          ) : (
            <>
              <h2 className={styles.className} onClick={() => setEditingHeader(true)} style={{ cursor: 'pointer' }}>{cls.name}</h2>
              <div className={styles.classId}>{cls.id} · {projectName}</div>
              {cls.description && <div className={styles.classDesc} onClick={() => setEditingHeader(true)} style={{ cursor: 'pointer' }}>{cls.description}</div>}
            </>
          )}
        </div>
        <div className={styles.headerActions}>
          {editingHeader ? (
            <button className={styles.headerDone} onClick={() => setEditingHeader(false)}>完成</button>
          ) : (
            <button className={styles.headerEdit} onClick={() => setEditingHeader(true)}>编辑</button>
          )}
          <span
            className={`${styles.fcBadge} ${cls.first_citizen ? styles.fcBadgeActive : ''}`}
            onClick={() => { setCls({ ...cls, first_citizen: !cls.first_citizen }); setDirty(true) }}
            style={{ cursor: 'pointer' }}
            title="点击切换第一公民状态"
          >
            {cls.first_citizen ? '★ 第一公民' : '☆ 设为第一公民'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: cls.imported_from || cls.extends || cls.phase ? 4 : 0 }}>
          {cls.imported_from && <span className={styles.importBadge}>导入自 {cls.imported_from}</span>}
          {cls.extends && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: '#1a1a3e', color: '#a0a0e0' }}>继承 {cls.extends}</span>}
          {cls.phase && cls.phase !== 'alpha' && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: cls.phase === 'beta' ? '#2e2410' : '#2a2825', color: cls.phase === 'beta' ? '#D97706' : '#6b6560' }}>{cls.phase}</span>}
        </div>
      </div>

      <div className={styles.tabs}>
        <button className={`${styles.tab} ${tab === 'attributes' ? styles.tabActive : ''}`} onClick={() => setTab('attributes')}>
          属性（{attrs.length}）
        </button>
        <button className={`${styles.tab} ${tab === 'relationships' ? styles.tabActive : ''}`} onClick={() => setTab('relationships')}>
          关系（{outRels.length}）
        </button>
        <button className={`${styles.tab} ${tab === 'referenced' ? styles.tabActive : ''}`} onClick={() => setTab('referenced')}>
          被引用（{inRels.length}）
        </button>
        <button className={`${styles.tab} ${tab === 'metrics' ? styles.tabActive : ''}`} onClick={() => setTab('metrics')}>
          指标（{classMetrics.length}）
        </button>
        <button className={`${styles.tab} ${tab === 'telemetry' ? styles.tabActive : ''}`} onClick={() => setTab('telemetry')}>
          遥测（{classTelemetry.length}）
        </button>
      </div>

      {tab === 'attributes' && (
        <>
          <table className={styles.attrTable}>
            <thead>
              <tr>
                <th></th>
                <th>属性名</th>
                <th>ID</th>
                <th>类型</th>
                <th>必填</th>
                <th>派生/默认</th>
                <th>标记</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {attrs.map((attr, i) => (
                <tr
                  key={attr.id}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragAttrIdx(i) }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverIdx(i) }}
                  onDragEnd={() => { setDragAttrIdx(null); setDragOverIdx(null) }}
                  onDrop={(e) => { e.preventDefault(); handleReorderAttr(dragAttrIdx!, i) }}
                  className={`${editingAttr === attr.id ? styles.editing : ''} ${dragAttrIdx === i ? styles.dragging : ''} ${dragOverIdx === i ? styles.dragOver : ''}`}
                >
                  <td className={styles.dragHandle}>&#x2807;</td>
                  <td>
                    {editingAttr === attr.id ? (
                      <input className={styles.cellInput} value={attr.name} onChange={e => handleAttrChange(attr.id, 'name', e.target.value)} />
                    ) : (
                      <span onClick={() => setEditingAttr(attr.id)}>{attr.name}</span>
                    )}
                  </td>
                  <td className={styles.mono}>{attr.id}</td>
                  <td>
                    {editingAttr === attr.id ? (
                      <select className={styles.cellInput} value={attr.type} onChange={e => handleAttrChange(attr.id, 'type', e.target.value)}>
                        {ATTR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    ) : (
                      <span className={styles.typeChip}>{attr.type}</span>
                    )}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={attr.required || false}
                      onChange={e => handleAttrChange(attr.id, 'required', e.target.checked)}
                    />
                  </td>
                  <td className={styles.derivedCell}>
                    {editingAttr === attr.id ? (
                      <div className={styles.derivedEdit}>
                        <label className={styles.derivedToggle}>
                          <input type="checkbox" checked={!!attr.derived} onChange={e => {
                            if (e.target.checked) {
                              handleAttrChange(attr.id, 'derived', 'formula_here')
                            } else {
                              handleAttrChange(attr.id, 'derived', undefined)
                            }
                          }} />
                          派生
                        </label>
                        {attr.derived ? (
                          <input
                            className={styles.derivedInput}
                            value={typeof attr.derived === 'string' ? attr.derived : (attr.formula || '')}
                            onChange={e => handleAttrChange(attr.id, 'derived', e.target.value)}
                            placeholder="公式, 如: safety_stock - available_qty"
                          />
                        ) : (
                          <>
                            <input
                              className={styles.derivedInput}
                              value={attr.default !== undefined ? String(attr.default) : ''}
                              onChange={e => handleAttrChange(attr.id, 'default', e.target.value || undefined)}
                              placeholder="默认值"
                            />
                            <label className={styles.derivedToggle}>
                              <input type="checkbox" checked={attr.configurable || false} onChange={e => handleAttrChange(attr.id, 'configurable', e.target.checked)} />
                              客户可调
                            </label>
                          </>
                        )}
                      </div>
                    ) : (
                      <div onClick={() => setEditingAttr(attr.id)} style={{ cursor: 'pointer', minHeight: 20 }}>
                        {attr.derived ? (
                          <span className={styles.derivedTag} title={typeof attr.derived === 'string' ? attr.derived : (attr.formula || '派生')}>派生: {typeof attr.derived === 'string' ? attr.derived : (attr.formula || '✓')}</span>
                        ) : attr.default !== undefined ? (
                          <span className={styles.defaultVal}>默认: {String(attr.default)}</span>
                        ) : null}
                        {attr.configurable && <span className={styles.configTag}>客户可调</span>}
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                      {attr.is_metric && <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, background: '#0a2e1a', color: '#7dd3b8' }}>指标</span>}
                      {attr.exposed && <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, background: '#1a1a3e', color: '#a0a0e0' }}>开放</span>}
                      {attr.graph_sync && <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, background: '#2e2410', color: '#D4A84A' }}>图谱</span>}
                    </div>
                  </td>
                  <td>
                    <button className={styles.deleteAttrBtn} onClick={() => handleDeleteAttr(attr.id)} title="删除">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {showNewAttr ? (
            <div className={styles.newAttrForm}>
              <input placeholder="属性ID (snake_case)" value={newAttr.id} onChange={e => setNewAttr(p => ({ ...p, id: e.target.value }))} className={styles.formInput} />
              <input placeholder="属性名称" value={newAttr.name} onChange={e => setNewAttr(p => ({ ...p, name: e.target.value }))} className={styles.formInput} />
              <select value={newAttr.type} onChange={e => setNewAttr(p => ({ ...p, type: e.target.value as OntologyAttribute['type'] }))} className={styles.formInput}>
                {ATTR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <button className={styles.formBtn} onClick={handleAddAttr}>添加</button>
              <button className={styles.formBtnCancel} onClick={() => setShowNewAttr(false)}>取消</button>
            </div>
          ) : (
            <div className={styles.addBtn} onClick={() => setShowNewAttr(true)}>+ 新增属性</div>
          )}
        </>
      )}

      {tab === 'relationships' && (
        <div className={styles.relList}>
          {outRels.length === 0 && <div className={styles.emptyRel}>此类没有作为起点的关系</div>}
          {outRels.map(rel => (
            <div key={rel.id} className={styles.relCard}>
              <div className={styles.relLine}>
                <span className={styles.relFrom}>{cls.name}</span>
                <span className={styles.relArrow}>→</span>
                <span className={styles.relName}>{rel.name}</span>
                <span className={styles.relArrow}>→</span>
                <span className={styles.relTo} onClick={() => navigate(`/project/${projectId}/class/${rel.to}`)}>{getClassName(rel.to)}</span>
              </div>
              <div className={styles.relMeta}>
                {cardinalityLabel(rel.cardinality)}
                {rel.edge_attributes && rel.edge_attributes.length > 0 && (
                  <span> · 边属性: {rel.edge_attributes.map(a => a.name).join(', ')}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'referenced' && (
        <div className={styles.relList}>
          {inRels.length === 0 && <div className={styles.emptyRel}>此类没有被其他类引用</div>}
          {inRels.map(rel => (
            <div key={rel.id} className={styles.relCard}>
              <div className={styles.relLine}>
                <span className={styles.relFrom} onClick={() => navigate(`/project/${projectId}/class/${rel.from}`)}>{getClassName(rel.from)}</span>
                <span className={styles.relArrow}>→</span>
                <span className={styles.relName}>{rel.name}</span>
                <span className={styles.relArrow}>→</span>
                <span className={styles.relTo}>{cls.name}</span>
              </div>
              <div className={styles.relMeta}>{cardinalityLabel(rel.cardinality)}</div>
            </div>
          ))}
        </div>
      )}

      {tab === 'metrics' && (
        <div className={styles.metricList}>
          {classMetrics.length === 0 && <div className={styles.emptyRel}>此类没有关联指标</div>}
          {classMetrics.map(m => {
            const autoTool = `${m.kind === 'classification' ? 'classify_' : 'query_'}${m.id}`
            return (
            <div key={m.id} className={styles.metricCard}>
              <div className={styles.metricHeader}>
                <span className={styles.metricName}>{m.name}</span>
                <span className={styles.mono}>{m.id}</span>
                <span className={`${styles.kindChip} ${styles[`kind_${m.kind}`] || ''}`}>{metricKindLabel(m.kind)}</span>
                <span className={`${styles.statusChip} ${styles[`status_${m.status}`] || ''}`}>{statusLabel(m.status)}</span>
                <button className={styles.deleteAttrBtn} title="删除指标" onClick={() => handleDeleteMetric(m.id)}>×</button>
              </div>

              {/* 基本信息 */}
              <div className={styles.metricFieldGrid}>
                <div className={styles.metricField}>
                  <label className={styles.metricLabel}>名称</label>
                  <input className={styles.metricInput} value={m.name} onChange={e => handleMetricChange(m.id, 'name', e.target.value)} />
                </div>
                <div className={styles.metricField}>
                  <label className={styles.metricLabel}>类型</label>
                  <select className={styles.metricInput} value={m.kind} onChange={e => handleMetricChange(m.id, 'kind', e.target.value)}>
                    <option value="aggregate">聚合</option>
                    <option value="composite">复合</option>
                    <option value="classification">分类</option>
                  </select>
                </div>
                <div className={styles.metricField}>
                  <label className={styles.metricLabel}>粒度</label>
                  <input className={styles.metricInput} value={m.granularity || ''} placeholder="system / warehouse / position" onChange={e => handleMetricChange(m.id, 'granularity', e.target.value)} />
                </div>
                <div className={styles.metricField}>
                  <label className={styles.metricLabel}>阶段</label>
                  <select className={styles.metricInput} value={m.phase || 'alpha'} onChange={e => handleMetricChange(m.id, 'phase', e.target.value)}>
                    <option value="alpha">alpha</option>
                    <option value="beta">beta</option>
                    <option value="full">full</option>
                  </select>
                </div>
              </div>
              <div className={styles.metricFieldFull}>
                <label className={styles.metricLabel}>描述</label>
                <input className={styles.metricInputWide} value={m.description || ''} onChange={e => handleMetricChange(m.id, 'description', e.target.value)} placeholder="指标的业务含义和用途" />
              </div>

              {/* 计算口径 */}
              <div className={styles.metricFieldFull}>
                <label className={styles.metricLabel}>计算口径（公式）</label>
                <textarea className={styles.metricTextarea} value={m.formula || ''} onChange={e => handleMetricChange(m.id, 'formula', e.target.value)} placeholder="如：SUM(inventory_value WHERE is_stale = true) / SUM(inventory_value)" rows={2} />
              </div>
              <div className={styles.metricFieldGrid}>
                <div className={styles.metricField} style={{ gridColumn: '1 / 3' }}>
                  <label className={styles.metricLabel}>来源实体</label>
                  <div className={styles.chipRow}>
                    {(m.source_entities || []).map(e => (
                      <span key={e} className={styles.chipTag}>{e} <button className={styles.chipDel} onClick={() => handleMetricChange(m.id, 'source_entities', (m.source_entities || []).filter(x => x !== e))}>×</button></span>
                    ))}
                    <select className={styles.chipAdd} value="" onChange={ev => { if (ev.target.value) handleMetricChange(m.id, 'source_entities', [...(m.source_entities || []), ev.target.value]); ev.target.value = '' }}>
                      <option value="">+ 添加</option>
                      {(ontology?.classes || []).filter(c => !(m.source_entities || []).includes(c.id)).map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
                    </select>
                  </div>
                </div>
                <div className={styles.metricField} style={{ gridColumn: '3 / 5' }}>
                  <label className={styles.metricLabel}>维度</label>
                  <input className={styles.metricInput} value={(m.dimensions || []).join(', ')} onChange={e => handleMetricChange(m.id, 'dimensions', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} placeholder="warehouse, category" />
                </div>
              </div>

              {/* 分类桶（classification 专属） */}
              {m.kind === 'classification' && (
                <div className={styles.metricSection}>
                  <label className={styles.metricLabel}>分类规则（{(m.buckets || []).length} 类）</label>
                  <div className={styles.bucketGrid}>
                    {(m.buckets || []).map((b, bi) => (
                      <div key={b.id} className={styles.bucketItem}>
                        <div className={styles.bucketHead}>
                          <input className={styles.bucketInput} value={b.id} placeholder="bucket_id" onChange={e => { const bs = [...(m.buckets || [])]; bs[bi] = { ...b, id: e.target.value }; handleMetricChange(m.id, 'buckets', bs) }} style={{ width: 80, fontFamily: 'var(--font-mono, monospace)' }} />
                          <input className={styles.bucketInput} value={b.name} placeholder="名称" onChange={e => { const bs = [...(m.buckets || [])]; bs[bi] = { ...b, name: e.target.value }; handleMetricChange(m.id, 'buckets', bs) }} style={{ flex: 1 }} />
                          <button className={styles.chipDel} onClick={() => handleMetricChange(m.id, 'buckets', (m.buckets || []).filter((_, i) => i !== bi))}>×</button>
                        </div>
                        <input className={styles.bucketCondInput} value={b.condition} placeholder="判定条件" onChange={e => { const bs = [...(m.buckets || [])]; bs[bi] = { ...b, condition: e.target.value }; handleMetricChange(m.id, 'buckets', bs) }} />
                        <input className={styles.bucketCondInput} value={b.description || ''} placeholder="描述（可选）" onChange={e => { const bs = [...(m.buckets || [])]; bs[bi] = { ...b, description: e.target.value }; handleMetricChange(m.id, 'buckets', bs) }} style={{ color: 'var(--color-text-tertiary)' }} />
                      </div>
                    ))}
                  </div>
                  <div className={styles.addBtn} onClick={() => handleMetricChange(m.id, 'buckets', [...(m.buckets || []), { id: '', name: '', condition: '' }])}>+ 新增分类桶</div>
                </div>
              )}

              {/* 业务参数 */}
              <div className={styles.metricSection}>
                <label className={styles.metricLabel}>业务参数（{(m.params || []).length}）</label>
                {(m.params || []).length > 0 && (
                  <table className={styles.paramTable}>
                    <thead><tr><th>参数ID</th><th>名称</th><th>类型</th><th>默认值</th><th>可配</th><th></th></tr></thead>
                    <tbody>
                      {(m.params || []).map((p, pi) => (
                        <tr key={pi}>
                          <td><input className={styles.paramInput} value={p.id} onChange={e => { const ps = [...(m.params || [])]; ps[pi] = { ...p, id: e.target.value }; handleMetricChange(m.id, 'params', ps) }} /></td>
                          <td><input className={styles.paramInput} value={p.name} onChange={e => { const ps = [...(m.params || [])]; ps[pi] = { ...p, name: e.target.value }; handleMetricChange(m.id, 'params', ps) }} /></td>
                          <td><select className={styles.paramInput} value={p.type} onChange={e => { const ps = [...(m.params || [])]; ps[pi] = { ...p, type: e.target.value }; handleMetricChange(m.id, 'params', ps) }}>
                            <option value="integer">integer</option><option value="decimal">decimal</option><option value="string">string</option><option value="boolean">boolean</option>
                          </select></td>
                          <td><input className={styles.paramInput} value={p.default != null ? String(p.default) : ''} placeholder="—" onChange={e => { const ps = [...(m.params || [])]; ps[pi] = { ...p, default: e.target.value }; handleMetricChange(m.id, 'params', ps) }} /></td>
                          <td><input type="checkbox" checked={p.configurable || false} onChange={e => { const ps = [...(m.params || [])]; ps[pi] = { ...p, configurable: e.target.checked }; handleMetricChange(m.id, 'params', ps) }} /></td>
                          <td><button className={styles.chipDel} onClick={() => handleMetricChange(m.id, 'params', (m.params || []).filter((_, i) => i !== pi))}>×</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className={styles.addBtn} onClick={() => handleMetricChange(m.id, 'params', [...(m.params || []), { id: '', name: '', type: 'integer' }])}>+ 新增参数</div>
              </div>

              {/* 数据依赖（自动识别 + 手动补充） */}
              <div className={styles.metricSection}>
                {(() => {
                  // Auto-extract attribute refs from formula: match class_id.attr_id patterns
                  const formulaText = (m.formula || '') + ' ' + (m.buckets || []).map(b => b.condition).join(' ')
                  const allAttrs: string[] = []
                  for (const cls of ontology?.classes || []) {
                    for (const attr of cls.attributes || []) {
                      if (formulaText.includes(attr.id)) {
                        allAttrs.push(`${cls.id}.${attr.id}`)
                      }
                    }
                  }
                  // Deduplicate: only keep attrs from source_entities classes
                  const sourceSet = new Set(m.source_entities || [])
                  const autoAttrs = [...new Set(allAttrs.filter(a => sourceSet.has(a.split('.')[0])))]
                  // Manual deps = non-attribute deps from depends_on
                  const manualDeps = (m.depends_on || []).filter(d => d.type !== 'attribute')

                  return (
                    <>
                      <label className={styles.metricLabel}>数据依赖</label>
                      {autoAttrs.length > 0 && (
                        <div className={styles.depAuto}>
                          <span className={styles.depAutoLabel}>从公式自动识别</span>
                          <div className={styles.chipRow}>
                            {autoAttrs.map(ref => (
                              <span key={ref} className={styles.chipTagAuto}>{ref}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {manualDeps.length > 0 && (
                        <div style={{ marginTop: 4 }}>
                          <span className={styles.depAutoLabel}>手动补充</span>
                          {manualDeps.map((dep, di) => {
                            const realIdx = (m.depends_on || []).indexOf(dep)
                            return (
                            <div key={di} className={styles.depRow}>
                              <select className={styles.depSelect} value={dep.type} onChange={e => { const ds = [...(m.depends_on || [])]; ds[realIdx] = { ...dep, type: e.target.value as 'metric' | 'telemetry' | 'rule_param', ref: '' }; handleMetricChange(m.id, 'depends_on', ds) }}>
                                <option value="metric">指标</option>
                                <option value="telemetry">遥测</option>
                                <option value="rule_param">规则参数</option>
                              </select>
                              {dep.type === 'metric' ? (
                                <select className={styles.depSelect} value={dep.ref} onChange={e => { const ds = [...(m.depends_on || [])]; ds[realIdx] = { ...dep, ref: e.target.value }; handleMetricChange(m.id, 'depends_on', ds) }}>
                                  <option value="">选择指标…</option>
                                  {(ontology?.metrics || []).filter(x => x.id !== m.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                                </select>
                              ) : dep.type === 'telemetry' ? (
                                <select className={styles.depSelect} value={dep.ref} onChange={e => { const ds = [...(m.depends_on || [])]; ds[realIdx] = { ...dep, ref: e.target.value }; handleMetricChange(m.id, 'depends_on', ds) }}>
                                  <option value="">选择遥测…</option>
                                  {(ontology?.telemetry || []).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                                </select>
                              ) : (
                                <input className={styles.depSelect} value={dep.ref} placeholder="R03.threshold" onChange={e => { const ds = [...(m.depends_on || [])]; ds[realIdx] = { ...dep, ref: e.target.value }; handleMetricChange(m.id, 'depends_on', ds) }} />
                              )}
                              <button className={styles.chipDel} onClick={() => handleMetricChange(m.id, 'depends_on', (m.depends_on || []).filter((_, i) => i !== realIdx))}>×</button>
                            </div>
                          )})}
                        </div>
                      )}
                      <div className={styles.addBtn} onClick={() => handleMetricChange(m.id, 'depends_on', [...(m.depends_on || []), { type: 'metric', ref: '' }])}>+ 补充依赖（指标/遥测/规则参数）</div>
                    </>
                  )
                })()}
              </div>

              {/* 已知问题（designed/undefined 时显示） */}
              {m.status !== 'implemented' && (
                <div className={styles.metricSection}>
                  <label className={styles.metricLabel}>已知问题（{(m.known_issues || []).length}）</label>
                  {(m.known_issues || []).map((issue, ii) => (
                    <div key={ii} className={styles.depRow}>
                      <input className={styles.metricInputWide} value={issue} onChange={e => { const iss = [...(m.known_issues || [])]; iss[ii] = e.target.value; handleMetricChange(m.id, 'known_issues', iss) }} />
                      <button className={styles.chipDel} onClick={() => handleMetricChange(m.id, 'known_issues', (m.known_issues || []).filter((_, i) => i !== ii))}>×</button>
                    </div>
                  ))}
                  <div className={styles.addBtn} onClick={() => handleMetricChange(m.id, 'known_issues', [...(m.known_issues || []), ''])}>+ 添加已知问题</div>
                </div>
              )}

              {/* Footer: tool + status */}
              <div className={styles.metricFooter}>
                <span className={styles.metricTool}>
                  Agent 工具: <code>{m.tool || autoTool}</code>
                  {!m.tool && <span className={styles.autoTag}>自动</span>}
                  {m.tool && m.tool !== autoTool && <span className={styles.customTag}>自定义</span>}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {m.tool && m.tool !== autoTool && (
                    <button className={styles.formBtnCancel} style={{ fontSize: 10, padding: '1px 6px' }} onClick={() => handleMetricChange(m.id, 'tool', '')}>恢复自动</button>
                  )}
                  <input className={styles.metricInput} value={m.tool || ''} placeholder={autoTool} onChange={e => handleMetricChange(m.id, 'tool', e.target.value)} style={{ width: 140, fontSize: 11 }} />
                  <select
                    className={styles.statusSelect}
                    value={m.status}
                    onChange={e => {
                      const newStatus = e.target.value
                      if (newStatus === 'implemented' && !m.formula) { setAlertState({ message: '请先填写计算口径（公式）', type: 'error' }); return }
                      handleMetricChange(m.id, 'status', newStatus)
                    }}
                  >
                    <option value="implemented">已实现</option>
                    <option value="designed">已设计</option>
                    <option value="undefined">未定义</option>
                  </select>
                </div>
              </div>
            </div>
          )})}
          {showNewMetric ? (
            <div className={styles.newFormRow}>
              <input placeholder="指标ID (snake_case)" value={newMetric.id} onChange={e => setNewMetric(p => ({ ...p, id: e.target.value }))} className={styles.formInput} />
              <input placeholder="指标名称" value={newMetric.name} onChange={e => setNewMetric(p => ({ ...p, name: e.target.value }))} className={styles.formInput} />
              <select value={newMetric.kind} onChange={e => setNewMetric(p => ({ ...p, kind: e.target.value }))} className={styles.formInput}>
                <option value="aggregate">聚合</option>
                <option value="composite">复合</option>
                <option value="classification">分类</option>
              </select>
              <button className={styles.formBtn} onClick={handleAddMetric}>添加</button>
              <button className={styles.formBtnCancel} onClick={() => setShowNewMetric(false)}>取消</button>
            </div>
          ) : (
            <div className={styles.addBtn} onClick={() => setShowNewMetric(true)}>+ 新增指标</div>
          )}
        </div>
      )}

      {tab === 'telemetry' && (
        <div className={styles.metricList}>
          {classTelemetry.length === 0 && <div className={styles.emptyRel}>此类没有关联遥测</div>}
          {classTelemetry.map(t => (
            <div key={t.id} className={styles.metricCard}>
              <div className={styles.metricHeader}>
                <span className={styles.metricName}>{t.name}</span>
                <span className={styles.mono}>{t.id}</span>
                <span className={styles.typeChip}>{t.value_type}</span>
                <span className={styles.typeChip}>{t.unit}</span>
                <span className={`${styles.statusChip} ${styles[`status_${t.status}`] || ''}`}>{statusLabel(t.status)}</span>
                <button className={styles.deleteAttrBtn} title="删除遥测" onClick={() => handleDeleteTelemetry(t.id)}>×</button>
              </div>
              <div className={styles.metricDesc}>{t.description}</div>
              <div className={styles.telemetryGrid}>
                <div className={styles.telemetryField}>
                  <span className={styles.metricLabel}>采样</span>
                  <span>{t.sampling}</span>
                </div>
                {t.normal_range && (
                  <div className={styles.telemetryField}>
                    <span className={styles.metricLabel}>正常范围</span>
                    <span>{t.normal_range[0]} ~ {t.normal_range[1]} {t.unit}</span>
                  </div>
                )}
                {t.warning_threshold !== undefined && (
                  <div className={styles.telemetryField}>
                    <span className={styles.metricLabel}>预警阈值</span>
                    <span>{t.warning_threshold} {t.unit}</span>
                  </div>
                )}
                {t.alert_threshold !== undefined && (
                  <div className={styles.telemetryField}>
                    <span className={styles.metricLabel}>告警阈值</span>
                    <span className={styles.alertValue}>{t.alert_threshold} {t.unit}</span>
                  </div>
                )}
                <div className={styles.telemetryField}>
                  <span className={styles.metricLabel}>聚合方式</span>
                  <span>{t.aggregations?.join(', ')}</span>
                </div>
              </div>
              {t.context_strategy && (
                <div className={styles.contextStrategy}>
                  <span className={styles.metricLabel}>Agent 查询策略</span>
                  <div className={styles.csGrid}>
                    <div>
                      <span className={styles.csLabel}>默认窗口</span>
                      <input
                        className={styles.csInput}
                        value={t.context_strategy.default_window}
                        onChange={e => handleTelemetryChange(t.id, 'context_strategy.default_window', e.target.value)}
                      />
                    </div>
                    <div>
                      <span className={styles.csLabel}>最大窗口</span>
                      <input
                        className={styles.csInput}
                        value={t.context_strategy.max_window}
                        onChange={e => handleTelemetryChange(t.id, 'context_strategy.max_window', e.target.value)}
                      />
                    </div>
                    <div>
                      <span className={styles.csLabel}>默认聚合</span>
                      <input
                        className={styles.csInput}
                        value={t.context_strategy.default_aggregation}
                        onChange={e => handleTelemetryChange(t.id, 'context_strategy.default_aggregation', e.target.value)}
                      />
                    </div>
                    <div>
                      <span className={styles.csLabel}>默认粒度</span>
                      <input
                        className={styles.csInput}
                        value={t.context_strategy.default_granularity}
                        onChange={e => handleTelemetryChange(t.id, 'context_strategy.default_granularity', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )}
              <div className={styles.metricFooter}>
                <span className={styles.metricTool}>
                  {t.status === 'implemented' ? 'Agent 可调用: query_telemetry' : 'Agent 不可调用'}
                </span>
                <select
                  className={styles.statusSelect}
                  value={t.status}
                  onChange={e => handleTelemetryChange(t.id, 'status', e.target.value)}
                >
                  <option value="implemented">已实现</option>
                  <option value="designed">已设计</option>
                  <option value="undefined">未定义</option>
                </select>
              </div>
            </div>
          ))}
          {showNewTelemetry ? (
            <div className={styles.newFormRow}>
              <input placeholder="遥测ID (snake_case)" value={newTelemetry.id} onChange={e => setNewTelemetry(p => ({ ...p, id: e.target.value }))} className={styles.formInput} />
              <input placeholder="遥测名称" value={newTelemetry.name} onChange={e => setNewTelemetry(p => ({ ...p, name: e.target.value }))} className={styles.formInput} />
              <select value={newTelemetry.value_type} onChange={e => setNewTelemetry(p => ({ ...p, value_type: e.target.value }))} className={styles.formInput}>
                <option value="decimal">decimal</option>
                <option value="integer">integer</option>
                <option value="boolean">boolean</option>
                <option value="string">string</option>
              </select>
              <input placeholder="单位" value={newTelemetry.unit} onChange={e => setNewTelemetry(p => ({ ...p, unit: e.target.value }))} className={styles.formInput} style={{ width: 60 }} />
              <button className={styles.formBtn} onClick={handleAddTelemetry}>添加</button>
              <button className={styles.formBtnCancel} onClick={() => setShowNewTelemetry(false)}>取消</button>
            </div>
          ) : (
            <div className={styles.addBtn} onClick={() => setShowNewTelemetry(true)}>+ 新增遥测</div>
          )}
        </div>
      )}

      <div className={styles.bottomBar}>
        <button className={styles.btnPrimary} onClick={handleSave} disabled={!dirty}>
          {dirty ? '保存修改' : '已保存'}
        </button>
      </div>

      <div className={styles.aiFloat}>
        {showAI && (
          <div className={styles.aiPanel}>
            <div className={styles.aiPanelHeader}>
              <span>AI 辅助编辑</span>
              <button className={styles.aiPanelClose} onClick={() => setShowAI(false)}>x</button>
            </div>
            <div className={styles.aiPanelBody}>
              {aiLoading ? '思考中...' : aiResponse || '输入指令, 让 AI 帮助编辑属性'}
            </div>
            <div className={styles.aiPanelInput}>
              <input
                className={styles.aiPanelInputField}
                value={aiInput}
                onChange={e => setAiInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAISend() }}
                placeholder="例如: 加一个周转率属性..."
              />
              <button className={styles.aiPanelSend} disabled={aiLoading || !aiInput.trim()} onClick={handleAISend}>发送</button>
            </div>
          </div>
        )}
        <button className={styles.aiBtn} onClick={() => setShowAI(v => !v)}>AI 辅助</button>
      </div>

      <ConfirmModal
        open={!!deleteConfirm}
        message={`确定删除属性 ${deleteConfirm?.attrId}？`}
        danger
        onConfirm={doDeleteAttr}
        onCancel={() => setDeleteConfirm(null)}
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

function cardinalityLabel(c: string) {
  const map: Record<string, string> = {
    one_to_one: '一对一',
    one_to_many: '一对多',
    many_to_one: '多对一',
    many_to_many: '多对多',
  }
  return map[c] || c
}

function metricKindLabel(kind: string) {
  const map: Record<string, string> = {
    aggregate: '聚合',
    composite: '复合',
    classification: '分类',
  }
  return map[kind] || kind
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    implemented: '已实现',
    designed: '已设计',
    undefined: '未定义',
  }
  return map[status] || status
}
