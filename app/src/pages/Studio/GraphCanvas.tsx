import type { Ontology, OntologyClass } from '../../types/ontology'
import styles from './Studio.module.css'

// 图谱画布:类按环形布点,关系连边带动词标签;kind 用中性色块、第一公民加描边。
// 纯确定性布局(无依赖),点节点回调可联动右侧卡片。
export function GraphCanvas({ ontology, onPick }: { ontology: Ontology; onPick?: (id: string) => void }) {
  const classes = ontology.classes || []
  const rels = ontology.relationships || []
  const n = classes.length
  if (n === 0) return null

  const W = 760, H = 520, cx = W / 2, cy = H / 2
  const R = Math.min(W, H) / 2 - 90
  const pos: Record<string, { x: number; y: number }> = {}
  classes.forEach((c, i) => {
    // 单节点居中;多节点环形。
    const a = (i / n) * 2 * Math.PI - Math.PI / 2
    pos[c.id] = n === 1 ? { x: cx, y: cy } : { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) }
  })

  return (
    <svg className={styles.graphSvg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--color-text-tertiary)" />
        </marker>
      </defs>
      {/* 边 */}
      {rels.map(r => {
        const a = pos[r.from], b = pos[r.to]
        if (!a || !b) return null
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
        return (
          <g key={r.id}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-border-hover)" strokeWidth={1.5} markerEnd="url(#arrow)" />
            <text x={mx} y={my - 4} className={styles.graphEdgeLabel} textAnchor="middle">{r.name}</text>
          </g>
        )
      })}
      {/* 节点 */}
      {classes.map(c => {
        const p = pos[c.id]
        return (
          <g key={c.id} className={styles.graphNode} onClick={() => onPick?.(c.id)}>
            <circle cx={p.x} cy={p.y} r={34} fill={kindFill(c.kind)}
              stroke={c.first_citizen ? 'var(--color-accent)' : 'var(--color-border-hover)'}
              strokeWidth={c.first_citizen ? 3 : 1} />
            <text x={p.x} y={p.y - 2} textAnchor="middle" className={styles.graphNodeName}>{c.name || c.id}</text>
            <text x={p.x} y={p.y + 12} textAnchor="middle" className={styles.graphNodeKind}>
              {c.first_citizen ? '★' : ''}{kindLabel(c.kind)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function kindFill(kind?: OntologyClass['kind']) {
  switch (kind) {
    case 'person': return 'var(--color-accent-light)'
    case 'event': return 'var(--color-info-tint)'
    case 'thing': return 'var(--color-bg-tertiary)'
    default: return 'var(--color-bg-secondary)'
  }
}
function kindLabel(kind?: OntologyClass['kind']) {
  return kind === 'person' ? '人' : kind === 'event' ? '事' : kind === 'thing' ? '物' : ''
}
