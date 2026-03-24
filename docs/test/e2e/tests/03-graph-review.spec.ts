import { test, expect } from '@playwright/test'
import { createTestProject, deleteTestProject, seedFullOntology, navigateToProject } from './helpers'

test.describe('Page 3: 图谱审查', () => {
  let projectId: string

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    projectId = await createTestProject(page, 'GraphReview测试')
    await seedFullOntology(page, projectId)
    await page.close()
  })

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage()
    await deleteTestProject(page, projectId)
    await page.close()
  })

  test('加载 Schema 视图', async ({ page }) => {
    await navigateToProject(page, projectId, 'graph')

    // The graph canvas should have an SVG element rendered by the force simulation
    const svg = page.locator('svg').first()
    await expect(svg).toBeVisible({ timeout: 10_000 })
  })

  test('Schema 视图显示类节点', async ({ page }) => {
    await navigateToProject(page, projectId, 'graph')
    // Wait for force simulation to settle
    await page.waitForTimeout(2000)

    // SVG should have text labels for class names
    const texts = page.locator('svg text')
    const count = await texts.count()
    expect(count).toBeGreaterThan(0)
  })

  test('Tab 切换到实例视图', async ({ page }) => {
    await navigateToProject(page, projectId, 'graph')

    // The tabs are buttons with text "结构视图" and "实例视图"
    const instanceTab = page.getByRole('button', { name: '实例视图' })
    await expect(instanceTab).toBeVisible({ timeout: 5000 })
    await instanceTab.click()
    await page.waitForTimeout(2000)

    // Instance view may show stats or empty state - just verify no crash
    // The tab should now be active
    await expect(instanceTab).toBeVisible()
  })

  test('侧边栏类列表', async ({ page }) => {
    await navigateToProject(page, projectId, 'graph')

    // Sidebar shows "类列表" title and class names
    await expect(page.getByText('类列表')).toBeVisible({ timeout: 5000 })

    // Should show the seeded class names (任务, 负责人)
    await expect(page.getByText('任务').first()).toBeVisible()
    await expect(page.getByText('负责人').first()).toBeVisible()
  })

  test('底部统计栏', async ({ page }) => {
    await navigateToProject(page, projectId, 'graph')

    // Stats bar shows class count, relationship count, etc.
    await expect(page.getByText(/类 \d+/).first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(/关系 \d+/).first()).toBeVisible()
  })
})
