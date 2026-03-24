import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchOntology, fetchProject, fetchStageOutput } from '../../api/ontology'
import { mcpCall } from '../../api/mcp'
import yaml from 'js-yaml'
import type { Ontology } from '../../types/ontology'
import { AlertModal } from '../../components/Modal'
import styles from './ReviewReport.module.css'

interface Issue {
  type: 'consistency' | 'completeness' | 'suggestion'
  text: string
  detail: string
  fixLabel: string
  autoFix: boolean
}

interface Summary {
  num: number
  label: string
  color: string
}

const typeConfig = {
  consistency: { label: '一致性', className: 'typeConsist', dotColor: 'var(--color-danger-tone)' },
  completeness: { label: '完整性', className: 'typeComplete', dotColor: 'var(--color-warning-tone)' },
  suggestion: { label: '建议', className: 'typeSuggest', dotColor: 'var(--color-info-tone)' },
}

function buildReportFromOntology(ontology: Ontology): { summary: Summary[]; issues: Issue[]; passItems: string[] } {
  const issues: Issue[] = []
  const passItems: string[] = []

  // Run basic validation checks
  const classes = ontology.classes || []
  const rels = ontology.relationships || []
  const rules = ontology.rules || []
  const actions = ontology.actions || []

  const classIds = new Set(classes.map(c => c.id))
  const firstCitizens = classes.filter(c => c.first_citizen)

  // Check: exactly one first citizen
  if (firstCitizens.length === 1) {
    const fc = firstCitizens[0]
    passItems.push(`第一公民（${fc.name}）已指定，有 ${fc.attributes?.length || 0} 个属性`)
  } else if (firstCitizens.length === 0) {
    issues.push({ type: 'consistency', text: '未指定第一公民类', detail: '每个本体必须有且仅有一个 first_citizen=true 的类', fixLabel: '指定第一公民', autoFix: false })
  } else {
    issues.push({ type: 'consistency', text: `存在 ${firstCitizens.length} 个第一公民类: ${firstCitizens.map(c => c.name).join(', ')}`, detail: '每个本体只能有一个第一公民', fixLabel: '修正', autoFix: false })
  }

  // Check: all relationship refs valid
  let relRefsValid = true
  for (const rel of rels) {
    if (!classIds.has(rel.from)) {
      issues.push({ type: 'consistency', text: `关系 ${rel.id} 的 from 引用了不存在的类 "${rel.from}"`, detail: '', fixLabel: '修正引用', autoFix: false })
      relRefsValid = false
    }
    if (!classIds.has(rel.to)) {
      issues.push({ type: 'consistency', text: `关系 ${rel.id} 的 to 引用了不存在的类 "${rel.to}"`, detail: '', fixLabel: '修正引用', autoFix: false })
      relRefsValid = false
    }
  }
  if (relRefsValid && rels.length > 0) {
    passItems.push('所有关系的 from/to 引用了已定义的类')
  }

  // Check: no isolated classes
  const connectedClasses = new Set<string>()
  for (const rel of rels) {
    connectedClasses.add(rel.from)
    connectedClasses.add(rel.to)
  }
  const isolated = classes.filter(c => !connectedClasses.has(c.id))
  if (isolated.length === 0 && classes.length > 0) {
    passItems.push('无孤立类（所有类至少有一个关系）')
  } else if (isolated.length > 0) {
    issues.push({ type: 'completeness', text: `${isolated.length} 个孤立类没有任何关系: ${isolated.map(c => c.name).join(', ')}`, detail: '建议为这些类添加关系', fixLabel: '添加关系', autoFix: false })
  }

  // Check: ID format (snake_case)
  let allSnakeCase = true
  for (const c of classes) {
    if (!/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(c.id)) {
      issues.push({ type: 'consistency', text: `类 ID "${c.id}" 不符合 snake_case 规范`, detail: '', fixLabel: '重命名', autoFix: true })
      allSnakeCase = false
    }
  }
  if (allSnakeCase && classes.length > 0) {
    passItems.push('命名规范：所有ID使用snake_case')
  }

  // Check: derived attributes have valid formulas
  let derivedValid = true
  for (const c of classes) {
    for (const attr of c.attributes || []) {
      if (attr.derived && attr.required) {
        issues.push({ type: 'consistency', text: `类 ${c.name} 的派生属性 ${attr.name} 不应标记为 required`, detail: '派生属性的值由公式计算，不应要求用户输入', fixLabel: '移除 required', autoFix: true })
        derivedValid = false
      }
    }
  }
  if (derivedValid) {
    passItems.push('所有派生属性未标记为 required')
  }

  // Check graph_sync attributes
  const totalAttrs = classes.reduce((sum, c) => sum + (c.attributes?.length || 0), 0)
  const syncedAttrs = classes.reduce((sum, c) => sum + (c.attributes?.filter(a => a.graph_sync)?.length || 0), 0)
  if (totalAttrs > 0) {
    passItems.push(`图谱同步标记：${syncedAttrs}/${totalAttrs} 个属性同步`)
  }

  // Check: rules reference valid actions
  const actionIds = new Set(actions.map(a => a.id))
  for (const rule of rules) {
    if (rule.trigger?.source) {
      for (const src of rule.trigger.source) {
        if (!actionIds.has(src)) {
          issues.push({ type: 'consistency', text: `规则 ${rule.id} 的触发源引用了不存在的动作 "${src}"`, detail: '', fixLabel: '修正引用', autoFix: false })
        }
      }
    }
  }

  // Check: actions trigger_before/after reference valid rules
  const ruleIds = new Set(rules.map(r => r.id))
  for (const action of actions) {
    for (const rId of action.triggers_before || []) {
      if (!ruleIds.has(rId)) {
        issues.push({ type: 'consistency', text: `动作 ${action.id} 的 triggers_before 引用了不存在的规则 "${rId}"`, detail: '', fixLabel: '修正引用', autoFix: false })
      }
    }
    for (const rId of action.triggers_after || []) {
      if (!ruleIds.has(rId)) {
        issues.push({ type: 'consistency', text: `动作 ${action.id} 的 triggers_after 引用了不存在的规则 "${rId}"`, detail: '', fixLabel: '修正引用', autoFix: false })
      }
    }
  }

  // Suggestions
  if (firstCitizens.length === 1 && (firstCitizens[0].attributes?.length || 0) < 10) {
    issues.push({ type: 'suggestion', text: `第一公民类 ${firstCitizens[0].name} 只有 ${firstCitizens[0].attributes?.length || 0} 个属性，建议至少 10 个以覆盖核心业务需求`, detail: '', fixLabel: '补充属性', autoFix: false })
  }

  const consistencyCount = issues.filter(i => i.type === 'consistency').length
  const completenessCount = issues.filter(i => i.type === 'completeness').length
  const suggestionCount = issues.filter(i => i.type === 'suggestion').length

  const summary: Summary[] = [
    { num: passItems.length, label: '通过', color: 'var(--color-success-tone)' },
    { num: consistencyCount, label: '一致性', color: 'var(--color-danger-tone)' },
    { num: completenessCount, label: '完整性', color: 'var(--color-warning-tone)' },
    { num: suggestionCount, label: '建议', color: 'var(--color-info-tone)' },
  ]

  return { summary, issues, passItems }
}

