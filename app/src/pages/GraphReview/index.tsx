import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Network } from 'lucide-react'
import { fetchOntology, fetchProject } from '../../api/ontology'
import { mcpCall } from '../../api/mcp'
import { weavePost } from '../../api/client'
import type { Ontology, OntologyClass as OntClass, OntologyRelationship, OntologyMetric } from '../../types/ontology'
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

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const startRad = (startDeg - 90) * Math.PI / 180
  const endRad = (endDeg - 90) * Math.PI / 180
  const x1 = cx + r * Math.cos(startRad)
  const y1 = cy + r * Math.sin(startRad)
  const x2 = cx + r * Math.cos(endRad)
  const y2 = cy + r * Math.sin(endRad)
  const largeArc = endDeg - startDeg > 180 ? 1 : 0
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`
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

  // Metric highlight state
  const [highlightedMetric, setHighlightedMetric] = useState<string | null>(null)
  const highlightedClasses = new Set<string>()
  if (highlightedMetric && ontology?.metrics) {
    const m = ontology.metrics.find(x => x.id === highlightedMetric)
    if (m) for (const e of m.source_entities || []) highlightedClasses.add(e)
  }

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

    // Initialize positions in a circle (re-init if node count or canvas size changed significantly)
    const prevW = nodesRef.current.length > 0 ? Math.max(...nodesRef.current.map(n => n.x)) - Math.min(...nodesRef.current.map(n => n.x)) : 0
    if (nodesRef.current.length !== classes.length || prevW < w * 0.3) {
      nodesRef.current = classes.map((c, i) => {
        const angle = (2 * Math.PI * i) / classes.length - Math.PI / 2
        const radius = Math.min(w, h) * 0.38
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

    // Force simulation parameters - scale with canvas size
    const scale = Math.sqrt(w * h) / 600
    const alpha = 0.3
    const centerStrength = 0.008
    const repulsionStrength = 3000 * scale
    const linkStrength = 0.04
    const linkDistance = 140 * scale
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
      // Delay one frame to ensure fullWidth CSS has applied and canvas has correct dimensions
      const raf = requestAnimationFrame(() => {
        nodesRef.current = [] // Force re-init with correct canvas size
        runForceSimulation()
      })
      return () => { cancelAnimationFrame(raf); cancelAnimationFrame(animRef.current) }
    }
    return () => cancelAnimationFrame(animRef.current)
  }, [runForceSimulation, tab])

  // Instance view - load via graph_traverse for complete graph
  useEffect(() => {
    if (tab !== 'instance' || !projectId || !ontology) return
    setInstanceLoading(true)
    setInstanceError('')
    setInstanceNodes([])
    setInstanceEdges([])
    setSelectedNode(null)

    // Map Neo4j label → ontology class id
    const labelToClassId = new Map<string, string>()
    for (const cls of ontology.classes) {
      const neo4jLabel = cls.id.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join('')
      labelToClassId.set(neo4jLabel, cls.id)
    }

    const loadInstanceData = async () => {
      try {
        const stats = await mcpCall<InstanceStats>('graph_stats', { ontology_id: projectId }).catch(() => null)
        if (stats) setInstanceStats(stats)

        // Get starting nodes from multiple classes to ensure full coverage
        const nodeMap = new Map<string, InstanceNode>()
        const edgeSet = new Set<string>()
        const edges: InstanceEdge[] = []

        type TraversalResult = {
          paths: Array<{ nodes: Array<{ id: string; label: string; properties: Record<string, unknown> }>; relationships: Array<{ from: string; to: string; type: string }> }>
        }

        // Load all nodes from each class, then traverse for edges
        for (const cls of ontology.classes) {
          const neo4jLabel = cls.id.split('_').map((w: string) => w[0].toUpperCase() + w.slice(1)).join('')
          if (!stats?.by_label?.[neo4jLabel]) continue

          const result = await mcpCall<{ nodes: InstanceNode[] }>('graph_query_nodes', {
            project_id: projectId, class_id: cls.id, label: neo4jLabel, limit: 50,
          }).catch(() => ({ nodes: [] }))

          for (const n of result.nodes || []) {
            if (!nodeMap.has(n.id)) {
              nodeMap.set(n.id, {
                id: n.id,
                label: n.label || neo4jLabel,
                classId: labelToClassId.get(n.label || neo4jLabel) || cls.id,
                properties: n.properties,
              })
            }
          }
        }

        // Traverse from a few starting nodes to get edges
        const startNodes = [...nodeMap.values()].filter(n => n.classId === ontology.classes.find(c => c.first_citizen)?.id).slice(0, 5)
        for (const sn of startNodes) {
          const traversal = await mcpCall<TraversalResult>('graph_traverse', {
            start_node_id: sn.id,
            direction: 'both',
            max_hops: 2,
          }).catch(() => ({ paths: [] }))

          for (const path of traversal.paths || []) {
            for (const r of path.relationships || []) {
              const key = `${r.from}-${r.type}-${r.to}`
              if (!edgeSet.has(key)) {
                edgeSet.add(key)
                edges.push({ from: r.from, to: r.to, type: r.type })
              }
            }
          }
        }

        // Count relationships per node
        const relCounts = new Map<string, number>()
        for (const e of edges) {
          relCounts.set(e.from, (relCounts.get(e.from) || 0) + 1)
          relCounts.set(e.to, (relCounts.get(e.to) || 0) + 1)
        }

        const allNodes = [...nodeMap.values()].map(n => ({
          ...n,
          relationshipCount: relCounts.get(n.id) || 0,
        }))

        setInstanceNodes(allNodes)
        setInstanceEdges(edges)
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

    // Only re-initialize if node count changed
    if (instanceNodesRef.current.length === instanceNodes.length) return
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
    const scale = Math.sqrt(w * h) / 600  // scale params with canvas size
    const centerStrength = 0.008
    const repulsionStrength = 3000 * scale
    const linkStrength = 0.03
    const linkDistance = 120 * scale
    const damping = 0.7
    const alpha = 0.3
    let iterations = 0
    const maxIterations = 150

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

  // Build metric/telemetry lookup by class ID
  const metricsByClass = new Map<string, OntologyMetric[]>()
  for (const m of ontology?.metrics || []) {
    for (const classId of m.source_entities || []) {
      const arr = metricsByClass.get(classId) || []
      arr.push(m)
      metricsByClass.set(classId, arr)
    }
  }
  const telemetryByClass = new Map<string, number>()
  for (const t of ontology?.telemetry || []) {
    telemetryByClass.set(t.source_class, (telemetryByClass.get(t.source_class) || 0) + 1)
  }

  return (
    <div style={{ position: 'relative', maxWidth: 'none', margin: 0, height: 'calc(100vh - 52px)', display: 'flex', flexDirection: 'column', marginLeft: -32, marginRight: -32, marginTop: -24, marginBottom: -24, width: 'calc(100% + 64px)' }}>
      <div className={styles.toolbar}>
        <h2 className={styles.toolbarTitle}>{projectName || '图谱审核'}</h2>
        <div className={styles.toolbarTabs}>
          <button className={`${styles.toolbarTab} ${tab === 'schema' ? styles.toolbarTabActive : ''}`} onClick={() => setTab('schema')}>结构视图</button>
        </div>
        <div className={styles.toolbarStats}>
          <span>类 {classList.length}</span>
          <span>关系 {relCount}</span>
          <span>指标 {ontology?.metrics?.length || 0}</span>
          <span>遥测 {ontology?.telemetry?.length || 0}</span>
        </div>
        <div className={styles.toolbarActions}>
          <button className={styles.btnSecondary} onClick={() => navigate(`/project/${projectId}/report`)}>审核报告</button>
          <button className={styles.btnPrimary} onClick={() => navigate(`/project/${projectId}/publish`)}>发布</button>
        </div>
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
              {(ontology?.metrics?.length || 0) > 0 && (
                <>
                  <div className={styles.sidebarDivider} />
                  <div className={styles.sidebarTitle}>指标（{ontology?.metrics?.length}）</div>
                  {ontology?.metrics?.map(m => (
                    <div key={m.id}
                      className={`${styles.classItem} ${highlightedMetric === m.id ? styles.classItemActive : ''}`}
                      onClick={() => setHighlightedMetric(highlightedMetric === m.id ? null : m.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <span className={styles.statusDot} style={{
                        background: m.status === 'implemented' ? '#0F6E56'
                          : m.status === 'designed' ? '#D97706' : '#6b6560'
                      }} />
                      <span style={{ flex: 1 }}>{m.name}</span>
                      <span style={{
                        fontSize: 9, padding: '1px 4px', borderRadius: 3, fontWeight: 600,
                        background: m.kind === 'aggregate' ? '#0a2e1a' : m.kind === 'composite' ? '#1a1a3e' : m.kind === 'classification' ? '#2e1a0a' : '#2a2825',
                        color: m.kind === 'aggregate' ? '#7dd3b8' : m.kind === 'composite' ? '#a0a0e0' : m.kind === 'classification' ? '#e0a060' : '#6b6560',
                      }}>{m.kind === 'aggregate' ? '聚合' : m.kind === 'composite' ? '复合' : m.kind === 'classification' ? '分类' : (m.kind || '?')[0]}</span>
                    </div>
                  ))}
                </>
              )}
              {(ontology?.telemetry?.length || 0) > 0 && (
                <>
                  <div className={styles.sidebarDivider} />
                  <div className={styles.sidebarTitle}>遥测（{ontology?.telemetry?.length}）</div>
                  {ontology?.telemetry?.map(t => (
                    <div key={t.id} className={styles.classItem}>
                      <span className={styles.statusDot} style={{
                        background: t.status === 'implemented' ? '#0F6E56'
                          : t.status === 'designed' ? '#D97706' : '#6b6560'
                      }} />
                      <span style={{ flex: 1 }}>{t.name}</span>
                      <span style={{ fontSize: 9, color: '#6b6560' }}>{t.sampling || ''}{t.unit ? ` ${t.unit}` : ''}</span>
                    </div>
                  ))}
                </>
              )}
              <div className={styles.sidebarDivider} />
              <div className={styles.addClassBtn} onClick={handleAddClass}>+ 新增类</div>

            </div>

            {/* Graph canvas */}
            <div className={styles.canvas} ref={canvasRef}>
              {loading && <div className={styles.placeholder}><p>加载中…</p></div>}
              {!loading && error && <div className={styles.placeholder}><p>加载失败: {error}</p></div>}
              {!loading && !error && !ontology && (
                <div className={styles.placeholder}>
                  <Network size={48} strokeWidth={1} opacity={0.3} />
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
                    const metricCount = metricsByClass.get(cls.id)?.length || 0
                    const telemetryCount = telemetryByClass.get(cls.id) || 0
                    const isSelected = selectedClass === cls.id
                    const isHighlighted = highlightedClasses.has(cls.id)
                    const hasAnnotation = metricCount > 0 || telemetryCount > 0
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
                        <circle cx={p.x} cy={p.y} r={r} fill={fill} stroke={isHighlighted ? '#1A56A0' : stroke} strokeWidth={isSelected || isHighlighted ? 3 : 1.5} />
                        {metricCount > 0 && (
                          <path d={describeArc(p.x, p.y, r + 2, 210, 250)} fill="none" stroke="#1A56A0" strokeWidth="3" strokeLinecap="round" />
                        )}
                        {telemetryCount > 0 && (
                          <path d={describeArc(p.x, p.y, r + 2, 290, 330)} fill="none" stroke="#8B5E0A" strokeWidth="3" strokeLinecap="round" />
                        )}
                        <text x={p.x} y={p.y + r + 14} textAnchor="middle" fontSize="11" fontWeight="500" fill="var(--color-text-primary)">{cls.name}</text>
                        <text x={p.x} y={hasAnnotation ? p.y + 1 : p.y + 4} textAnchor="middle" fontSize="10" fill={stroke}>{attrCount}</text>
                        {hasAnnotation && (
                          <text x={p.x} y={p.y + 11} textAnchor="middle" fontSize="7" fill="var(--color-text-tertiary)">
                            {metricCount > 0 ? `M${metricCount}` : ''}{metricCount > 0 && telemetryCount > 0 ? ' ' : ''}{telemetryCount > 0 ? `T${telemetryCount}` : ''}
                          </text>
                        )}
                        {/* Phase badge */}
                        {cls.phase && cls.phase !== 'alpha' && (
                          <g>
                            <rect x={p.x + r - 8} y={p.y - r - 2} width={20} height={12} rx={3} fill={cls.phase === 'beta' ? '#D97706' : '#6b6560'} />
                            <text x={p.x + r + 2} y={p.y - r + 7} textAnchor="middle" fontSize="7" fontWeight="600" fill="#fff">{cls.phase === 'beta' ? 'β' : 'F'}</text>
                          </g>
                        )}
                        {/* Extends indicator */}
                        {cls.extends && (
                          <text x={p.x - r + 4} y={p.y - r + 8} fontSize="8" fill="#534AB7" title={`extends: ${cls.extends}`}>⬡</text>
                        )}
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
              {/* Legend overlay */}
              <div className={styles.svgLegend}>
                <span className={styles.legendItem}><span className={styles.dot} style={{ background: '#FAECE7', border: '1px solid #993C1D' }} />第一公民</span>
                <span className={styles.legendItem}><span className={styles.dot} style={{ background: '#E1F5EE', border: '1px solid #0F6E56' }} />核心类</span>
                <span className={styles.legendItem}><span className={styles.dot} style={{ background: '#EEEDFE', border: '1px solid #534AB7' }} />事件类</span>
                <span className={styles.legendItem}><span style={{ display: 'inline-block', width: 12, height: 2, background: '#1A56A0', borderRadius: 1 }} />指标</span>
                <span className={styles.legendItem}><span style={{ display: 'inline-block', width: 12, height: 2, background: '#8B5E0A', borderRadius: 1 }} />遥测</span>
                <span className={styles.legendItem}><span style={{ display: 'inline-block', width: 12, height: 10, background: '#D97706', borderRadius: 2, fontSize: 7, color: '#fff', textAlign: 'center', lineHeight: '10px' }}>β</span>beta</span>
              </div>
            </div>
          </div>

        </>
      )}

      {tab === 'instance' && (
        <div className={styles.instanceView}>
          {instanceLoading ? (
            <div className={styles.placeholder}><p>加载实例数据...</p></div>
          ) : instanceError ? (
            <div className={styles.placeholder}><p>{instanceError}</p></div>
          ) : instanceNodes.length === 0 ? (
            <div className={styles.placeholder}>
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
                  {/* Edges with hover labels */}
                  {instanceEdges.map((edge, i) => {
                    const from = instanceNodePositions.find(n => n.id === edge.from)
                    const to = instanceNodePositions.find(n => n.id === edge.to)
                    if (!from || !to) return null
                    const isRelated = selectedNode && (edge.from === selectedNode.id || edge.to === selectedNode.id)
                    const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2
                    return (
                      <g key={`edge-${i}`} className={styles.edge}>
                        <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                          stroke={isRelated ? '#993C1D' : 'var(--color-border-hover)'}
                          strokeWidth={isRelated ? 2 : 1} opacity={selectedNode && !isRelated ? 0.15 : 0.5} />
                        <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="transparent" strokeWidth="10" />
                        {edge.type && (
                          <text x={mx} y={my - 4} fontSize="8" fill="var(--color-text-tertiary)" textAnchor="middle" opacity={isRelated ? 1 : 0.5}>{edge.type}</text>
                        )}
                      </g>
                    )
                  })}
                  {/* Nodes with class coloring */}
                  {instanceNodePositions.map(p => {
                    const isSelected = selectedNode?.id === p.id
                    const isNeighbor = selectedNode && instanceEdges.some(e => (e.from === selectedNode.id && e.to === p.id) || (e.to === selectedNode.id && e.from === p.id))
                    const dimmed = selectedNode && !isSelected && !isNeighbor
                    const node = instanceNodes.find(n => n.id === p.id)
                    const props = node?.properties || {}
                    // Smart label: name > code > sparePartId+warehouseId > id
                    let displayName = (props.name as string) || (props.code as string) || ''
                    if (!displayName && props.sparePartId) {
                      displayName = `${(props.warehouseId as string || '').replace('WH-', '')}·${props.sparePartId}`
                    }
                    if (!displayName) displayName = p.label
                    const shortLabel = displayName.length > 14 ? displayName.slice(0, 12) + '..' : displayName
                    const className = ontology?.classes?.find(c => c.id === p.classId)?.name || p.classId
                    const classAbbr = (className || '').slice(0, 2)
                    if (p.isRect) {
                      const hw = Math.max(p.radius, 28), hh = Math.max(p.radius * 0.65, 16)
                      return (
                        <g key={p.id} style={{ cursor: 'pointer' }} opacity={dimmed ? 0.2 : 1}
                          onClick={() => handleInstanceNodeClick(instanceNodes.find(n => n.id === p.id)!)}>
                          <rect x={p.x - hw} y={p.y - hh} width={hw * 2} height={hh * 2}
                            rx={4} fill={p.fill} stroke={p.stroke} strokeWidth={isSelected ? 3 : 1.5} />
                          <text x={p.x} y={p.y - 1} textAnchor="middle" fontSize="9" fontWeight="600" fill={p.stroke}>{shortLabel}</text>
                          <text x={p.x} y={p.y + 10} textAnchor="middle" fontSize="7" fill={p.stroke} opacity="0.5">{classAbbr}</text>
                        </g>
                      )
                    }
                    return (
                      <g key={p.id} style={{ cursor: 'pointer' }} opacity={dimmed ? 0.2 : 1}
                        onClick={() => handleInstanceNodeClick(instanceNodes.find(n => n.id === p.id)!)}>
                        <circle cx={p.x} cy={p.y} r={p.radius} fill={p.fill} stroke={p.stroke} strokeWidth={isSelected ? 3 : 1.5} />
                        <text x={p.x} y={p.y - 1} textAnchor="middle" fontSize="9" fontWeight="500" fill={p.stroke}>{shortLabel}</text>
                        <text x={p.x} y={p.y + 10} textAnchor="middle" fontSize="7" fill={p.stroke} opacity="0.5">{classAbbr}</text>
                      </g>
                    )
                  })}
                </svg>
                {/* Instance legend */}
                <div className={styles.svgLegend}>
                  {instanceStats && <span style={{ fontWeight: 500 }}>{instanceStats.total_nodes} 节点 · {instanceStats.total_relationships} 关系</span>}
                  {instanceStats?.by_label && Object.entries(instanceStats.by_label).map(([label, count]) => (
                    <span key={label} className={styles.statChip}>{label} {count as number}</span>
                  ))}
                </div>
              </div>

              {/* Detail panel */}
              {selectedNode && (
                <div className={styles.instanceDetailPanel}>
                  <div className={styles.detailTitle}>{(selectedNode.properties?.name as string) || selectedNode.id}</div>
                  <div className={styles.detailId}>{selectedNode.id}</div>
                  {selectedNode.classId && (
                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 8 }}>
                      {ontology?.classes?.find(c => c.id === selectedNode!.classId)?.name || selectedNode.classId}
                    </div>
                  )}
                  {instanceEdges.filter(e => e.from === selectedNode!.id || e.to === selectedNode!.id).length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--color-text-tertiary)', marginBottom: 4 }}>关系</div>
                      {instanceEdges.filter(e => e.from === selectedNode!.id || e.to === selectedNode!.id).map((e, i) => {
                        const other = e.from === selectedNode!.id ? e.to : e.from
                        const dir = e.from === selectedNode!.id ? '→' : '←'
                        return <div key={i} style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 2 }}>{dir} {e.type} {other}</div>
                      })}
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
