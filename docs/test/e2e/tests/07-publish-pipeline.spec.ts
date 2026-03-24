import { test, expect } from '@playwright/test'
import { createTestProject, deleteTestProject, seedFullOntology, navigateToProject } from './helpers'

test.describe('Page 7: 发布管道', () => {
  let projectId: string

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    projectId = await createTestProject(page, 'Pipeline测试')
    await seedFullOntology(page, projectId)
    await page.close()
  })

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage()
    await deleteTestProject(page, projectId)
    await page.close()
  })

  test('加载发布管道页面', async ({ page }) => {
    await navigateToProject(page, projectId, 'publish')

    // Page title "发布管道" should be visible
    await expect(page.getByRole('heading', { name: '发布管道' })).toBeVisible({ timeout: 5000 })
  })

  test('显示 7 个管道步骤', async ({ page }) => {
    await navigateToProject(page, projectId, 'publish')

    // Each step has data-testid="pipeline-step"
    const steps = page.getByTestId('pipeline-step')
    await expect(steps.first()).toBeVisible({ timeout: 5000 })
    const count = await steps.count()
    expect(count).toBe(7)
  })

  test('步骤显示名称', async ({ page }) => {
    await navigateToProject(page, projectId, 'publish')

    // Verify step names are present
    await expect(page.getByText('PG Schema 生成')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('MCP 工具生成')).toBeVisible()
    await expect(page.getByText('Neo4j Schema 同步')).toBeVisible()
  })

  test('执行管道按钮可点击', async ({ page }) => {
    await navigateToProject(page, projectId, 'publish')

    // Run button has data-testid="run-pipeline-btn"
    const runBtn = page.getByTestId('run-pipeline-btn')
    await expect(runBtn).toBeVisible({ timeout: 5000 })
    await expect(runBtn).toBeEnabled()
  })

  test('执行管道并查看结果', async ({ page }) => {
    test.setTimeout(60_000)
    await navigateToProject(page, projectId, 'publish')

    // Click run pipeline
    const runBtn = page.getByTestId('run-pipeline-btn')
    await expect(runBtn).toBeVisible({ timeout: 5000 })
    await runBtn.click()

    // Wait for at least one step to show "完成" tag
    await expect(page.getByText('完成').first()).toBeVisible({ timeout: 30_000 })
  })

  test('查看生成的文件', async ({ page }) => {
    test.setTimeout(60_000)
    await navigateToProject(page, projectId, 'publish')

    // Run pipeline first
    const runBtn = page.getByTestId('run-pipeline-btn')
    if (await runBtn.isVisible()) {
      await runBtn.click()
      // Wait for pipeline to finish
      await expect(page.getByText('完成').first()).toBeVisible({ timeout: 30_000 })
    }

    // If there are "查看文件" buttons, click the first one
    const viewBtn = page.getByTestId('view-files-btn').first()
    if (await viewBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await viewBtn.click()

      // File viewer modal should appear with code content
      const modal = page.locator('pre').first()
      await expect(modal).toBeVisible({ timeout: 5000 })
    }
  })
})
