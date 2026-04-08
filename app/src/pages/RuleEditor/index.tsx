import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchOntology, fetchProject } from '../../api/ontology'
import { mcpCall } from '../../api/mcp'
import type { OntologyRule, OntologyAction, Ontology } from '../../types/ontology'
import { ConfirmModal, AlertModal } from '../../components/Modal'
import styles from './RuleEditor.module.css'

interface RuleDisplay {
  id: string
  name: string
  severity: string
  triggerType: string
  triggerSource: string
  condition: string
  action: string
  params: { name: string; value: string; configurable: boolean }[]
}

interface ActionDisplay {
  id: string
  name: string
  writes: string
  triggersBefore: string[]
  triggersAfter: string[]
  permissions: string[]
  decisionLog: boolean
}

function normalizeParams(params: unknown): { name: string; value: string; configurable: boolean }[] {
  if (!params) return []
  if (Array.isArray(params)) {
    return params.map((p: Record<string, unknown>) => ({
      name: String(p.name || ''),
      value: String(p.default ?? p.value ?? ''),
      configurable: Boolean(p.configurable),
    }))
  }
  // Object format: { param_name: { default: ..., configurable: ... } } or { param_name: value }
  if (typeof params === 'object') {
    return Object.entries(params as Record<string, unknown>).map(([key, val]) => {
      if (val && typeof val === 'object') {
        const obj = val as Record<string, unknown>
        return { name: key, value: String(obj.default ?? obj.value ?? ''), configurable: Boolean(obj.configurable) }
      }
      return { name: key, value: String(val ?? ''), configurable: false }
    })
  }
  return []
}

function normalizeTrigger(trigger: unknown): { type: string; source: string } {
  if (!trigger) return { type: '', source: '' }
  if (typeof trigger === 'string') {
    const map: Record<string, string> = {
      before_action: '动作执行前', after_action: '动作执行后',
      on_change: '数据变更', cron: '定时触发', schedule: '定时触发',
    }
    return { type: map[trigger] || trigger, source: '' }
  }
  const t = trigger as Record<string, unknown>
  const typeStr = String(t.type || '')
  const map: Record<string, string> = {
    before_action: '动作执行前', after_action: '动作执行后',
    on_change: '数据变更', cron: '定时触发', schedule: '定时触发',
  }
  const source = Array.isArray(t.source) ? t.source.join(', ') : String(t.cron || t.source || '')
  return { type: map[typeStr] || typeStr, source }
}

function normalizeCondition(condition: unknown): string {
  if (!condition) return ''
  if (typeof condition === 'string') return condition
  const c = condition as Record<string, unknown>
  if (c.entity && c.expression) return `${c.entity}: ${c.expression}`
  return JSON.stringify(condition)
}

function normalizeAction(action: unknown): string {
  if (!action) return ''
  if (typeof action === 'string') return action
  const a = action as Record<string, unknown>
  let s = String(a.type || '')
  if (a.target) s += ' → ' + a.target
  if (a.notify) s += ' → ' + a.notify
  return s
}

function mapRule(r: OntologyRule): RuleDisplay {
  const trigger = normalizeTrigger(r.trigger)
  return {
    id: r.id,
    name: r.name,
    severity: r.severity || 'info',
    triggerType: trigger.type,
    triggerSource: trigger.source,
    condition: normalizeCondition(r.condition),
    action: normalizeAction(r.action),
    params: normalizeParams(r.params),
  }
}

function mapAction(a: OntologyAction): ActionDisplay {
  const writes = (a.writes || []).map(w => {
    const sets = Object.entries(w.set || {}).map(([k, v]) => `${k} = ${v}`).join(', ')
    return `${w.target}: ${sets}`
  }).join('\n')

  return {
    id: a.id,
    name: a.name,
    writes: writes || '(无写入)',
    triggersBefore: a.triggers_before || [],
    triggersAfter: a.triggers_after || [],
    permissions: [
      ...(a.permission?.roles || []),
      ...(a.permission?.agents || []).map(ag => `Agent: ${ag}`),
    ],
    decisionLog: a.decision_log || false,
  }
}

