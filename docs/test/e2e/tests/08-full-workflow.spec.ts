import { test, expect } from '@playwright/test'
import { mcpCall } from './helpers'

/**
 * Full end-to-end workflow test
 * Simulates: create project -> browse pages -> execute pipeline -> cleanup
 */
test.describe('E2E 完整工作流', () => {
  let projectId: string

  test('完整流程：创建 → 编辑 → 发布 → 清理', async ({ page }) => {
    test.setTimeout(120_000)

    // ===== Step 1: Create project from project list =====
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await page.getByTestId('create-project-btn').click()

    // Fill in the project name in the PromptModal
    const modalInput = page.getByTestId('prompt-modal-input')
    await expect(modalInput).toBeVisible({ timeout: 3000 })
    await modalInput.fill('E2E全流程测试')

    // Confirm creation
    await page.getByRole('button', { name: '创建' }).click()

    // Wait for navigation to build page
    await page.waitForURL(/\/project\/.*\/build/, { timeout: 5000 })

    // Extract project ID from URL
    const url = page.url()
    const match = url.match(/\/project\/([^/]+)\/build/)
    projectId = match?.[1] || ''

    // Fallback: get projectId via MCP
    if (!projectId) {
      projectId = await page.evaluate(async () => {
        const res = await fetch('/mcp/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'tools/call',
            params: { name: 'list_projects', arguments: {} },
          }),
        })
        const json = await res.json()
        const text = json.result.content[0].text
        const data = JSON.parse(text)
        const projects = data.projects || data
        const proj = projects.find((p: any) => p.name === 'E2E全流程测试')
        return proj?.id || ''
      })
    }

    expect(projectId).toBeTruthy()

    // ===== Step 2: Inject test ontology data via MCP =====
    await mcpCall(page, 'save_output', {
      project_id: projectId,
      stage: 'scene_analysis',
      content: '测试场景分析',
    })

    const ontologyYaml = `classes:
  - id: widget
    name: 组件
    first_citizen: true
    phase: alpha
    attributes:
      - id: name
        name: 名称
        type: string
        required: true
        graph_sync: true
      - id: widget_type
        name: 类型
        type: enum
        required: true
        enum_values: [BUTTON, INPUT, CARD, TABLE]
        graph_sync: true
      - id: is_active
        name: 是否启用
        type: boolean
        default: true
      - id: created_at
        name: 创建时间
        type: datetime
  - id: page_layout
    name: 页面布局
    phase: alpha
    attributes:
      - id: title
        name: 标题
        type: string
        required: true
      - id: route
        name: 路由
        type: string
        unique: true
relationships:
  - id: placed_on
    name: 放置于
    from: widget
    to: page_layout
    cardinality: many_to_one`

    await mcpCall(page, 'save_output', {
      project_id: projectId,
      stage: 'ontology_structure',
      content: ontologyYaml,
    })

    await mcpCall(page, 'save_output', {
      project_id: projectId,
      stage: 'rules_actions',
      content: 'rules: []\nactions: []',
    })

    await mcpCall(page, 'save_output', {
      project_id: projectId,
      stage: 'review_report',
      content: '审查通过',
    })

    // ===== Step 3: Browse Agent Build page =====
    await page.goto(`/project/${projectId}/build`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('场景分析').first()).toBeVisible({ timeout: 5000 })

    // ===== Step 4: Browse Graph Review page =====
    await page.goto(`/project/${projectId}/graph`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    await expect(page.locator('svg').first()).toBeVisible({ timeout: 10_000 })

    // ===== Step 5: Browse Class Editor page =====
    await page.goto(`/project/${projectId}/class/widget`)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('table').first()).toBeVisible({ timeout: 5000 })

    // ===== Step 6: Browse Rule Editor page =====
    await page.goto(`/project/${projectId}/rules`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: '规则与动作' })).toBeVisible({ timeout: 5000 })

    // ===== Step 7: Browse Review Report page =====
    await page.goto(`/project/${projectId}/report`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: '审核报告' })).toBeVisible({ timeout: 10_000 })

    // ===== Step 8: Publish Pipeline page =====
    await page.goto(`/project/${projectId}/publish`)
    await page.waitForLoadState('networkidle')

    // Should have 7 steps
    const steps = page.getByTestId('pipeline-step')
    await expect(steps.first()).toBeVisible({ timeout: 5000 })
    const stepCount = await steps.count()
    expect(stepCount).toBe(7)

    // Run pipeline if button is visible
    const runBtn = page.getByTestId('run-pipeline-btn')
    if (await runBtn.isVisible()) {
      await runBtn.click()
      // Wait for completion
      await expect(page.getByText('完成').first()).toBeVisible({ timeout: 30_000 })
    }

    // ===== Step 9: Return to project list and confirm project exists =====
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('E2E全流程测试')).toBeVisible({ timeout: 5000 })
  })

  test.afterAll(async ({ browser }) => {
    if (projectId) {
      const page = await browser.newPage()
      try {
        await mcpCall(page, 'delete_project', { project_id: projectId })
      } catch { /* ignore */ }
      await page.close()
    }
  })
})
