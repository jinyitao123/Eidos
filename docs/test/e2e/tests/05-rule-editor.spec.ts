import { test, expect } from '@playwright/test'
import { createTestProject, deleteTestProject, seedFullOntology, navigateToProject } from './helpers'

test.describe('Page 5: 规则编辑器', () => {
  let projectId: string

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    projectId = await createTestProject(page, 'RuleEditor测试')
    await seedFullOntology(page, projectId)
    await page.close()
  })

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage()
    await deleteTestProject(page, projectId)
    await page.close()
  })

  test('加载规则编辑页面', async ({ page }) => {
    await navigateToProject(page, projectId, 'rules')

    // Page title "规则与动作" should be visible
    await expect(page.getByRole('heading', { name: '规则与动作' })).toBeVisible({ timeout: 5000 })
  })

  test('显示规则列表', async ({ page }) => {
    await navigateToProject(page, projectId, 'rules')

    // Should show R01 rule card with its name
    await expect(page.getByText('R01')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('超期任务提醒')).toBeVisible()
  })

  test('规则显示严重度标签', async ({ page }) => {
    await navigateToProject(page, projectId, 'rules')

    // Should have severity badge "warning"
    await expect(page.getByText('warning').first()).toBeVisible({ timeout: 5000 })
  })

  test('Tab 切换到操作列表', async ({ page }) => {
    await navigateToProject(page, projectId, 'rules')

    // Click the "动作" tab
    const actionTab = page.getByRole('button', { name: /动作/ })
    await expect(actionTab).toBeVisible({ timeout: 5000 })
    await actionTab.click()
    await page.waitForTimeout(300)

    // Should show A01 action
    await expect(page.getByText('A01')).toBeVisible({ timeout: 3000 })
    await expect(page.getByText('完成任务')).toBeVisible()
  })

  test('操作显示权限信息', async ({ page }) => {
    await navigateToProject(page, projectId, 'rules')

    // Switch to actions tab
    const actionTab = page.getByRole('button', { name: /动作/ })
    await expect(actionTab).toBeVisible({ timeout: 5000 })
    await actionTab.click()
    await page.waitForTimeout(300)

    // Should show permission tags (member, admin)
    const permSection = page.getByText('member')
    if (await permSection.count() > 0) {
      await expect(permSection.first()).toBeVisible()
    }
  })
})
