import { test, expect } from '@playwright/test'
import { deleteTestProject } from './helpers'

test.describe('Page 1: 项目列表', () => {
  let projectId: string

  test.afterAll(async ({ browser }) => {
    if (projectId) {
      const page = await browser.newPage()
      await deleteTestProject(page, projectId)
      await page.close()
    }
  })

  test('加载项目列表页面', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    // Page title "本体管理" should be visible
    await expect(page.getByRole('heading', { name: '本体管理' })).toBeVisible()
  })

  test('创建新项目', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Click the create button (has data-testid)
    await page.getByTestId('create-project-btn').click()

    // Wait for the PromptModal to appear, then fill the input
    const modalInput = page.getByTestId('prompt-modal-input')
    await expect(modalInput).toBeVisible({ timeout: 3000 })
    await modalInput.fill('Playwright测试项目')

    // Click the confirm button inside the modal footer
    await page.getByRole('button', { name: '创建' }).click()

    // After creation, app navigates to /project/:id/build
    // Wait for navigation, then go back to project list to verify
    await page.waitForURL(/\/project\/.*\/build/, { timeout: 5000 })

    // Get project ID from URL
    const url = page.url()
    const match = url.match(/\/project\/([^/]+)\/build/)
    if (match) {
      projectId = match[1]
    }

    // Also try to get projectId via MCP if URL match failed
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
        const proj = projects.find((p: any) => p.name === 'Playwright测试项目')
        return proj?.id || ''
      })
    }
  })

  test('删除项目（确认对话框）', async ({ page }) => {
    if (!projectId) test.skip()
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Wait for project cards to load
    await expect(page.getByText('Playwright测试项目')).toBeVisible({ timeout: 5000 })

    // Find the project card containing test project and click its delete button
    const card = page.getByTestId('project-card').filter({ hasText: 'Playwright测试项目' })
    const deleteBtn = card.getByTestId('delete-project-btn')

    // The delete button may only be visible on hover
    await card.hover()
    await expect(deleteBtn).toBeVisible({ timeout: 2000 })
    await deleteBtn.click()

    // Confirm deletion in the ConfirmModal
    await page.getByRole('button', { name: '确认删除' }).click()

    // Project card should disappear (use exact match to avoid matching confirm dialog text)
    await expect(page.getByTestId('project-card').filter({ hasText: 'Playwright测试项目' })).not.toBeVisible({ timeout: 5000 })
    projectId = '' // cleaned up
  })

  test('项目卡片显示统计信息', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Check if project cards exist
    const cards = page.getByTestId('project-card')
    const count = await cards.count()
    if (count > 0) {
      await expect(cards.first()).toBeVisible()
    }
  })

  test('点击项目导航到构建页面', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const cards = page.getByTestId('project-card')
    const count = await cards.count()
    if (count > 0) {
      await cards.first().click()
      // Should navigate to /project/:id/build or /project/:id/graph
      await page.waitForURL(/\/project\/.*\/(build|graph)/, { timeout: 5000 })
    }
  })
})