function applyAutoFix(ont: Ontology, issue: Issue): Ontology | null {
  const updated = { ...ont }

  // Fix: snake_case ID
  if (issue.text.includes('不符合 snake_case')) {
    const match = issue.text.match(/类 ID "([^"]+)"/)
    if (match) {
      const oldId = match[1]
      const newId = oldId.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '')
      updated.classes = updated.classes.map(c => c.id === oldId ? { ...c, id: newId } : c)
      // Also update relationship references
      updated.relationships = (updated.relationships || []).map(r => ({
        ...r,
        from: r.from === oldId ? newId : r.from,
        to: r.to === oldId ? newId : r.to,
      }))
      return updated
    }
  }

  // Fix: derived + required conflict
  if (issue.text.includes('派生属性') && issue.text.includes('不应标记为 required')) {
    const classMatch = issue.text.match(/类 (.+?) 的/)
    const attrMatch = issue.text.match(/属性 (.+?) 不应/)
    if (classMatch && attrMatch) {
      const className = classMatch[1]
      const attrName = attrMatch[1]
      updated.classes = updated.classes.map(c => {
        if (c.name !== className) return c
        return {
          ...c,
          attributes: (c.attributes || []).map(a =>
            a.name === attrName ? { ...a, required: false } : a
          ),
        }
      })
      return updated
    }
  }

  return null // Can't auto-fix this issue
}

