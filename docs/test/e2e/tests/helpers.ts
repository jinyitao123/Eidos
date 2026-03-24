import { Page, expect } from '@playwright/test'

/**
 * MCP call helper: send JSON-RPC request to MCP Server
 */
export async function mcpCall(page: Page, toolName: string, args: Record<string, unknown> = {}) {
  const res = await page.request.post('/mcp/', {
    data: {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: toolName, arguments: args },
      id: Date.now(),
    },
  })
  const json = await res.json()
  if (json.error) throw new Error(json.error.message)
  const result = json.result
  if (result?.isError) throw new Error(result.content?.[0]?.text || 'Tool error')
  const text = result?.content?.[0]?.text
  return text ? JSON.parse(text) : {}
}

/**
 * Create a test project and return its ID
 */
export async function createTestProject(page: Page, name = 'E2E测试项目') {
  const data = await mcpCall(page, 'create_project', { name, description: 'Playwright E2E 自动化测试' })
  return data.id as string
}

/**
 * Delete a test project
 */
export async function deleteTestProject(page: Page, projectId: string) {
  try {
    await mcpCall(page, 'delete_project', { project_id: projectId })
  } catch {
    // ignore delete errors
  }
}

/**
 * Seed a full ontology into a project (classes + rules + actions)
 */
export async function seedFullOntology(page: Page, projectId: string) {
  const structureYaml = `classes:
  - id: task
    name: 任务
    first_citizen: true
    phase: alpha
    attributes:
      - id: title
        name: 标题
        type: string
        required: true
        graph_sync: true
      - id: status
        name: 状态
        type: enum
        required: true
        enum_values: [OPEN, IN_PROGRESS, DONE, CANCELLED]
        graph_sync: true
      - id: priority
        name: 优先级
        type: enum
        enum_values: [LOW, MEDIUM, HIGH]
      - id: description
        name: 描述
        type: text
      - id: due_date
        name: 截止日期
        type: date
      - id: created_at
        name: 创建时间
        type: datetime
  - id: assignee
    name: 负责人
    phase: alpha
    attributes:
      - id: name
        name: 姓名
        type: string
        required: true
        graph_sync: true
      - id: email
        name: 邮箱
        type: string
        unique: true
relationships:
  - id: assigned_to
    name: 分配给
    from: task
    to: assignee
    cardinality: many_to_one`

  const rulesYaml = `rules:
  - id: R01
    name: 超期任务提醒
    phase: alpha
    severity: warning
    trigger:
      type: schedule
      source: []
      cron: "0 9 * * *"
    condition:
      entity: task
      expression: "status != 'DONE' AND due_date < NOW()"
    action:
      type: notify
      target: assignee
      message_template: "任务 {{title}} 已超期"
actions:
  - id: A01
    name: 完成任务
    phase: alpha
    params:
      - id: task_id
        name: 任务ID
        type: string
        required: true
    writes:
      - target: task
        operation: update
        set:
          status: "DONE"
    permission:
      roles: [member, admin]`

  await mcpCall(page, 'save_output', {
    project_id: projectId,
    stage: 'scene_analysis',
    content: '场景分析: 任务管理系统',
  })
  await mcpCall(page, 'save_output', {
    project_id: projectId,
    stage: 'ontology_structure',
    content: structureYaml,
  })
  await mcpCall(page, 'save_output', {
    project_id: projectId,
    stage: 'rules_actions',
    content: rulesYaml,
  })
  await mcpCall(page, 'save_output', {
    project_id: projectId,
    stage: 'review_report',
    content: '审查通过，无阻断问题。',
  })
}

/**
 * Wait for text to be visible on the page
 */
export async function waitForContent(page: Page, text: string, timeout = 10_000) {
  await page.getByText(text).first().waitFor({ state: 'visible', timeout })
}

/**
 * Navigate to a project sub-page and wait for load
 */
export async function navigateToProject(page: Page, projectId: string, subpage: string) {
  await page.goto(`/project/${projectId}/${subpage}`)
  await page.waitForLoadState('networkidle')
}

/**
 * Dismiss any overlay/modal that may intercept clicks.
 * Presses Escape and waits briefly.
 */
export async function dismissOverlays(page: Page) {
  try {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  } catch {
    // ignore
  }
}
