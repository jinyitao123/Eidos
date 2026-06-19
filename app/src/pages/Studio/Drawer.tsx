import { useEffect, useState } from 'react'
import { fetchVersions } from '../../api/rest'
import { mcpCall, mcpCallText } from '../../api/mcp'
import type { VersionMeta } from '../../types/ontology'
import styles from './Studio.module.css'

export type DrawerKind = 'versions' | 'inheritance' | null

export function Drawer({ kind, id, onClose, onChanged }: {
  kind: DrawerKind; id: string; onClose: () => void; onChanged: () => void
}) {
  if (!kind) return null
  return (
    <>
      <div className={styles.drawerMask} onClick={onClose} />
      <div className={styles.drawer}>
        <div className={styles.drawerHead}>
          <span className={styles.drawerTitle}>{kind === 'versions' ? '版本历史' : '继承详情'}</span>
          <button className={styles.drawerClose} onClick={onClose}>×</button>
        </div>
        <div className={styles.drawerBody}>
          {kind === 'versions'
            ? <Versions id={id} onChanged={onChanged} />
            : <Inheritance id={id} />}
        </div>
      </div>
    </>
  )
}

function Versions({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [vs, setVs] = useState<VersionMeta[]>([])
  const [msg, setMsg] = useState('加载中…')

  function load() {
    fetchVersions(id)
      .then(v => { setVs(v); setMsg(v.length ? '' : '还没有版本记录。') })
      .catch(e => setMsg(e.message))
  }
  useEffect(load, [id])

  async function restore(version: number) {
    try { await mcpCall('restore_ontology_version', { id, version }); load(); onChanged() }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
  }
  async function publish() {
    try { await mcpCall('publish_ontology_doc', { id }); load(); onChanged() }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
  }

  return (
    <div>
      <button className={styles.publishBtn} onClick={publish}>发布 Release</button>
      {msg && <div className={styles.relHint}>{msg}</div>}
      {vs.map(v => (
        <div key={v.version} className={styles.verRow}>
          <div className={styles.verTop}>
            <span className={styles.verNum}>v{v.version}</span>
            <span className={`${styles.verKind} ${styles[`verKind_${v.kind}`]}`}>{v.kind}</span>
            <span className={styles.verMeta}>{v.source} · {new Date(v.created_at).toLocaleString()}</span>
          </div>
          <button className={styles.restoreLink} onClick={() => restore(v.version)}>回到此版本</button>
        </div>
      ))}
    </div>
  )
}

function Inheritance({ id }: { id: string }) {
  const [text, setText] = useState('加载中…')
  useEffect(() => {
    mcpCallText('get_inheritance', { id }).then(t => setText(t || '无继承信息。')).catch(e => setText(e.message))
  }, [id])
  return <div className={styles.inheritPre}>{text}</div>
}