export function ReviewReport() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const [summary, setSummary] = useState<Summary[]>([])
  const [issues, setIssues] = useState<Issue[]>([])
  const [passItems, setPassItems] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [projectName, setProjectName] = useState('')
  const [reauditing, setReauditing] = useState(false)
  const [ontologyData, setOntologyData] = useState<Ontology | null>(null)
  const [alertState, setAlertState] = useState<{ message: string; type: 'error' | 'success' } | null>(null)

  async function handleFixIssue(_index: number, issue: Issue) {
    if (issue.autoFix && ontologyData) {
      const updated = applyAutoFix(ontologyData, issue)
      if (updated) {
        try {
          const { dump } = await import('js-yaml')
          const yamlStr = dump(updated, { lineWidth: 120 })
          await mcpCall('save_output', {
            project_id: projectId,
            stage: 'ontology_structure',
            content: yamlStr,
          })
          setOntologyData(updated)
          // Re-run validation
          const report = buildReportFromOntology(updated)
          setSummary(report.summary)
          setIssues(report.issues)
          setPassItems(report.passItems)
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          setAlertState({ message: '修复失败: ' + msg, type: 'error' })
        }
      }
    } else {
      // Manual fix: navigate to relevant editor
      if (issue.text.includes('规则') || issue.text.includes('动作')) {
        navigate(`/project/${projectId}/rules`)
      } else {
        navigate(`/project/${projectId}/graph`)
      }
    }
  }

  function handleIgnoreIssue(index: number) {
    const updated = issues.filter((_, i) => i !== index)
    setIssues(updated)
    updateSummary(updated)
  }

  function updateSummary(updatedIssues: Issue[]) {
    const consistencyCount = updatedIssues.filter(i => i.type === 'consistency').length
    const completenessCount = updatedIssues.filter(i => i.type === 'completeness').length
    const suggestionCount = updatedIssues.filter(i => i.type === 'suggestion').length
    setSummary(prev => [
      { ...prev[0], num: prev[0].num + (issues.length - updatedIssues.length) },
      { ...prev[1], num: consistencyCount },
      { ...prev[2], num: completenessCount },
      { ...prev[3], num: suggestionCount },
    ])
  }

  const loadReport = useCallback(async () => {
    setLoading(true)
    try {
      // Fetch project name
      fetchProject(projectId!).then(p => setProjectName(p.name || '')).catch(() => {})

      // First try to read a saved review_report stage
      const reviewYaml = await fetchStageOutput(projectId!, 'review_report')
      if (reviewYaml) {
        try {
          const parsed = yaml.load(reviewYaml) as {
            issues?: Array<{ type: string; text: string; detail?: string; fix_suggestion?: string; auto_fixable?: boolean }>
            passed_items?: string[]
          }
          if (parsed?.issues) {
            const mappedIssues: Issue[] = (parsed.issues || []).map(i => ({
              type: (i.type as Issue['type']) || 'suggestion',
              text: i.text,
              detail: i.detail || '',
              fixLabel: i.fix_suggestion || '修复',
              autoFix: i.auto_fixable ?? false,
            }))
            const mappedPass = parsed.passed_items || []
            setIssues(mappedIssues)
            setPassItems(mappedPass)

            const consistencyCount = mappedIssues.filter(i => i.type === 'consistency').length
            const completenessCount = mappedIssues.filter(i => i.type === 'completeness').length
            const suggestionCount = mappedIssues.filter(i => i.type === 'suggestion').length
            setSummary([
              { num: mappedPass.length, label: '通过', color: 'var(--color-success-tone)' },
              { num: consistencyCount, label: '一致性', color: 'var(--color-danger-tone)' },
              { num: completenessCount, label: '完整性', color: 'var(--color-warning-tone)' },
              { num: suggestionCount, label: '建议', color: 'var(--color-info-tone)' },
            ])
            // Also load ontology for auto-fix support
            fetchOntology(projectId!).then(o => { if (o) setOntologyData(o) }).catch(() => {})
            return
          }
        } catch { /* parse failed, fall through */ }
      }

      // Fallback: build report from ontology YAML
      const ont = await fetchOntology(projectId!)
      if (ont) {
        setOntologyData(ont)
        const report = buildReportFromOntology(ont)
        setSummary(report.summary)
        setIssues(report.issues)
        setPassItems(report.passItems)
      } else {
        setSummary([
          { num: 0, label: '通过', color: 'var(--color-success-tone)' },
          { num: 0, label: '一致性', color: 'var(--color-danger-tone)' },
          { num: 0, label: '完整性', color: 'var(--color-warning-tone)' },
          { num: 0, label: '建议', color: 'var(--color-info-tone)' },
        ])
      }
    } catch {
      // Keep empty state
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    loadReport()
  }, [projectId, loadReport])

  async function handleReaudit() {
    setReauditing(true)
    try {
      const ont = await fetchOntology(projectId!)
      if (ont) {
        setOntologyData(ont)
        // Also run server-side validation
        const yamlModule = await import('js-yaml')
        const yamlStr = yamlModule.dump(ont, { lineWidth: 120 })
        try {
          await mcpCall('validate_yaml', { yaml_content: yamlStr, check_level: 'full' })
        } catch { /* validation may fail, we still show local report */ }

        const report = buildReportFromOntology(ont)
        setSummary(report.summary)
        setIssues(report.issues)
        setPassItems(report.passItems)
      }
    } finally {
      setReauditing(false)
    }
  }

  return (
    <div>
      <div className={styles.back} onClick={() => navigate(`/project/${projectId}/graph`)}>← 返回图谱视图</div>
      <div className={styles.header}>
        <h2 className={styles.title}>审核报告</h2>
        {projectName && <span className={styles.projName}>{projectName}</span>}
        <span className={styles.badge}>{issues.length} 项需处理</span>
      </div>

      {loading ? (
        <div className={styles.loading}>加载中…</div>
      ) : (
        <>
          <div className={styles.summary}>
            {summary.map(s => (
              <div key={s.label} className={styles.sumCard}>
                <div className={styles.sumNum} style={{ color: s.color }}>{s.num}</div>
                <div className={styles.sumLabel}>{s.label}</div>
              </div>
            ))}
          </div>

          {(['consistency', 'completeness', 'suggestion'] as const).map(type => {
            const items = issues.filter(i => i.type === type)
            if (items.length === 0) return null
            const cfg = typeConfig[type]
            return (
              <div key={type} className={styles.section}>
                <div className={styles.secHeader}>
                  <span className={styles.secDot} style={{ background: cfg.dotColor }} />
                  {type === 'consistency' ? '一致性问题' : type === 'completeness' ? '完整性问题' : '优化建议'}
                </div>
                {items.map((issue, i) => (
                  <div key={i} className={styles.issue}>
                    <div className={styles.issueTop}>
                      <span className={`${styles.issueType} ${styles[cfg.className]}`}>{cfg.label}</span>
                    </div>
                    <div className={styles.issueText}>{issue.text}</div>
                    {issue.detail && <div className={styles.issueDetail}>{issue.detail}</div>}
                    <div className={styles.issueActions}>
                      <button
                        className={`${styles.fixBtn} ${issue.autoFix ? styles.fixBtnAuto : ''}`}
                        onClick={() => handleFixIssue(i, issue)}
                      >
                        {issue.fixLabel}
                      </button>
                      <button
                        className={styles.ignoreBtn}
                        onClick={() => handleIgnoreIssue(i)}
                      >
                        {type === 'completeness' ? '标记为后续版本' : '忽略'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          })}

          {issues.length === 0 && passItems.length > 0 && (
            <div className={styles.allPass}>所有检查项已通过，可以发布</div>
          )}

          <div className={styles.section}>
            <div className={styles.secHeader}>
              <span className={styles.secDot} style={{ background: 'var(--color-success-tone)' }} />
              通过项（{passItems.length}项）
            </div>
            <div className={styles.passList}>
              {passItems.map((item, i) => (
                <div key={i} className={styles.passItem}>
                  <span className={styles.passCheck} />
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className={styles.bottomBar}>
            <button className={styles.btnSecondary} onClick={handleReaudit} disabled={reauditing}>
              {reauditing ? '审核中…' : '重新审核'}
            </button>
            <button
              className={styles.btnPrimary}
              onClick={() => navigate(`/project/${projectId}/publish`)}
              disabled={issues.some(i => i.type === 'consistency')}
              title={issues.some(i => i.type === 'consistency') ? '请先解决一致性问题' : ''}
            >
              {issues.some(i => i.type === 'consistency') ? '存在阻断问题' : '全部处理完毕，发布'}
            </button>
          </div>
        </>
      )}

      {alertState && (
        <AlertModal
          open
          title={alertState.type === 'error' ? '错误' : '成功'}
          message={alertState.message}
          type={alertState.type}
          onClose={() => setAlertState(null)}
        />
      )}
    </div>
  )
}
