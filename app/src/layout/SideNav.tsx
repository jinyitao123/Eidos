import { useEffect, useState } from 'react'
import { NavLink, useParams } from 'react-router-dom'
import { FolderOpen, MessageSquare, GitFork, BookOpen, ClipboardCheck, Sliders, Rocket } from 'lucide-react'
import styles from './SideNav.module.css'

async function loadProjectName(projectId: string): Promise<string> {
  try {
    const res = await fetch('/mcp/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'get_project', arguments: { project_id: projectId } },
        id: Date.now(),
      }),
    })
    const json = await res.json()
    const text = json.result?.content?.[0]?.text
    if (text) {
      const parsed = JSON.parse(text)
      return parsed.name || ''
    }
  } catch { /* ignore */ }
  return ''
}

export function SideNav() {
  const { projectId } = useParams()
  const [projectName, setProjectName] = useState('')

  useEffect(() => {
    let cancelled = false
    if (!projectId) {
      // Defer state update to avoid synchronous setState in effect
      Promise.resolve().then(() => { if (!cancelled) setProjectName('') })
    } else {
      loadProjectName(projectId).then(name => {
        if (!cancelled) setProjectName(name)
      })
    }
    return () => { cancelled = true }
  }, [projectId])

  return (
    <nav className={styles.sidenav}>
      <NavLink
        to="/"
        end
        className={({ isActive }) =>
          `${styles.navItem} ${isActive && !projectId ? styles.active : ''}`
        }
      >
        <FolderOpen size={15} /> 项目列表
      </NavLink>

      {projectId && (
        <>
          <div className={styles.divider} />
          <div className={styles.projectName}>{projectName || '当前项目'}</div>
          <NavLink to={`/project/${projectId}/build`} className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}>
            <MessageSquare size={15} /> 构建对话
          </NavLink>
          <NavLink to={`/project/${projectId}/graph`} className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}>
            <GitFork size={15} /> 图谱审核
          </NavLink>
          <NavLink to={`/project/${projectId}/rules`} className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}>
            <BookOpen size={15} /> 规则编辑
          </NavLink>
          <NavLink to={`/project/${projectId}/report`} className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}>
            <ClipboardCheck size={15} /> 审核报告
          </NavLink>
          <NavLink to={`/project/${projectId}/strategy`} className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}>
            <Sliders size={15} /> 策略配置
          </NavLink>
          <NavLink to={`/project/${projectId}/publish`} className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}>
            <Rocket size={15} /> 发布管道
          </NavLink>
        </>
      )}
    </nav>
  )
}
