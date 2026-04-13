import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Network } from 'lucide-react'
import { mcpCall } from '../../api/mcp'
import { PromptModal, AlertModal, ConfirmModal } from '../../components/Modal'
import styles from './ProjectList.module.css'

interface Project {
  id: string
  name: string
  description: string
  status: 'published' | 'building' | 'pending'
  current_stage: string
  published_version?: string
  published_at?: string
  created_at: string
  updated_at: string
}

const statusConfig = {
  published: { label: '已发布', className: 'badgePub' },
  building: { label: '构建中', className: 'badgeBuild' },
  pending: { label: '待启动', className: 'badgePending' },
}

export function ProjectList() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [projectStats, setProjectStats] = useState<Record<string, { classes: number; rels: number; rules: number; actions: number; firstCitizen: string; classIds: string[]; importedClasses: Array<{ name: string; from: string }> }>>({})

  // Modal state
  const [showCreate, setShowCreate] = useState(false)
  const [alertState, setAlertState] = useState<{ message: string; type: 'error' } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    mcpCall<{ projects: Project[] }>('list_projects')
      .then(r => {
        const projects = r.projects ?? []
        setProjects(projects)
        // Fetch stats for each project
        for (const p of projects) {
          mcpCall<{ yaml_content?: string }>('read_full_ontology_yaml', { project_id: p.id })
            .then(result => {
              if (result.yaml_content) {
                import('js-yaml').then(yaml => {
                  try {
                    interface ParsedClass {
                      id: string
                      name?: string
                      first_citizen?: boolean
                      imported_from?: string
                    }
                    interface ParsedOntology {
                      classes?: ParsedClass[]
                      relationships?: unknown[]
                      rules?: unknown[]
                      actions?: unknown[]
                    }
                    const parsed = yaml.load(result.yaml_content!) as ParsedOntology | undefined
                    const classes = parsed?.classes || []
                    const fc = classes.find((c: ParsedClass) => c.first_citizen)
                    const classIds = classes.map((c: ParsedClass) => c.id).filter(Boolean) as string[]
                    const importedClasses: Array<{ name: string; from: string }> = classes
                      .filter((c: ParsedClass) => c.imported_from)
                      .map((c: ParsedClass) => ({ name: c.name || c.id, from: c.imported_from as string }))
                    setProjectStats(prev => ({
                      ...prev,
                      [p.id]: {
                        classes: classes.length,
                        rels: (parsed?.relationships || []).length,
                        rules: (parsed?.rules || []).length,
                        actions: (parsed?.actions || []).length,
                        firstCitizen: fc?.name || '',
                        classIds,
                        importedClasses,
                      }
                    }))
                  } catch { /* ignore parse errors */ }
                })
              }
            })
            .catch(() => {})
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // Cross-ontology shared class detection
  const sharedClassMap: Record<string, string[]> = {}
  for (const [projId, stats] of Object.entries(projectStats)) {
    for (const cls of stats.classIds) {
      // Skip classes that are already imported
      const isImported = stats.importedClasses.some(ic => ic.name === cls)
      if (!isImported) {
        if (!sharedClassMap[cls]) sharedClassMap[cls] = []
        sharedClassMap[cls].push(projId)
      }
    }
  }
  // Only keep classes that appear in multiple projects
  const sharedClasses = Object.entries(sharedClassMap).filter(([, projs]) => projs.length > 1)

  // Build per-project shared class list
  const projectSharedClasses: Record<string, string[]> = {}
  for (const [cls, projs] of sharedClasses) {
    for (const projId of projs) {
      if (!projectSharedClasses[projId]) projectSharedClasses[projId] = []
      projectSharedClasses[projId].push(cls)
    }
  }

  function handleClick(p: Project) {
    if (p.status === 'pending') return
    if (p.status === 'building') {
      navigate(`/project/${p.id}/build`)
    } else {
      navigate(`/project/${p.id}/graph`)
    }
  }

  function handleCreate() {
    setShowCreate(true)
  }

  async function doDeleteProject() {
    if (!deleteConfirm) return
    try {
      await mcpCall('delete_project', { project_id: deleteConfirm.id })
      setProjects(prev => prev.filter(p => p.id !== deleteConfirm.id))
      setDeleteConfirm(null)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setAlertState({ message: '删除失败: ' + msg, type: 'error' })
      setDeleteConfirm(null)
    }
  }

  async function doCreate(name: string) {
    setShowCreate(false)
    try {
      const r = await mcpCall<{ id: string }>('create_project', { name, description: '' })
      navigate(`/project/${r.id}/build`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setAlertState({ message: '创建失败: ' + msg, type: 'error' })
    }
  }

  return (
    <div>
      <div className={styles.header}>
        <h2 className={styles.title}>本体管理</h2>
        <button className={styles.addBtn} onClick={handleCreate} data-testid="create-project-btn">+ 新建本体</button>
      </div>

      {loading && <div className={styles.empty}>加载中…</div>}
      {error && <div className={styles.empty}>加载失败: {error}</div>}

      {!loading && !error && projects.length === 0 && (
        <div className={styles.empty}>暂无项目，点击"+ 新建本体"开始</div>
      )}

      <div className={styles.cards}>
        {projects.map(p => {
          const cfg = statusConfig[p.status] ?? statusConfig.pending
          const stats = projectStats[p.id]
          return (
            <div
              key={p.id}
              className={`${styles.card} ${p.status === 'pending' ? styles.cardDashed : ''}`}
              onClick={() => handleClick(p)}
              data-testid="project-card"
            >
              <button
                className={styles.cardDelete}
                onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ id: p.id, name: p.name }) }}
                title="删除项目"
                data-testid="delete-project-btn"
              >
                ×
              </button>
              <div className={styles.cardTop}>
                <div className={styles.cardLeft}>
                  <div
                    className={styles.iconBox}
                    style={{
                      background: p.status === 'published' ? '#FAECE7' : p.status === 'building' ? '#E1F5EE' : undefined,
                      color: p.status === 'published' ? '#993C1D' : p.status === 'building' ? '#0F6E56' : undefined,
                    }}
                  >
                    <Network size={20} strokeWidth={1.5} />
                  </div>
                  <div>
                    <div className={styles.cardName}>{p.name}</div>
                    <div className={styles.cardDesc}>{p.description || p.current_stage}</div>
                  </div>
                </div>
                <span className={`${styles.badge} ${styles[cfg.className]}`}>
                  {p.published_version ? `${p.published_version} ` : ''}{cfg.label}
                </span>
              </div>

              {stats && (
                <div className={styles.cardStats}>
                  <span>类 {stats.classes}</span>
                  <span>关系 {stats.rels}</span>
                  <span>规则 {stats.rules}</span>
                  <span>动作 {stats.actions}</span>
                </div>
              )}
              {stats?.firstCitizen && (
                <div className={styles.cardTags}>
                  <span className={styles.fcTag}>★ {stats.firstCitizen}</span>
                </div>
              )}
              {stats?.importedClasses && stats.importedClasses.length > 0 && (
                <div className={styles.cardTags}>
                  {stats.importedClasses.map(ic => (
                    <span key={ic.name} className={styles.importTag}>
                      {'<-'} {ic.name} (来自 {ic.from})
                    </span>
                  ))}
                </div>
              )}
              {projectSharedClasses[p.id] && projectSharedClasses[p.id].length > 0 && (
                <div className={styles.sharedHint}>
                  共享类可能: {projectSharedClasses[p.id].join(', ')}
                </div>
              )}

              <div className={styles.cardBottom}>
                <span>阶段：{p.current_stage}</span>
                <span>更新于 {p.updated_at?.slice(0, 10)}</span>
              </div>
            </div>
          )
        })}
      </div>

      <PromptModal
        open={showCreate}
        title="新建本体"
        label="项目名称"
        placeholder="输入本体项目名称"
        confirmText="创建"
        onConfirm={doCreate}
        onCancel={() => setShowCreate(false)}
      />
      <AlertModal
        open={!!alertState}
        message={alertState?.message || ''}
        type={alertState?.type}
        onClose={() => setAlertState(null)}
      />
      <ConfirmModal
        open={!!deleteConfirm}
        title="删除项目"
        message={`确定删除项目"${deleteConfirm?.name}"？此操作不可恢复。`}
        confirmText="确认删除"
        danger
        onConfirm={doDeleteProject}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  )
}
