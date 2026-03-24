import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchOntology, fetchProject } from '../../api/ontology'
import { mcpCall } from '../../api/mcp'
import { weavePost } from '../../api/client'
import type { Ontology, OntologyClass as OntClass, OntologyRelationship } from '../../types/ontology'
import { PromptModal, AlertModal, ConfirmModal, Modal } from '../../components/Modal'
import styles from './GraphReview.module.css'

interface NodePos {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  fx?: number
  fy?: number
}

interface InstanceNode {
  id: string
  label: string
  classId?: string
  properties: Record<string, unknown>
  relationshipCount?: number
}

interface InstanceEdge {
  from: string
  to: string
  type: string
}

interface InstanceNodePos {
  id: string
  label: string
  classId: string
  x: number
  y: number
  vx: number
  vy: number
  fx?: number
  fy?: number
  radius: number
  fill: string
  stroke: string
  isRect: boolean
}

interface InstanceStats {
  total_nodes: number
  total_relationships: number
  by_label: Record<string, number>
}

interface DragLine {
  fromClassId: string
  fromX: number
  fromY: number
  toX: number
  toY: number
}

interface ConnectForm {
  fromClassId: string
  toClassId: string
}

export function GraphReview() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'schema' | 'instance'>('schema')
  const [ontology, setOntology] = useState<Ontology | null>(null)
  const [loading, setLoading] = useState(true)
  const [projectName, setProjectName] = useState('')
  const canvasRef = useRef<HTMLDivElement>(null)

  // Instance view state
  const [instanceStats, setInstanceStats] = useState<InstanceStats | null>(null)
  const [instanceNodes, setInstanceNodes] = useState<InstanceNode[]>([])
  const [instanceEdges, setInstanceEdges] = useState<InstanceEdge[]>([])
  const [instanceLoading, setInstanceLoading] = useState(false)
  const [selectedNode, setSelectedNode] = useState<InstanceNode | null>(null)
  const [instanceError, setInstanceError] = useState('')

  // Instance force simulation
  const instanceNodesRef = useRef<InstanceNodePos[]>([])
  const instanceAnimRef = useRef<number>(0)
  const [instanceNodePositions, setInstanceNodePositions] = useState<InstanceNodePos[]>([])
  const instanceCanvasRef = useRef<HTMLDivElement>(null)
  const [instanceViewBox, setInstanceViewBox] = useState({ x: 0, y: 0, w: 800, h: 480 })

  // Schema view state
  const [selectedClass, setSelectedClass] = useState<string | null>(null)

  // Force simulation state
  const nodesRef = useRef<NodePos[]>([])
  const animRef = useRef<number>(0)
  const [error, setError] = useState('')

  // Modal state
  const [showAddClass, setShowAddClass] = useState(false)
  const [alertMsg, setAlertMsg] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Zoom/pan state
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: 800, h: 480 })
  const [isPanning, setIsPanning] = useState(false)
  const panStart = useRef({ x: 0, y: 0, vx: 0, vy: 0 })
  const [draggingNode, setDraggingNode] = useState<string | null>(null)
  const dragStart = useRef({ x: 0, y: 0, nx: 0, ny: 0 })

  // Node positions for React SVG rendering
  const [nodePositions, setNodePositions] = useState<NodePos[]>([])

  // Edge click popover
  const [edgePopover, setEdgePopover] = useState<{ rel: OntologyRelationship; x: number; y: number } | null>(null)

  // Drag-to-connect state (Feature 2)
  const [dragLine, setDragLine] = useState<DragLine | null>(null)
  const dragLineStart = useRef({ clientX: 0, clientY: 0, moved: false })
  const [connectForm, setConnectForm] = useState<ConnectForm | null>(null)
  const connectNameRef = useRef<HTMLInputElement>(null)
  const connectCardRef = useRef<HTMLSelectElement>(null)

  // AI assistant state (Feature 3)
  const [showAiModal, setShowAiModal] = useState(false)
  const [aiInput, setAiInput] = useState('')
  const [aiResponse, setAiResponse] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  // Wheel zoom (needs passive: false)
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const scale = e.deltaY > 0 ? 1.1 : 0.9
      setViewBox(vb => {
        const cx = vb.x + vb.w / 2
        const cy = vb.y + vb.h / 2
        const nw = Math.max(200, Math.min(3200, vb.w * scale))
        const nh = Math.max(120, Math.min(1920, vb.h * scale))
        return { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh }
      })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  useEffect(() => {
    if (!projectId) return

    fetchProject(projectId).then(p => setProjectName(p.name || '')).catch(() => {})

    // Use fetchOntology which handles both building and published projects
    fetchOntology(projectId)
      .then(o => {
        if (o) setOntology(o)
      })
      .catch(e => setError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false))
  }, [projectId])

  // Save ontology to MCP
  async function saveOntologyToMCP(updated: Ontology) {
    try {
      const { dump } = await import('js-yaml')
      const yamlStr = dump(updated, { lineWidth: 120 })
      await mcpCall('save_output', {
        project_id: projectId,
        stage: 'ontology_structure',
        content: yamlStr,
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setAlertMsg('保存失败: ' + msg)
    }
  }

  // D3-force-like simulation
  const runForceSimulation = useCallback(() => {
    if (!ontology || !canvasRef.current) return
    const el = canvasRef.current
    const classes = ontology.classes || []
    const relationships = ontology.relationships || []
    if (classes.length === 0) return

    const w = el.clientWidth || 800
    const h = el.clientHeight || 480
    const cx = w / 2, cy = h / 2

    // Initialize viewBox based on canvas dimensions
    setViewBox({ x: 0, y: 0, w, h })

    // Initialize positions in a circle
    if (nodesRef.current.length !== classes.length) {
      nodesRef.current = classes.map((c, i) => {
        const angle = (2 * Math.PI * i) / classes.length - Math.PI / 2
        const radius = Math.min(w, h) * 0.3
        return {
          id: c.id,
          x: cx + radius * Math.cos(angle),
          y: cy + radius * Math.sin(angle),
          vx: 0, vy: 0,
        }
      })
    }

    const nodes = nodesRef.current
    const posMap = new Map(nodes.map(n => [n.id, n]))

    // Force simulation parameters
    const alpha = 0.3
    const centerStrength = 0.01
    const repulsionStrength = 2000
    const linkStrength = 0.05
    const linkDistance = 120
    const damping = 0.7

    let iterations = 0
    const maxIterations = 150

    function tick() {
      if (iterations >= maxIterations) {
        setNodePositions([...nodesRef.current])
        return
      }
      iterations++

      // Center force
      for (const n of nodes) {
        if (n.fx !== undefined) continue
        n.vx += (cx - n.x) * centerStrength
        n.vy += (cy - n.y) * centerStrength
      }

      // Repulsion between nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j]
          const dx = b.x - a.x, dy = b.y - a.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const force = repulsionStrength / (dist * dist)
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          if (a.fx === undefined) { a.vx -= fx; a.vy -= fy }
          if (b.fx === undefined) { b.vx += fx; b.vy += fy }
        }
      }

      // Link forces
      for (const rel of relationships) {
        const a = posMap.get(rel.from)
        const b = posMap.get(rel.to)
        if (!a || !b) continue
        const dx = b.x - a.x, dy = b.y - a.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = (dist - linkDistance) * linkStrength
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        if (a.fx === undefined) { a.vx += fx; a.vy += fy }
        if (b.fx === undefined) { b.vx -= fx; b.vy -= fy }
      }

      // Apply velocity and damping
      for (const n of nodes) {
        if (n.fx !== undefined) { n.x = n.fx; n.y = n.fy!; continue }
        n.vx *= damping
        n.vy *= damping
        n.x += n.vx * alpha
        n.y += n.vy * alpha
        // Keep within bounds
        n.x = Math.max(40, Math.min(w - 40, n.x))
        n.y = Math.max(40, Math.min(h - 40, n.y))
      }

      setNodePositions([...nodesRef.current])
      animRef.current = requestAnimationFrame(tick)
    }

    cancelAnimationFrame(animRef.current)
    tick()
  }, [ontology])

  useEffect(() => {
    if (tab === 'schema') {
      runForceSimulation()
    }
    return () => cancelAnimationFrame(animRef.current)
  }, [runForceSimulation, tab])

  // Instance view - load data and build force graph
  useEffect(() => {
    if (tab !== 'instance' || !projectId) return
    setInstanceLoading(true)
    setInstanceError('')
    setInstanceNodes([])
    setInstanceEdges([])
    setSelectedNode(null)

    const loadInstanceData = async () => {
      try {
        // Fetch stats
        const stats = await mcpCall<InstanceStats>('graph_stats', { ontology_id: projectId }).catch(() => null)
        if (stats) setInstanceStats(stats)

        // Fetch first citizen nodes
        if (!ontology) { setInstanceLoading(false); return }
        const fc = ontology.classes.find(c => c.first_citizen)
        if (!fc) { setInstanceLoading(false); return }

        const label = fc.id.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join('')
        const result = await mcpCall<{ nodes: InstanceNode[] }>('graph_query_nodes', {
          project_id: projectId, class_id: fc.id, label, limit: 50,
        }).catch(() => ({ nodes: [] }))

        const nodes = (result.nodes || []).map(n => ({ ...n, classId: fc.id, relationshipCount: 0 }))
        setInstanceNodes(nodes)

        // For each node, try to fetch neighbors to build edges
        const allEdges: InstanceEdge[] = []
        const neighborNodes: InstanceNode[] = []
        const seenIds = new Set(nodes.map(n => n.id))

        for (const node of nodes.slice(0, 10)) {
          try {
            const neighbors = await mcpCall<{ nodes?: InstanceNode[]; edges?: InstanceEdge[] }>(
              'graph_query_neighbors', { project_id: projectId, node_id: node.id, depth: 1 }
            )
            if (neighbors.edges) allEdges.push(...neighbors.edges)
            if (neighbors.nodes) {
              for (const nn of neighbors.nodes) {
                if (!seenIds.has(nn.id)) {
                  seenIds.add(nn.id)
                  neighborNodes.push(nn)
                }
              }
            }
            // Update relationship count
            node.relationshipCount = (neighbors.edges || []).length
          } catch {
            // Neighbor query may fail, continue
          }
        }

        setInstanceNodes(prev => [...prev, ...neighborNodes])
        setInstanceEdges(allEdges)
      } catch (e) {
        setInstanceError(e instanceof Error ? e.message : 'Failed to load instance data')
      } finally {
        setInstanceLoading(false)
      }
    }

    loadInstanceData()
  }, [tab, projectId, ontology])

  // Instance force simulation
  const runInstanceForceSimulation = useCallback(() => {
    if (instanceNodes.length === 0) return
    const el = instanceCanvasRef.current
    const w = el?.clientWidth || 800
    const h = el?.clientHeight || 480
    const cx = w / 2, cy = h / 2

    setInstanceViewBox({ x: 0, y: 0, w, h })

    // Per-class color palette (up to 8 distinct colors)
    const classColors: Record<string, { fill: string; stroke: string }> = {}
    const palette = [
      { fill: '#FAECE7', stroke: '#993C1D' }, // warm red
      { fill: '#E1F5EE', stroke: '#0F6E56' }, // green
      { fill: '#EEEDFE', stroke: '#534AB7' }, // purple
      { fill: '#E3F2FD', stroke: '#1565C0' }, // blue
      { fill: '#FFF8E1', stroke: '#F57F17' }, // amber
      { fill: '#FCE4EC', stroke: '#C62828' }, // pink
      { fill: '#E0F7FA', stroke: '#00838F' }, // cyan
      { fill: '#F3E5F5', stroke: '#7B1FA2' }, // deep purple
    ]
    const allClassIds = [...new Set(instanceNodes.map(n => n.classId || '').filter(Boolean))]
    const fcId = ontology?.classes.find(c => c.first_citizen)?.id
    // First citizen gets palette[0], rest in order
    const sortedClassIds = [
      ...(fcId && allClassIds.includes(fcId) ? [fcId] : []),
      ...allClassIds.filter(id => id !== fcId),
    ]
    sortedClassIds.forEach((cid, i) => {
      classColors[cid] = palette[i % palette.length]
    })

    // Initialize positions
    instanceNodesRef.current = instanceNodes.map((n, i) => {
      const angle = (2 * Math.PI * i) / instanceNodes.length - Math.PI / 2
      const radius = Math.min(w, h) * 0.35
      const relCount = n.relationshipCount || 0
      const nodeRadius = Math.max(20, Math.min(44, 20 + relCount * 3))
      const cid = n.classId || ''
      const isFC = cid === fcId
      const colors = classColors[cid] || palette[0]
      // Use node ID (business key) as label instead of Neo4j label (class name)
      const displayLabel = n.id || n.label || ''
      return {
        id: n.id,
        label: displayLabel,
        classId: cid,
        x: cx + radius * Math.cos(angle) + (Math.random() - 0.5) * 20,
        y: cy + radius * Math.sin(angle) + (Math.random() - 0.5) * 20,
        vx: 0, vy: 0,
        radius: nodeRadius,
        fill: colors.fill,
        stroke: colors.stroke,
        isRect: isFC,
      }
    })

    const nodes = instanceNodesRef.current
    const posMap = new Map(nodes.map(n => [n.id, n]))
    const centerStrength = 0.01
    const repulsionStrength = 1500
    const linkStrength = 0.04
    const linkDistance = 100
    const damping = 0.7
    const alpha = 0.3
    let iterations = 0
    const maxIterations = 120

    function tick() {
      if (iterations >= maxIterations) {
        setInstanceNodePositions([...instanceNodesRef.current])
        return
      }
      iterations++

      for (const n of nodes) {
        if (n.fx !== undefined) continue
        n.vx += (cx - n.x) * centerStrength
        n.vy += (cy - n.y) * centerStrength
      }

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j]
          const dx = b.x - a.x, dy = b.y - a.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const force = repulsionStrength / (dist * dist)
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          if (a.fx === undefined) { a.vx -= fx; a.vy -= fy }
          if (b.fx === undefined) { b.vx += fx; b.vy += fy }
        }
      }

      for (const edge of instanceEdges) {
        const a = posMap.get(edge.from)
        const b = posMap.get(edge.to)
        if (!a || !b) continue
        const dx = b.x - a.x, dy = b.y - a.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = (dist - linkDistance) * linkStrength
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        if (a.fx === undefined) { a.vx += fx; a.vy += fy }
        if (b.fx === undefined) { b.vx -= fx; b.vy -= fy }
      }

      for (const n of nodes) {
        if (n.fx !== undefined) { n.x = n.fx; n.y = n.fy!; continue }
        n.vx *= damping
        n.vy *= damping
        n.x += n.vx * alpha
        n.y += n.vy * alpha
        n.x = Math.max(50, Math.min(w - 50, n.x))
        n.y = Math.max(50, Math.min(h - 50, n.y))
      }

      setInstanceNodePositions([...instanceNodesRef.current])
      instanceAnimRef.current = requestAnimationFrame(tick)
    }

    cancelAnimationFrame(instanceAnimRef.current)
    tick()
  }, [instanceNodes, instanceEdges, ontology])

  useEffect(() => {
    if (tab === 'instance' && instanceNodes.length > 0) {
      runInstanceForceSimulation()
    }
    return () => cancelAnimationFrame(instanceAnimRef.current)
  }, [runInstanceForceSimulation, tab, instanceNodes.length])

  // Mouse event handlers for pan and drag
  function handleNodeMouseDown(e: React.MouseEvent, nodeId: string) {
    e.stopPropagation()
    setDraggingNode(nodeId)
    const svgEl = canvasRef.current?.querySelector('svg')
    if (!svgEl) return
    const node = nodesRef.current.find(n => n.id === nodeId)
    if (node) {
      dragStart.current = { x: e.clientX, y: e.clientY, nx: node.x, ny: node.y }
    }
  }

  function handleSvgMouseDown(e: React.MouseEvent) {
    if (draggingNode) return
    setIsPanning(true)
    panStart.current = { x: e.clientX, y: e.clientY, vx: viewBox.x, vy: viewBox.y }
  }

  function handleSvgMouseMove(e: React.MouseEvent) {
    if (draggingNode) {
      const svgEl = canvasRef.current?.querySelector('svg')
      if (!svgEl) return
      const rect = svgEl.getBoundingClientRect()
      const scaleX = viewBox.w / rect.width
      const scaleY = viewBox.h / rect.height
      const dx = (e.clientX - dragStart.current.x) * scaleX
      const dy = (e.clientY - dragStart.current.y) * scaleY
      const node = nodesRef.current.find(n => n.id === draggingNode)
      if (node) {
        node.x = dragStart.current.nx + dx
        node.y = dragStart.current.ny + dy
        node.fx = node.x
        node.fy = node.y
        setNodePositions([...nodesRef.current])
      }
    } else if (isPanning) {
      const rect = canvasRef.current?.querySelector('svg')?.getBoundingClientRect()
      if (!rect) return
      const scaleX = viewBox.w / rect.width
      const scaleY = viewBox.h / rect.height
      const dx = (e.clientX - panStart.current.x) * scaleX
      const dy = (e.clientY - panStart.current.y) * scaleY
      setViewBox(vb => ({ ...vb, x: panStart.current.vx - dx, y: panStart.current.vy - dy }))
    }
  }

  function handleSvgMouseUp() {
    setDraggingNode(null)
    setIsPanning(false)
  }

  // Edge click
  function handleEdgeClick(rel: OntologyRelationship) {
    setEdgePopover({ rel, x: 0, y: 0 })
  }

  // --- Feature 2: Drag-to-connect ---
  function handleConnectMouseDown(e: React.MouseEvent, nodeId: string) {
    // Record start position to detect drag vs click
    dragLineStart.current = { clientX: e.clientX, clientY: e.clientY, moved: false }
    const node = nodesRef.current.find(n => n.id === nodeId)
    if (!node) return

    const onMove = (me: MouseEvent) => {
      const dx = me.clientX - dragLineStart.current.clientX
      const dy = me.clientY - dragLineStart.current.clientY
      if (!dragLineStart.current.moved && Math.sqrt(dx * dx + dy * dy) < 8) return
      dragLineStart.current.moved = true

      const svgEl = canvasRef.current?.querySelector('svg')
      if (!svgEl) return
      const rect = svgEl.getBoundingClientRect()
      const scaleX = viewBox.w / rect.width
      const scaleY = viewBox.h / rect.height
      const toX = viewBox.x + (me.clientX - rect.left) * scaleX
      const toY = viewBox.y + (me.clientY - rect.top) * scaleY

      setDragLine({
        fromClassId: nodeId,
        fromX: node.x,
        fromY: node.y,
        toX,
        toY,
      })
    }

    const onUp = (me: MouseEvent) => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)

      if (!dragLineStart.current.moved) {
        setDragLine(null)
        return
      }

      // Check if released over another node
      const svgEl = canvasRef.current?.querySelector('svg')
      if (!svgEl) { setDragLine(null); return }
      const rect = svgEl.getBoundingClientRect()
      const scaleX = viewBox.w / rect.width
      const scaleY = viewBox.h / rect.height
      const mx = viewBox.x + (me.clientX - rect.left) * scaleX
      const my = viewBox.y + (me.clientY - rect.top) * scaleY

      // Find target node under cursor
      let targetId: string | null = null
      for (const n of nodesRef.current) {
        if (n.id === nodeId) continue
        const dist = Math.sqrt((mx - n.x) ** 2 + (my - n.y) ** 2)
        if (dist < 35) { targetId = n.id; break }
      }

      setDragLine(null)

      if (targetId) {
        setConnectForm({ fromClassId: nodeId, toClassId: targetId })
      }
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  async function handleConnectConfirm() {
    if (!connectForm || !ontology) return
    const name = connectNameRef.current?.value.trim()
    const cardinality = connectCardRef.current?.value as OntologyRelationship['cardinality'] || 'one_to_many'
    if (!name) { setAlertMsg('请输入关系名称'); return }

    const id = name.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '')
    if (!id) { setAlertMsg('关系ID格式不合法'); return }
    if (ontology.relationships.some(r => r.id === id)) { setAlertMsg('关系ID已存在'); return }

    const newRel: OntologyRelationship = {
      id,
      name,
      from: connectForm.fromClassId,
      to: connectForm.toClassId,
      cardinality,
    }
    const updated = { ...ontology, relationships: [...ontology.relationships, newRel] }
    setOntology(updated)
    setConnectForm(null)
    await saveOntologyToMCP(updated)
    nodesRef.current = []
    runForceSimulation()
  }

  // --- Feature 3: AI assistant ---
  async function handleAiSend() {
    if (!aiInput.trim() || aiLoading) return
    setAiLoading(true)
    setAiResponse('')
    try {
      const { dump } = await import('js-yaml')
      const context = ontology ? dump(ontology, { lineWidth: 120 }).slice(0, 2000) : ''
      const message = aiInput + '\n\n---\nCurrent ontology context:\n' + context

      const result = await weavePost<{ response?: string; message?: string }>('/v1/chat', {
        agent: 'ontology-architect',
        message,
      })
      setAiResponse(result.response || result.message || JSON.stringify(result, null, 2))
    } catch (e) {
      setAiResponse('Error: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setAiLoading(false)
    }
  }

  // Instance node click handler
  function handleInstanceNodeClick(node: InstanceNode) {
    setSelectedNode(prev => prev?.id === node.id ? null : node)
  }

  const classList = ontology?.classes || []
  const relationships = ontology?.relationships || []
  const relCount = relationships.length
  const classes = ontology?.classes || []
  const posMap = new Map(nodePositions.map(n => [n.id, n]))

  return (
    <div style={{ position: 'relative' }}>
      <div className={styles.header}>
        <h2 className={styles.title}>{projectName || '图谱审核'}</h2>
        <div className={styles.actions}>
          <button className={styles.btnSecondary} onClick={() => navigate(`/project/${projectId}/report`)}>审核报告</button>
          <button className={styles.btnPrimary} onClick={() => navigate(`/project/${projectId}/publish`)}>发布</button>
        </div>
      </div>

      <div className={styles.tabs}>
        <button className={`${styles.tab} ${tab === 'schema' ? styles.tabActive : ''}`} onClick={() => setTab('schema')}>结构视图</button>
        <button className={`${styles.tab} ${tab === 'instance' ? styles.tabActive : ''}`} onClick={() => setTab('instance')}>实例视图</button>
      </div>

      {tab === 'schema' && (
        <>
          <div className={styles.graphLayout}>
            {/* Left sidebar: class list */}
            <div className={styles.classSidebar}>
              <div className={styles.sidebarTitle}>类列表</div>
              {classList.map(c => (
                <div key={c.id} className={`${styles.classItem} ${selectedClass === c.id ? styles.classItemActive : ''}`}>
                  <span onClick={() => { setSelectedClass(c.id); setNodePositions([...nodesRef.current]) }}>
                    {c.first_citizen && <span className={styles.star}>★</span>}
                    {c.name}
                  </span>
                  <span className={styles.classCount}>{c.attributes?.length || 0}</span>
                  <button className={styles.classDeleteBtn} onClick={(e) => { e.stopPropagation(); handleDeleteClass(c.id) }} title="删除类">×</button>
                </div>
              ))}
              <div className={styles.sidebarDivider} />
              <div className={styles.classItem} onClick={() => navigate(`/project/${projectId}/rules`)}>
                规则（{ontology?.rules?.length || 0}）
              </div>
              <div className={styles.classItem} onClick={() => navigate(`/project/${projectId}/rules`)}>
                动作（{ontology?.actions?.length || 0}）
              </div>
              <div className={styles.sidebarDivider} />
              <div className={styles.addClassBtn} onClick={handleAddClass}>+ 新增类</div>
            </div>

            {/* Graph canvas */}
            <div className={styles.canvas} ref={canvasRef}>
              {loading && <div className={styles.placeholder}><p>加载中…</p></div>}
              {!loading && error && <div className={styles.placeholder}><p>加载失败: {error}</p></div>}
              {!loading && !error && !ontology && (
                <div className={styles.placeholder}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
                    <circle cx="12" cy="12" r="3"/><circle cx="4" cy="6" r="2"/><circle cx="20" cy="6" r="2"/>
                    <circle cx="4" cy="18" r="2"/><circle cx="20" cy="18" r="2"/>
                    <line x1="6" y1="7" x2="10" y2="10"/><line x1="18" y1="7" x2="14" y2="10"/>
                    <line x1="6" y1="17" x2="10" y2="14"/><line x1="18" y1="17" x2="14" y2="14"/>
                  </svg>
                  <p>暂无本体数据</p>
                  <p className={styles.sub}>请先通过 Agent 构建对话生成本体定义</p>
                </div>
              )}
              {!loading && !error && ontology && nodePositions.length > 0 && (
                <svg
                  width="100%" height="100%"
                  viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
                  onMouseDown={handleSvgMouseDown}
                  onMouseMove={handleSvgMouseMove}
                  onMouseUp={handleSvgMouseUp}
                  onMouseLeave={handleSvgMouseUp}
                  style={{ cursor: isPanning ? 'grabbing' : draggingNode ? 'grabbing' : 'grab' }}
                >
                  <defs>
                    <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="32" refY="3" orient="auto">
                      <polygon points="0 0, 8 3, 0 6" fill="var(--color-border-hover)" />
                    </marker>
                  </defs>
                  {/* Edges */}
                  {relationships.map(r => {
                    const from = posMap.get(r.from)
                    const to = posMap.get(r.to)
                    if (!from || !to) return null
                    const isSelfRef = r.from === r.to
                    if (isSelfRef) {
                      const scx = from.x + 40, scy = from.y - 40
                      return (
                        <g key={r.id} className={styles.edge} onClick={() => handleEdgeClick(r)}>
                          <path d={`M ${from.x + 20} ${from.y - 10} C ${scx + 30} ${scy - 20}, ${scx + 30} ${scy + 40}, ${from.x + 20} ${from.y + 10}`} fill="none" stroke="var(--color-border-hover)" strokeWidth="1.5" strokeDasharray="4 3" />
                          <text x={scx + 20} y={scy + 10} fontSize="10" fill="var(--color-text-tertiary)" textAnchor="middle">{r.name || r.id}</text>
                        </g>
                      )
                    }
                    const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2
                    return (
                      <g key={r.id} className={styles.edge} onClick={() => handleEdgeClick(r)}>
                        <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="var(--color-border-hover)" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
                        <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="transparent" strokeWidth="12" />
                        <text x={mx} y={my - 6} fontSize="10" fill="var(--color-text-tertiary)" textAnchor="middle">{r.name || r.id}</text>
                      </g>
                    )
                  })}
                  {/* Nodes */}
                  {nodePositions.map(p => {
                    const cls = classes.find(c => c.id === p.id)
                    if (!cls) return null
                    const isFC = cls.first_citizen
                    const isEvent = cls.phase === 'beta' || cls.id.includes('snapshot') || cls.id.includes('movement') || cls.id.includes('log')
                    const fill = isFC ? '#FAECE7' : isEvent ? '#EEEDFE' : '#E1F5EE'
                    const stroke = isFC ? '#993C1D' : isEvent ? '#534AB7' : '#0F6E56'
                    const r = isFC ? 30 : 24
                    const attrCount = cls.attributes?.length || 0
                    const isSelected = selectedClass === cls.id
                    return (
                      <g key={cls.id}
                        style={{ cursor: 'pointer' }}
                        onMouseDown={e => {
                          if (e.shiftKey) {
                            e.stopPropagation()
                            handleConnectMouseDown(e, cls.id)
                          } else {
                            handleNodeMouseDown(e, cls.id)
                          }
                        }}
                        onClick={() => { if (!draggingNode) navigate(`/project/${projectId}/class/${cls.id}`) }}
                      >
                        <circle cx={p.x} cy={p.y} r={r} fill={fill} stroke={stroke} strokeWidth={isSelected ? 3 : 1.5} />
                        <text x={p.x} y={p.y + r + 14} textAnchor="middle" fontSize="11" fontWeight="500" fill="var(--color-text-primary)">{cls.name}</text>
                        <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="10" fill={stroke}>{attrCount}</text>
                      </g>
                    )
                  })}
                  {/* Drag-to-connect line */}
                  {dragLine && (
                    <g>
                      <line
                        x1={dragLine.fromX} y1={dragLine.fromY}
                        x2={dragLine.toX} y2={dragLine.toY}
                        className={styles.dragLine}
                      />
                      <polygon
                        points={`${dragLine.toX},${dragLine.toY - 5} ${dragLine.toX + 8},${dragLine.toY} ${dragLine.toX},${dragLine.toY + 5}`}
                        fill="#993C1D"
                        transform={`rotate(${Math.atan2(dragLine.toY - dragLine.fromY, dragLine.toX - dragLine.fromX) * 180 / Math.PI}, ${dragLine.toX}, ${dragLine.toY})`}
                      />
                    </g>
                  )}
                </svg>
              )}
            </div>
          </div>

          <div className={styles.legend}>
            <span className={styles.legendItem}>
              <span className={styles.dot} style={{ background: '#FAECE7', border: '1.5px solid #993C1D' }} />
              第一公民
            </span>
            <span className={styles.legendItem}>
              <span className={styles.dot} style={{ background: '#E1F5EE', border: '1.5px solid #0F6E56' }} />
              核心类
            </span>
            <span className={styles.legendItem}>
              <span className={styles.dot} style={{ background: '#EEEDFE', border: '1.5px solid #534AB7' }} />
              事件/快照类
            </span>
            <span className={styles.legendItem}>
              <span style={{ display: 'inline-block', width: 16, height: 0, borderTop: '1.5px solid var(--color-border-hover)', verticalAlign: 'middle' }} />
              关系
            </span>
          </div>

          {ontology && (
            <div className={styles.statsBar}>
              <span>类 {classList.length}</span>
              <span>关系 {relCount}</span>
              <span>规则 {ontology.rules?.length || 0}</span>
              <span>动作 {ontology.actions?.length || 0}</span>
            </div>
          )}

          <div style={{ position: 'relative' }}>
            <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 8 }}>
              Shift + 拖拽节点可创建关系
            </p>
          </div>
        </>
      )}

      {tab === 'instance' && (
        <div className={styles.instanceView}>
          {/* Stats bar */}
          {instanceStats && (
            <div className={styles.instanceStatsBar}>
              <span className={styles.statItem}>{instanceStats.total_nodes} 节点</span>
              <span className={styles.statItem}>{instanceStats.total_relationships} 关系</span>
              {instanceStats.by_label && Object.entries(instanceStats.by_label).map(([label, count]) => (
                <span key={label} className={styles.statChip}>{label} {count as number}</span>
              ))}
            </div>
          )}

          {instanceLoading ? (
            <div className={styles.placeholder}><p>加载实例数据...</p></div>
          ) : instanceError ? (
            <div className={styles.placeholder}><p>{instanceError}</p></div>
          ) : instanceNodes.length === 0 ? (
            <div className={styles.instanceEmpty}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
                <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
              <p>暂无实例数据</p>
              <p className={styles.sub}>本体发布并同步到 Neo4j 后，此处将显示实际数据节点</p>
            </div>
          ) : (
            <div className={styles.instanceGraphLayout}>
              <div className={styles.instanceGraph} ref={instanceCanvasRef}>
                <svg
                  width="100%" height="100%"
                  viewBox={`${instanceViewBox.x} ${instanceViewBox.y} ${instanceViewBox.w} ${instanceViewBox.h}`}
                  style={{ cursor: 'grab' }}
                >
                  {/* Instance edges */}
                  {instanceEdges.map((edge, i) => {
                    const from = instanceNodePositions.find(n => n.id === edge.from)
                    const to = instanceNodePositions.find(n => n.id === edge.to)
                    if (!from || !to) return null
                    return (
                      <g key={`edge-${i}`}>
                        <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                          stroke="var(--color-border-hover)" strokeWidth="1" opacity="0.5" />
                        {edge.type && (
                          <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 4}
                            fontSize="8" fill="var(--color-text-tertiary)" textAnchor="middle">
                            {edge.type}
                          </text>
                        )}
                      </g>
                    )
                  })}
                  {/* Instance nodes */}
                  {instanceNodePositions.map(p => {
                    const isSelected = selectedNode?.id === p.id
                    const shortLabel = p.label.length > 16 ? p.label.slice(0, 14) + '..' : p.label
                    const classShort = (p.classId || '').split('_').map((w: string) => w[0]?.toUpperCase()).join('')
                    if (p.isRect) {
                      // First citizen: rectangle
                      const hw = Math.max(p.radius, 28)
                      const hh = Math.max(p.radius * 0.7, 18)
                      return (
                        <g key={p.id} style={{ cursor: 'pointer' }} onClick={() => handleInstanceNodeClick(instanceNodes.find(n => n.id === p.id)!)}>
                          <rect x={p.x - hw} y={p.y - hh} width={hw * 2} height={hh * 2}
                            rx={4} fill={p.fill} stroke={p.stroke} strokeWidth={isSelected ? 2.5 : 1.5} />
                          <text x={p.x} y={p.y} textAnchor="middle" fontSize="10" fontWeight="600" fill={p.stroke}>
                            {shortLabel}
                          </text>
                          <text x={p.x} y={p.y + 12} textAnchor="middle" fontSize="8" fill={p.stroke} opacity={0.6}>
                            {classShort}
                          </text>
                        </g>
                      )
                    }
                    return (
                      <g key={p.id} style={{ cursor: 'pointer' }} onClick={() => handleInstanceNodeClick(instanceNodes.find(n => n.id === p.id)!)}>
                        <circle cx={p.x} cy={p.y} r={p.radius} fill={p.fill} stroke={p.stroke} strokeWidth={isSelected ? 2.5 : 1.5} />
                        <text x={p.x} y={p.y} textAnchor="middle" fontSize="10" fontWeight="600" fill={p.stroke}>
                          {shortLabel}
                        </text>
                        <text x={p.x} y={p.y + 12} textAnchor="middle" fontSize="8" fill={p.stroke} opacity={0.6}>
                          {classShort}
                        </text>
                      </g>
                    )
                  })}
                </svg>
              </div>

              {/* Detail panel */}
              {selectedNode && (
                <div className={styles.instanceDetailPanel}>
                  <div className={styles.detailTitle}>{selectedNode.label}</div>
                  <div className={styles.detailId}>{selectedNode.id}</div>
                  {selectedNode.classId && (
                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 8 }}>
                      Class: {selectedNode.classId}
                    </div>
                  )}
                  <div className={styles.detailProps}>
                    {Object.entries(selectedNode.properties || {}).map(([k, v]) => (
                      <div key={k} className={styles.detailRow}>
                        <span className={styles.detailKey}>{k}</span>
                        <span className={styles.detailVal}>{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <PromptModal
        open={showAddClass}
        title="新增类"
        label="类名称"
        placeholder="输入中文类名，如：库存头寸"
        onConfirm={doAddClass}
        onCancel={() => setShowAddClass(false)}
      />
      <AlertModal
        open={!!alertMsg}
        message={alertMsg}
        type="error"
        onClose={() => setAlertMsg('')}
      />
      <ConfirmModal
        open={!!deleteConfirm}
        message={`确定删除类 "${ontology?.classes.find(c => c.id === deleteConfirm)?.name || deleteConfirm}"？`}
        danger
        onConfirm={doDeleteClass}
        onCancel={() => setDeleteConfirm(null)}
      />
      <Modal open={!!edgePopover} title={edgePopover?.rel.name || '关系'} onClose={() => setEdgePopover(null)} width={360}>
        <div style={{ fontSize: 13 }}>
          <div style={{ marginBottom: 8 }}>
            <strong>{ontology?.classes.find(c => c.id === edgePopover?.rel.from)?.name}</strong>
            <span style={{ margin: '0 8px', color: '#8c8a85' }}>-&gt;</span>
            <strong>{ontology?.classes.find(c => c.id === edgePopover?.rel.to)?.name}</strong>
          </div>
          <div style={{ color: '#6b6560', marginBottom: 4 }}>
            多重性: {edgePopover?.rel.cardinality === 'one_to_many' ? '一对多' : edgePopover?.rel.cardinality === 'many_to_one' ? '多对一' : edgePopover?.rel.cardinality === 'many_to_many' ? '多对多' : '一对一'}
          </div>
          {edgePopover?.rel.edge_attributes && edgePopover.rel.edge_attributes.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>边属性:</div>
              {edgePopover.rel.edge_attributes.map(a => (
                <div key={a.id} style={{ color: '#6b6560', fontSize: 12 }}>{a.name} ({a.type})</div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* Connect form modal (Feature 2) */}
      <Modal
        open={!!connectForm}
        title="创建关系"
        onClose={() => setConnectForm(null)}
        width={400}
        footer={
          <>
            <button style={{ padding: '6px 14px', fontSize: 12, border: '0.5px solid var(--color-border-hover)', borderRadius: 'var(--radius-md)', background: 'transparent', cursor: 'pointer' }} onClick={() => setConnectForm(null)}>取消</button>
            <button style={{ padding: '6px 14px', fontSize: 12, border: 'none', borderRadius: 'var(--radius-md)', background: 'var(--color-text-primary)', color: 'var(--color-bg-primary)', cursor: 'pointer' }} onClick={handleConnectConfirm}>确定</button>
          </>
        }
      >
        {connectForm && (
          <div className={styles.connectForm}>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
              {ontology?.classes.find(c => c.id === connectForm.fromClassId)?.name || connectForm.fromClassId}
              {' -> '}
              {ontology?.classes.find(c => c.id === connectForm.toClassId)?.name || connectForm.toClassId}
            </div>
            <div className={styles.connectFormRow}>
              <label>关系名称</label>
              <input ref={connectNameRef} placeholder="如：belongs_to, contains" autoFocus />
            </div>
            <div className={styles.connectFormRow}>
              <label>多重性</label>
              <select ref={connectCardRef} defaultValue="one_to_many">
                <option value="one_to_one">一对一 (one_to_one)</option>
                <option value="one_to_many">一对多 (one_to_many)</option>
                <option value="many_to_one">多对一 (many_to_one)</option>
                <option value="many_to_many">多对多 (many_to_many)</option>
              </select>
            </div>
          </div>
        )}
      </Modal>

      {/* AI assistant modal (Feature 3) */}
      <Modal open={showAiModal} title="AI 辅助编辑" onClose={() => setShowAiModal(false)} width={520}>
        <div className={styles.aiModal}>
          <textarea
            className={styles.aiInput}
            placeholder="输入自然语言指令，例如：为库存头寸类添加一个 location 属性"
            value={aiInput}
            onChange={e => setAiInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAiSend() } }}
          />
          <button className={styles.aiSendBtn} onClick={handleAiSend} disabled={aiLoading || !aiInput.trim()}>
            {aiLoading ? '处理中...' : '发送'}
          </button>
          {aiResponse && (
            <div className={styles.aiResponse}>{aiResponse}</div>
          )}
        </div>
      </Modal>

      {/* AI float button (Feature 3) */}
      <button className={styles.aiFloatBtn} onClick={() => setShowAiModal(true)}>
        AI 辅助
      </button>
    </div>
  )

  function handleAddClass() {
    setShowAddClass(true)
  }

  async function doAddClass(name: string) {
    setShowAddClass(false)
    const id = name.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '')
    if (!id) { setAlertMsg('ID格式不合法，请使用英文或数字命名'); return }
    if (!ontology) return

    const newClass: OntClass = { id, name, attributes: [] }
    const updated = { ...ontology, classes: [...ontology.classes, newClass] }
    setOntology(updated)
    nodesRef.current = [] // Reset force layout
    await saveOntologyToMCP(updated)
    runForceSimulation()
  }

  function handleDeleteClass(classId: string) {
    setDeleteConfirm(classId)
  }

  async function doDeleteClass() {
    if (!deleteConfirm || !ontology) return
    const id = deleteConfirm
    // Check if any relationship references this class
    const refsCount = (ontology.relationships || []).filter(r => r.from === id || r.to === id).length
    if (refsCount > 0) {
      setAlertMsg(`无法删除：有 ${refsCount} 个关系引用了此类，请先删除相关关系`)
      setDeleteConfirm(null)
      return
    }
    const updated = { ...ontology, classes: ontology.classes.filter(c => c.id !== id) }
    setOntology(updated)
    nodesRef.current = []
    setDeleteConfirm(null)
    await saveOntologyToMCP(updated)
    runForceSimulation()
  }
}