const sevConfig: Record<string, { label: string; className: string }> = {
  warning: { label: 'warning', className: 'sevWarn' },
  critical: { label: 'critical', className: 'sevDanger' },
  info: { label: 'info', className: 'sevInfo' },
}

export function RuleEditor() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'rules' | 'actions'>('rules')
  const [rules, setRules] = useState<RuleDisplay[]>([])
  const [actions, setActions] = useState<ActionDisplay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [projectName, setProjectName] = useState('')
  const [ontology, setOntology] = useState<Ontology | null>(null)

  // Editing state
  const [editingRule, setEditingRule] = useState<string | null>(null)
  const [editingAction, setEditingAction] = useState<string | null>(null)

  // New rule form
  const [showNewRule, setShowNewRule] = useState(false)
  const [newRule, setNewRule] = useState({ id: '', name: '', severity: 'warning', triggerType: 'after_action', conditionEntity: '', actionType: 'notify' })

  // New action form
  const [showNewAction, setShowNewAction] = useState(false)
  const [newAction, setNewAction] = useState({ id: '', name: '' })

  // Modal state
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null)
  const [alertState, setAlertState] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null)

  useEffect(() => {
    if (!projectId) return

    Promise.all([
      fetchProject(projectId).then(p => setProjectName(p.name || projectId)).catch(() => {}),
      fetchOntology(projectId)
        .then(o => {
          if (o) {
            setOntology(o)
            setRules((o.rules || []).map(mapRule))
            setActions((o.actions || []).map(mapAction))
          }
        })
        .catch(e => setError(e.message))
        .finally(() => setLoading(false)),
    ])
  }, [projectId])

  function handleDeleteRule(ruleId: string) {
    setConfirmState({
      message: `确定删除规则 ${ruleId}？`,
      onConfirm: async () => {
        setConfirmState(null)
        if (!ontology) return
        const updated = { ...ontology, rules: (ontology.rules || []).filter(r => r.id !== ruleId) }
        await saveOntology(updated)
      },
    })
  }

  function handleDeleteAction(actionId: string) {
    setConfirmState({
      message: `确定删除动作 ${actionId}？`,
      onConfirm: async () => {
        setConfirmState(null)
        if (!ontology) return
        const updated = { ...ontology, actions: (ontology.actions || []).filter(a => a.id !== actionId) }
        await saveOntology(updated)
      },
    })
  }

  function handleRuleFieldChange(ruleId: string, path: string, value: unknown) {
    if (!ontology) return
    const updatedRules = (ontology.rules || []).map(r => {
      if (r.id !== ruleId) return r
      const updated = { ...r }
      if (path === 'severity') updated.severity = value as string
      else if (path === 'trigger.type') updated.trigger = { ...updated.trigger, type: value as 'before_action' | 'after_action' | 'schedule' }
      else if (path === 'trigger.source') updated.trigger = { ...updated.trigger, source: (value as string).split(',').map(s => s.trim()).filter(Boolean) }
      else if (path === 'trigger.cron') updated.trigger = { ...updated.trigger, cron: value as string }
      else if (path === 'condition.entity') updated.condition = { ...updated.condition, entity: value as string }
      else if (path === 'condition.expression') updated.condition = { ...updated.condition, expression: value as string }
      else if (path === 'action.type') updated.action = { ...updated.action, type: value as string }
      else if (path === 'action.target') updated.action = { ...updated.action, target: value as string }
      else if (path === 'action.notify') updated.action = { ...updated.action, notify: value as string }
      else if (path === 'action.message_template') updated.action = { ...updated.action, message_template: value as string }
      return updated
    })
    const updated = { ...ontology, rules: updatedRules }
    saveOntology(updated)
  }

  function handleActionFieldChange(actionId: string, path: string, value: unknown) {
    if (!ontology) return
    const updatedActions = (ontology.actions || []).map(a => {
      if (a.id !== actionId) return a
      const updated = { ...a }
      if (path === 'name') updated.name = value as string
      else if (path === 'permission.roles') {
        const roles = (value as string).split(',').map(s => s.trim()).filter(Boolean)
        updated.permission = { ...updated.permission, roles }
      }
      else if (path === 'decision_log') updated.decision_log = value as boolean
      return updated
    })
    const updated = { ...ontology, actions: updatedActions }
    saveOntology(updated)
  }

  async function handleAddRule() {
    if (!newRule.id || !newRule.name || !ontology) return
    const rule: OntologyRule = {
      id: newRule.id,
      name: newRule.name,
      severity: newRule.severity,
      trigger: { type: newRule.triggerType as 'before_action' | 'after_action' | 'schedule', source: [] },
      condition: { entity: newRule.conditionEntity, expression: '' },
      action: { type: newRule.actionType },
      params: [],
    }
    const updated = { ...ontology, rules: [...(ontology.rules || []), rule] }
    await saveOntology(updated)
    setShowNewRule(false)
    setNewRule({ id: '', name: '', severity: 'warning', triggerType: 'after_action', conditionEntity: '', actionType: 'notify' })
  }

  function handleParamChange(ruleId: string, paramName: string, newValue: string) {
    if (!ontology) return
    const updatedRules = (ontology.rules || []).map(r => {
      if (r.id !== ruleId) return r
      return {
        ...r,
        params: (r.params || []).map(p =>
          p.name === paramName ? { ...p, default: newValue } : p
        ),
      }
    })
    const updated = { ...ontology, rules: updatedRules }
    saveOntology(updated)
  }

  async function handleAddAction() {
    if (!newAction.id || !newAction.name || !ontology) return
    const action: OntologyAction = {
      id: newAction.id,
      name: newAction.name,
      params: [],
      writes: [],
      triggers_before: [],
      triggers_after: [],
    }
    const updated = { ...ontology, actions: [...(ontology.actions || []), action] }
    await saveOntology(updated)
    setShowNewAction(false)
    setNewAction({ id: '', name: '' })
  }

  async function saveOntology(updated: Ontology) {
    try {
      const { dump } = await import('js-yaml')
      const yamlStr = dump(updated, { lineWidth: 120 })
      await mcpCall('update_ontology_yaml', {
        project_id: projectId,
        yaml_content: yamlStr,
      })
      setOntology(updated)
      setRules((updated.rules || []).map(mapRule))
      setActions((updated.actions || []).map(mapAction))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setAlertState({ message: '保存失败: ' + msg, type: 'error' })
    }
  }

  return (
    <div>
      <div className={styles.back} onClick={() => navigate(`/project/${projectId}/graph`)}>← 返回图谱视图</div>
      <h2 className={styles.title}>规则与动作</h2>
      <div className={styles.subtitle}>{projectName || projectId} · {rules.length}条规则 · {actions.length}个动作</div>

      <div className={styles.tabs}>
        <button className={`${styles.tab} ${tab === 'rules' ? styles.tabActive : ''}`} onClick={() => setTab('rules')}>规则（{rules.length}）</button>
        <button className={`${styles.tab} ${tab === 'actions' ? styles.tabActive : ''}`} onClick={() => setTab('actions')}>动作（{actions.length}）</button>
      </div>

      {loading && <div className={styles.empty}>加载中…</div>}
      {error && <div className={styles.empty}>加载失败: {error}</div>}
      {!loading && !error && rules.length === 0 && actions.length === 0 && (
        <div className={styles.empty}>暂无规则和动作数据。请先通过 Agent 构建对话生成本体定义。</div>
      )}

      {tab === 'rules' && !loading && (
        <>
          {rules.map(r => {
            const sev = sevConfig[r.severity] ?? sevConfig.info
            const rawRule = ontology?.rules?.find(rule => rule.id === r.id)
            const isEditing = editingRule === r.id
            return (
              <div key={r.id} className={styles.ruleCard}>
                <div className={styles.ruleTop}>
                  <div>
                    <span className={styles.ruleId}>{r.id}</span>
                    <span className={styles.ruleName}>{r.name}</span>
                  </div>
                  <div className={styles.ruleTopRight}>
                    <span
                      className={`${styles.severity} ${styles[sev.className]}`}
                      onClick={() => {
                        const order = ['info', 'warning', 'critical']
                        const next = order[(order.indexOf(r.severity) + 1) % order.length]
                        handleRuleFieldChange(r.id, 'severity', next)
                      }}
                      style={{ cursor: 'pointer' }}
                      title="点击切换严重等级"
                    >
                      {sev.label}
                    </span>
                    <button className={styles.deleteBtn} onClick={() => handleDeleteRule(r.id)} title="删除规则">×</button>
                  </div>
                </div>
                <div className={styles.ruleBody}>
                  <div className={styles.ruleRow}>
                    <span className={styles.ruleLabel}>触发</span>
                    {isEditing ? (
                      <>
                        <select
                          className={styles.inlineSelect}
                          defaultValue={rawRule?.trigger?.type || 'after_action'}
                          onBlur={e => handleRuleFieldChange(r.id, 'trigger.type', e.target.value)}
                        >
                          <option value="after_action">动作执行后</option>
                          <option value="before_action">动作执行前</option>
                          <option value="schedule">定时触发</option>
                        </select>
                        {rawRule?.trigger?.type === 'schedule' ? (
                          <input
                            className={styles.inlineInput}
                            defaultValue={rawRule?.trigger?.cron || ''}
                            onBlur={e => handleRuleFieldChange(r.id, 'trigger.cron', e.target.value)}
                            placeholder="0 8 * * *"
                          />
                        ) : (
                          <input
                            className={styles.inlineInput}
                            defaultValue={rawRule?.trigger?.source?.join(', ') || ''}
                            onBlur={e => handleRuleFieldChange(r.id, 'trigger.source', e.target.value)}
                            placeholder="A01, A02"
                          />
                        )}
                      </>
                    ) : (
                      <>
                        <span className={styles.ruleVal} onClick={() => setEditingRule(r.id)} style={{ cursor: 'pointer' }}>{r.triggerType}</span>
                        <span className={styles.ruleHint} onClick={() => setEditingRule(r.id)} style={{ cursor: 'pointer' }}>{r.triggerSource}</span>
                      </>
                    )}
                  </div>
                  <div className={styles.connector}><span>当</span></div>
                  <div className={styles.ruleRow}>
                    <span className={styles.ruleLabel}>条件</span>
                    {isEditing ? (
                      <>
                        <input
                          className={styles.inlineInput}
                          defaultValue={rawRule?.condition?.entity || ''}
                          onBlur={e => handleRuleFieldChange(r.id, 'condition.entity', e.target.value)}
                          placeholder="实体 (如 inventory_position)"
                          style={{ flex: '0 0 auto', width: '160px' }}
                        />
                        <input
                          className={styles.inlineInput}
                          defaultValue={rawRule?.condition?.expression || ''}
                          onBlur={e => handleRuleFieldChange(r.id, 'condition.expression', e.target.value)}
                          placeholder="表达式 (如 available_qty < safety_stock)"
                        />
                      </>
                    ) : (
                      <span className={styles.ruleVal} onClick={() => setEditingRule(r.id)} style={{ cursor: 'pointer' }}>{r.condition}</span>
                    )}
                  </div>
                  <div className={styles.connector}><span>则</span></div>
                  <div className={styles.ruleRow}>
                    <span className={styles.ruleLabel}>动作</span>
                    {isEditing ? (
                      <>
                        <select
                          className={styles.inlineSelect}
                          defaultValue={rawRule?.action?.type || 'notify'}
                          onBlur={e => handleRuleFieldChange(r.id, 'action.type', e.target.value)}
                        >
                          <option value="notify">notify</option>
                          <option value="require_approval">require_approval</option>
                          <option value="update_attribute">update_attribute</option>
                          <option value="create_record">create_record</option>
                        </select>
                        {(rawRule?.action?.type === 'require_approval' || rawRule?.action?.type === 'update_attribute' || rawRule?.action?.type === 'create_record') && (
                          <input
                            className={styles.inlineInput}
                            defaultValue={rawRule?.action?.target || ''}
                            onBlur={e => handleRuleFieldChange(r.id, 'action.target', e.target.value)}
                            placeholder="目标"
                            style={{ flex: '0 0 auto', width: '120px' }}
                          />
                        )}
                        {rawRule?.action?.type === 'notify' && (
                          <>
                            <input
                              className={styles.inlineInput}
                              defaultValue={rawRule?.action?.notify || ''}
                              onBlur={e => handleRuleFieldChange(r.id, 'action.notify', e.target.value)}
                              placeholder="通知对象 (Agent ID)"
                              style={{ flex: '0 0 auto', width: '120px' }}
                            />
                            <input
                              className={styles.inlineInput}
                              defaultValue={rawRule?.action?.message_template || ''}
                              onBlur={e => handleRuleFieldChange(r.id, 'action.message_template', e.target.value)}
                              placeholder="消息模板"
                            />
                          </>
                        )}
                      </>
                    ) : (
                      <span className={styles.ruleVal} onClick={() => setEditingRule(r.id)} style={{ cursor: 'pointer' }}>{r.action}</span>
                    )}
                  </div>
                  {isEditing && (
                    <div className={styles.editHint}>
                      点击空白处或按 Tab 保存更改 · <span onClick={() => setEditingRule(null)} style={{ cursor: 'pointer', textDecoration: 'underline' }}>退出编辑</span>
                    </div>
                  )}
                </div>
                {r.params.length > 0 && (
                  <div className={styles.paramGrid}>
                    {r.params.map(p => (
                      <div key={p.name} className={styles.paramItem}>
                        <div className={styles.paramLabel}>
                          {p.name}
                          {p.configurable && <span className={styles.configTag}>客户可调</span>}
                        </div>
                        <input
                          className={styles.paramVal}
                          defaultValue={p.value}
                          onBlur={e => handleParamChange(r.id, p.name, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {showNewRule ? (
            <div className={styles.newForm}>
              <input placeholder="规则ID (如 R09)" value={newRule.id} onChange={e => setNewRule(p => ({ ...p, id: e.target.value }))} className={styles.formInput} />
              <input placeholder="规则名称" value={newRule.name} onChange={e => setNewRule(p => ({ ...p, name: e.target.value }))} className={styles.formInput} />
              <select value={newRule.severity} onChange={e => setNewRule(p => ({ ...p, severity: e.target.value }))} className={styles.formInput}>
                <option value="warning">warning</option>
                <option value="critical">critical</option>
                <option value="info">info</option>
              </select>
              <select value={newRule.triggerType} onChange={e => setNewRule(p => ({ ...p, triggerType: e.target.value }))} className={styles.formInput}>
                <option value="after_action">动作执行后</option>
                <option value="before_action">动作执行前</option>
                <option value="schedule">定时触发</option>
              </select>
              <input placeholder="条件实体 (如 inventory_position)" value={newRule.conditionEntity} onChange={e => setNewRule(p => ({ ...p, conditionEntity: e.target.value }))} className={styles.formInput} />
              <select value={newRule.actionType} onChange={e => setNewRule(p => ({ ...p, actionType: e.target.value }))} className={styles.formInput}>
                <option value="notify">notify</option>
                <option value="require_approval">require_approval</option>
                <option value="update_attribute">update_attribute</option>
                <option value="create_record">create_record</option>
              </select>
              <div className={styles.formActions}>
                <button className={styles.formBtn} onClick={handleAddRule}>添加</button>
                <button className={styles.formBtnCancel} onClick={() => setShowNewRule(false)}>取消</button>
              </div>
            </div>
          ) : (
            <div className={styles.addBtn} onClick={() => setShowNewRule(true)}>+ 新增规则</div>
          )}
        </>
      )}

      {tab === 'actions' && !loading && (
        <>
          {actions.map(a => {
            const rawAction = ontology?.actions?.find(act => act.id === a.id)
            const isEditingAct = editingAction === a.id
            return (
              <div key={a.id} className={styles.actionCard}>
                <div className={styles.ruleTop}>
                  <div>
                    <span className={styles.ruleId}>{a.id}</span>
                    {isEditingAct ? (
                      <input
                        className={styles.inlineInput}
                        defaultValue={a.name}
                        onBlur={e => handleActionFieldChange(a.id, 'name', e.target.value)}
                        style={{ marginLeft: 8, width: '160px' }}
                      />
                    ) : (
                      <span className={styles.ruleName} onClick={() => setEditingAction(a.id)} style={{ cursor: 'pointer' }}>{a.name}</span>
                    )}
                    {isEditingAct ? (
                      <label className={styles.inlineLabel} style={{ marginLeft: 8 }}>
                        <input
                          type="checkbox"
                          className={styles.inlineCheckbox}
                          defaultChecked={rawAction?.decision_log || false}
                          onChange={e => handleActionFieldChange(a.id, 'decision_log', e.target.checked)}
                        />
                        决策记录
                      </label>
                    ) : (
                      a.decisionLog && <span className={styles.configTag}>决策记录</span>
                    )}
                  </div>
                  <div className={styles.ruleTopRight}>
                    {isEditingAct && (
                      <span onClick={() => setEditingAction(null)} style={{ cursor: 'pointer', fontSize: 11, color: 'var(--color-text-tertiary)', textDecoration: 'underline' }}>退出编辑</span>
                    )}
                    <button className={styles.deleteBtn} onClick={() => handleDeleteAction(a.id)} title="删除动作">×</button>
                  </div>
                </div>
                <div className={styles.actionWrites}>{a.writes.split('\n').map((l, i) => <div key={i}>写入：{l}</div>)}</div>
                <div className={styles.triggerTags}>
                  {a.triggersBefore.map(t => <span key={t} className={`${styles.triggerTag} ${styles.trigBefore}`}>执行前触发 {t}</span>)}
                  {a.triggersAfter.map(t => <span key={t} className={`${styles.triggerTag} ${styles.trigAfter}`}>执行后触发 {t}</span>)}
                </div>
                {isEditingAct ? (
                  <div className={styles.permTags} style={{ alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginRight: 4 }}>权限:</span>
                    <input
                      className={styles.inlineInput}
                      defaultValue={(rawAction?.permission?.roles || []).join(', ')}
                      onBlur={e => handleActionFieldChange(a.id, 'permission.roles', e.target.value)}
                      placeholder="角色 (逗号分隔)"
                      style={{ width: '200px' }}
                    />
                  </div>
                ) : (
                  <div className={styles.permTags} onClick={() => setEditingAction(a.id)} style={{ cursor: 'pointer' }}>
                    {a.permissions.map(p => <span key={p} className={styles.permTag}>{p}</span>)}
                  </div>
                )}
              </div>
            )
          })}

          {showNewAction ? (
            <div className={styles.newForm}>
              <input placeholder="动作ID (如 A09)" value={newAction.id} onChange={e => setNewAction(p => ({ ...p, id: e.target.value }))} className={styles.formInput} />
              <input placeholder="动作名称" value={newAction.name} onChange={e => setNewAction(p => ({ ...p, name: e.target.value }))} className={styles.formInput} />
              <div className={styles.formActions}>
                <button className={styles.formBtn} onClick={handleAddAction}>添加</button>
                <button className={styles.formBtnCancel} onClick={() => setShowNewAction(false)}>取消</button>
              </div>
            </div>
          ) : (
            <div className={styles.addBtn} onClick={() => setShowNewAction(true)}>+ 新增动作</div>
          )}
        </>
      )}

      <ConfirmModal
        open={!!confirmState}
        message={confirmState?.message || ''}
        danger
        onConfirm={() => confirmState?.onConfirm()}
        onCancel={() => setConfirmState(null)}
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
