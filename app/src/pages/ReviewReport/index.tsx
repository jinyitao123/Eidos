import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchOntology, fetchProject, fetchStageOutput } from '../../api/ontology'
import { mcpCall } from '../../api/mcp'
import { weaveStream } from '../../api/client'
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

  // Check: rules reference valid actions
  const actionIds = new Set(actions.map(a => a.id))
  for (const rule of rules) {
    if (rule.trigger?.source) {
      // source can be a string or an array — normalize to array
      const sources = Array.isArray(rule.trigger.source)
        ? rule.trigger.source
        : [rule.trigger.source]
      for (const src of sources) {
        if (typeof src === 'string' && src && !actionIds.has(src)) {
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

  // Check: metrics
  const metrics = ontology.metrics || []
  if (metrics.length > 0) {
    // Check metric source_entities reference valid classes
    let metricRefsValid = true
    for (const m of metrics) {
      for (const se of m.source_entities || []) {
        if (!classIds.has(se)) {
          issues.push({ type: 'consistency', text: `指标 ${m.id} 的 source_entities 引用了不存在的类 "${se}"`, detail: '', fixLabel: '修正引用', autoFix: false })
          metricRefsValid = false
        }
      }
      if (m.kind === 'classification' && (!m.buckets || m.buckets.length === 0)) {
        issues.push({ type: 'consistency', text: `分类指标 ${m.id} 缺少 buckets 定义`, detail: 'classification 类型指标必须定义分类桶', fixLabel: '添加 buckets', autoFix: false })
      }
    }
    if (metricRefsValid) passItems.push(`指标引用检查通过（${metrics.length} 个指标）`)

    const implementedMetrics = metrics.filter(m => m.status === 'implemented')
    const noToolMetrics = implementedMetrics.filter(m => !m.tool)
    if (noToolMetrics.length > 0) {
      issues.push({ type: 'completeness', text: `${noToolMetrics.length} 个已实现指标缺少 tool 字段: ${noToolMetrics.map(m => m.id).join(', ')}`, detail: 'Agent 需要 tool 字段来路由指标计算', fixLabel: '补充 tool', autoFix: false })
    }

    const undefinedMetrics = metrics.filter(m => m.status === 'undefined' && (!m.known_issues || m.known_issues.length === 0))
    if (undefinedMetrics.length > 0) {
      issues.push({ type: 'suggestion', text: `${undefinedMetrics.length} 个未定义指标没有 known_issues 说明原因: ${undefinedMetrics.map(m => m.id).join(', ')}`, detail: '', fixLabel: '补充说明', autoFix: false })
    }
  }

  // Check: telemetry
  const telemetry = ontology.telemetry || []
  if (telemetry.length > 0) {
    let telRefsValid = true
    for (const t of telemetry) {
      if (!classIds.has(t.source_class)) {
        issues.push({ type: 'consistency', text: `遥测 ${t.id} 的 source_class 引用了不存在的类 "${t.source_class}"`, detail: '', fixLabel: '修正引用', autoFix: false })
        telRefsValid = false
      }
      if (!t.context_strategy) {
        issues.push({ type: 'consistency', text: `遥测 ${t.id} 缺少 context_strategy`, detail: 'context_strategy 控制 Agent 查询行为，防止上下文爆炸', fixLabel: '添加策略', autoFix: false })
      }
    }
    if (telRefsValid) passItems.push(`遥测引用检查通过（${telemetry.length} 个遥测流）`)
  }

  // P05: graph_sync over-synchronization
  {
    let totalAttrs = 0, syncedAttrs = 0
    for (const c of classes) {
      for (const a of c.attributes || []) {
        totalAttrs++
        if (a.graph_sync) syncedAttrs++
      }
    }
    if (totalAttrs > 0) {
      const syncPct = Math.round(syncedAttrs / totalAttrs * 100)
      if (syncPct > 80) {
        issues.push({ type: 'completeness', text: `graph_sync 标记过度：${syncedAttrs}/${totalAttrs} (${syncPct}%) 属性同步到图谱`, detail: '建议只同步 Agent 查询需要的属性（如数量、状态、关键标记），不同步描述性文字、时间戳等', fixLabel: '自动优化', autoFix: true })
      } else {
        passItems.push(`graph_sync 比例合理 (${syncPct}%)`)
      }
    }
  }

  // P06: phase diversity
  {
    const phases = new Set(classes.map(c => c.phase).filter(Boolean))
    if (classes.length >= 3 && phases.size <= 1) {
      const phaseStr = [...phases][0] || 'unknown'
      issues.push({ type: 'completeness', text: `所有 ${classes.length} 个类都在同一个 phase (${phaseStr})`, detail: '建议将核心类标记 alpha、辅助类标记 beta、扩展类标记 full，体现分期实施计划', fixLabel: '自动分期', autoFix: true })
    } else if (phases.size > 1) {
      passItems.push(`phase 分期合理 (${[...phases].join(', ')})`)
    }
  }

  // P07: first citizen derived attributes
  if (firstCitizens.length === 1) {
    const fc = firstCitizens[0]
    const attrs = fc.attributes || []
    const derivedCount = attrs.filter(a => a.derived || a.formula).length
    if (attrs.length >= 10) {
      const pct = Math.round(derivedCount / attrs.length * 100)
      if (pct < 15) {
        issues.push({ type: 'completeness', text: `第一公民 ${fc.name} 派生属性不足：${derivedCount}/${attrs.length} (${pct}%)`, detail: '建议至少 15% 的属性为派生计算（如金额、缺口、状态标记等），避免所有数据都依赖手动录入', fixLabel: 'AI 补充', autoFix: false })
      } else {
        passItems.push(`第一公民派生属性比例合理 (${pct}%)`)
      }
    }
  }

  // P08: rule trigger type diversity
  if (rules.length >= 3) {
    const triggerCounts: Record<string, number> = {}
    for (const rule of rules) {
      const t = typeof rule.trigger === 'string' ? rule.trigger : rule.trigger?.type || 'unknown'
      triggerCounts[t] = (triggerCounts[t] || 0) + 1
    }
    for (const [trigType, count] of Object.entries(triggerCounts)) {
      const pct = Math.round(count / rules.length * 100)
      if (pct > 70) {
        issues.push({ type: 'completeness', text: `${pct}% 的规则使用 ${trigType} 触发，类型过于单一`, detail: '建议区分事件驱动 (on_change/after_action) 和定时 (cron) 场景，避免全部使用定时触发', fixLabel: 'AI 调整', autoFix: false })
      }
    }
    if (!Object.values(triggerCounts).some(c => Math.round(c / rules.length * 100) > 70)) {
      passItems.push('规则触发类型多样性合理')
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

  // Fix P05: graph_sync over-synchronization — set non-essential attrs to false
  if (issue.text.includes('graph_sync') && issue.text.includes('标记过度')) {
    const noSyncPatterns = [
      /description|desc|备注|说明/i,
      /created_at|updated_at|uploaded_at/i,
      /coordinate|location|address|位置|地址/i,
      /ownership|owner|产权|归属/i,
      /asset_value|价值/i,
      /elevation|高程/i,
      /phase/i,
    ]
    updated.classes = updated.classes.map(c => ({
      ...c,
      attributes: (c.attributes || []).map(a => {
        if (!a.graph_sync) return a
        const shouldSync = !noSyncPatterns.some(p => p.test(a.id) || p.test(a.name))
          || a.type === 'enum' || a.type === 'boolean'  // enums and booleans are usually for filtering
          || a.required  // required fields are usually core data
        return { ...a, graph_sync: shouldSync }
      }),
    }))
    return updated
  }

  // Fix P06: phase diversity — auto-assign based on relationships
  if (issue.text.includes('同一个 phase')) {
    const relatedTo = new Map<string, number>()
    for (const rel of (ont.relationships || [])) {
      relatedTo.set(rel.from, (relatedTo.get(rel.from) || 0) + 1)
      relatedTo.set(rel.to, (relatedTo.get(rel.to) || 0) + 1)
    }
    updated.classes = updated.classes.map(c => {
      if (c.first_citizen) return { ...c, phase: 'alpha' }
      const relCount = relatedTo.get(c.id) || 0
      if (relCount >= 2) return { ...c, phase: 'alpha' }
      if (relCount === 1) return { ...c, phase: 'beta' }
      return { ...c, phase: 'full' }
    })
    return updated
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
    } else if (issue.text.includes('派生属性不足') || issue.text.includes('触发，类型过于单一')) {
      // Agent-assisted fix for P07/P08
      setAlertState({ message: '正在请求 AI 修正…', type: 'success' })
      try {
        const agentName = issue.text.includes('派生属性') ? 'ontology-architect' : 'rule-designer'
        const fixPrompt = issue.text.includes('派生属性')
          ? `当前第一公民的派生属性不足。请为第一公民类补充 3-5 个派生属性（如金额计算、状态标记、缺口计算等）。读取当前本体，只修改第一公民类的 attributes 列表，添加 derived+formula 属性。完成后 save_output 保存。`
          : `当前 ${issue.text}。请调整规则的触发类型：需要实时响应的规则（如数据变更后立即检查）应使用 on_change 或 after_action，只有周期性巡检类的才用 cron。读取当前规则，修改后 save_output 保存。`

        await weaveStream('/v1/chat', {
          agent: agentName,
          message: `${fixPrompt}\n\n重要：调用任何工具时，project_id 参数的值是 "${projectId}"。`,
          profile: `project_id=${projectId}`,
          stream: true,
        }, () => {}) // ignore stream events

        // Reload report
        setAlertState({ message: 'AI 修正完成，刷新页面查看结果', type: 'success' })
        setTimeout(() => window.location.reload(), 1500)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        setAlertState({ message: 'AI 修正失败: ' + msg, type: 'error' })
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
          const raw = yaml.load(reviewYaml) as Record<string, unknown>
          // S4 agent wraps under "report:", handle both formats
          const parsed = (raw?.report ?? raw) as {
            issues?: Array<Record<string, unknown>>
            passed_items?: string[]
            summary?: Record<string, unknown>
          }
          if (parsed?.issues) {
            // Map agent format {id, severity, message} → UI format {type, text}
            const severityToType: Record<string, Issue['type']> = {
              blocking: 'consistency', warning: 'completeness', suggestion: 'suggestion',
            }
            const mappedIssues: Issue[] = (parsed.issues || []).map(i => ({
              type: severityToType[String(i.severity || '')] || (i.type as Issue['type']) || 'suggestion',
              text: String(i.text || i.message || ''),
              detail: String(i.detail || ''),
              fixLabel: String(i.fix_suggestion || i.fix_description || '修复'),
              autoFix: (i.auto_fixable as boolean) ?? false,
            }))
            const mappedPass = (parsed.passed_items || []).map(p =>
              typeof p === 'string' ? p : String((p as Record<string, unknown>).message || (p as Record<string, unknown>).text || JSON.stringify(p))
            )
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
            // Also run deterministic checks from ontology YAML and merge
            fetchOntology(projectId!).then(o => {
              if (o) {
                setOntologyData(o)
                const codeReport = buildReportFromOntology(o)
                // Merge code-detected issues that S4 missed (avoid duplicates by text prefix)
                const existingTexts = new Set(mappedIssues.map(i => i.text.slice(0, 30)))
                const newIssues = codeReport.issues.filter(i => !existingTexts.has(i.text.slice(0, 30)))
                if (newIssues.length > 0) {
                  const merged = [...mappedIssues, ...newIssues]
                  setIssues(merged)
                  const c = merged.filter(i => i.type === 'consistency').length
                  const w = merged.filter(i => i.type === 'completeness').length
                  const s = merged.filter(i => i.type === 'suggestion').length
                  setSummary([
                    { num: mappedPass.length + codeReport.passItems.filter(p => !mappedPass.some(mp => mp.slice(0,20) === p.slice(0,20))).length, label: '通过', color: 'var(--color-success-tone)' },
                    { num: c, label: '一致性', color: 'var(--color-danger-tone)' },
                    { num: w, label: '完整性', color: 'var(--color-warning-tone)' },
                    { num: s, label: '建议', color: 'var(--color-info-tone)' },
                  ])
                  // Merge pass items
                  const newPass = codeReport.passItems.filter(p => !mappedPass.some(mp => mp.slice(0,20) === p.slice(0,20)))
                  if (newPass.length > 0) setPassItems([...mappedPass, ...newPass])
                }
              }
            }).catch(() => {})
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
                      {type !== 'consistency' && (
                        <button
                          className={styles.ignoreBtn}
                          onClick={() => handleIgnoreIssue(i)}
                        >
                          {type === 'completeness' ? '标记为后续版本' : '忽略'}
                        </button>
                      )}
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
