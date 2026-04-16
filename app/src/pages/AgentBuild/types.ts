export interface ToolStatus {
  name: string
  label: string
  status: 'running' | 'done' | 'error'
}

export interface StepProgress {
  label: string
  detail?: string
  status: 'pending' | 'running' | 'done' | 'error'
}

export interface ChatMessage {
  role: 'user' | 'agent'
  agentId?: string
  agentName?: string
  content: string
  timestamp: string
  stageId?: string
  fullContent?: string
  toolCalls?: ToolStatus[]
  steps?: StepProgress[]
  round?: number
}

export interface DocInfo {
  id: string
  name: string
  analyzed: boolean
}

export interface StageInfo {
  id: string
  name: string
  agent: string
  color: string
}

export interface BuildState {
  stageVersions: number[]
  stageDirty: boolean[]
  currentStage: number
  currentRound: number
  documents: DocInfo[]
  sending: boolean
}
