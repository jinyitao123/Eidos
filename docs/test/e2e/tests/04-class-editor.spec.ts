import { test, expect } from '@playwright/test'
import { createTestProject, deleteTestProject, seedFullOntology, navigateToProject } from './helpers'

test.describe('Page 4: 类编辑器', () => {
  let projectId: string

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    projectId = await createTestProject(page, 'ClassEditor测试')
    await seedFullOntology(page, projectId)
    await page.close()
  })

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage()
    await deleteTestProject(page, projectId)
    await page.close()
  })

  test('加载类编辑页面', async ({ page }) => {
    await navigateToProject(page, projectId, 'class/task')

    // Class name heading "任务" should be visible
    await expect(page.getByRole('heading', { name: '任务' })).toBeVisible({ timeout: 5000 })
  })

  test('显示属性表格', async ({ page }) => {
    await navigateToProject(page, projectId, 'class/task')

    // The attribute table should be visible
    const table = page.locator('table').first()
    await expect(table).toBeVisible({ timeout: 5000 })

    // Should have header columns: 属性名, ID, 类型, 必填, 图谱, 派生/默认
    await expect(table.getByText('属性名')).toBeVisible()
    await expect(table.getByText('类型', { exact: true }).first()).toBeVisible()

    // Should have attribute rows (title, status, priority, etc.)
    const rows = table.locator('tbody tr')
    const count = await rows.count()
    expect(count).toBeGreaterThanOrEqual(3)
  })

  test('属性显示类型标签', async ({ page }) => {
    await navigateToProject(page, projectId, 'class/task')

    // Type chips should show types like string, enum, text, date, datetime
    const table = page.locator('table').first()
    await expect(table).toBeVisible({ timeout: 5000 })

    // Look for type chip elements showing attribute types
    await expect(table.getByText('string').first()).toBeVisible()
    await expect(table.getByText('enum').first()).toBeVisible()
  })

  test('拖拽排序手柄可见', async ({ page }) => {
    await navigateToProject(page, projectId, 'class/task')

    // Table rows are draggable (draggable attribute)
    const table = page.locator('table').first()
    await expect(table).toBeVisible({ timeout: 5000 })

    const draggableRows = table.locator('tbody tr[draggable="true"]')
    const count = await draggableRows.count()
    expect(count).toBeGreaterThan(0)
  })

  test('Tab 切换 - 属性/关系/被引用', async ({ page }) => {
    await navigateToProject(page, projectId, 'class/task')

    // Three tabs: 属性, 关系, 被引用
    const attrTab = page.getByRole('button', { name: /属性/ })
    const relTab = page.getByRole('button', { name: /关系/ })
    const refTab = page.getByRole('button', { name: /被引用/ })

    await expect(attrTab).toBeVisible({ timeout: 5000 })
    await expect(relTab).toBeVisible()
    await expect(refTab).toBeVisible()

    // Click relationships tab
    await relTab.click()
    await page.waitForTimeout(300)

    // Should show the "assigned_to" relationship (task -> assignee)
    await expect(page.getByText('分配给').first()).toBeVisible({ timeout: 3000 })
  })

  test('返回导航', async ({ page }) => {
    await navigateToProject(page, projectId, 'class/task')

    // Back button "← 返回图谱视图"
    const backBtn = page.getByText('← 返回图谱视图')
    await expect(backBtn).toBeVisible({ timeout: 5000 })
    await backBtn.click()
    await page.waitForURL(/\/project\/.*\/graph/, { timeout: 5000 })
  })
})
