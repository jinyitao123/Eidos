import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchOntology, fetchProject } from '../../api/ontology'
import { mcpCall } from '../../api/mcp'
import { weavePost } from '../../api/client'
import type { Ontology, OntologyClass, OntologyAttribute } from '../../types/ontology'
import { ConfirmModal, AlertModal } from '../../components/Modal'
import styles from './ClassEditor.module.css'

const ATTR_TYPES = ['integer', 'decimal', 'string', 'text', 'boolean', 'date', 'datetime', 'enum'] as const

export function ClassEditor() {
  const { projectId, classId } = useParams()
  const navigate = useNavigate()
  const [ontology, setOntology] = useState<Ontology | null>(null)
  const [cls, setCls] = useState<OntologyClass | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'attributes' | 'relationships' | 'referenced'>('attributes')
  const [projectName, setProjectName] = useState('')
  const [dirty, setDirty] = useState(false)
  const [editingHeader, setEditingHeader] = useState(false)

  // Edit state
  const [editingAttr, setEditingAttr] = useState<string | null>(null)

  // New attribute form
  const [showNewAttr, setShowNewAttr] = useState(false)
  const [newAttr, setNewAttr] = useState<Partial<OntologyAttribute>>({ id: '', name: '', type: 'string' })

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

  async function handleSave() {
    if (!ontology || !cls) return
    try {
      const updated: Ontology = {
        ...ontology,
        classes: ontology.classes.map(c => c.id === cls.id ? cls : c),
      }
      const yamlModule = await import('js-yaml')
      const yamlStr = yamlModule.dump(updated, { lineWidth: 120 })
      await mcpCall('save_output', {
        project_id: projectId,
        stage: 'ontology_structure',
        content: yamlStr,
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
    try {
      const res = await weavePost<{ response?: string; message?: string }>('/v1/chat', {
        agent: 'ontology-architect',
        message: aiInput,
        profile: `project_id=${projectId}`,
      })
      setAiResponse(res.response || res.message || JSON.stringify(res))
      setAiInput('')
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
        {cls.imported_from && <span className={styles.importBadge}>导入自 {cls.imported_from}</span>}
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
                <th>图谱</th>
                <th>派生/默认</th>
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
                  <td>
                    <input
                      type="checkbox"
                      checked={attr.graph_sync || false}
                      onChange={e => handleAttrChange(attr.id, 'graph_sync', e.target.checked)}
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
                            value={attr.derived}
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
                          <span className={styles.derivedTag} title={attr.derived}>派生: {attr.derived}</span>
                        ) : attr.default !== undefined ? (
                          <span className={styles.defaultVal}>默认: {String(attr.default)}</span>
                        ) : null}
                        {attr.configurable && <span className={styles.configTag}>客户可调</span>}
                      </div>
                    )}
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
