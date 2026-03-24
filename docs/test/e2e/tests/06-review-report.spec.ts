import { test, expect } from '@playwright/test'
import { createTestProject, deleteTestProject, seedFullOntology, navigateToProject } from './helpers'

test.describe('Page 6: 审查报告', () => {
  let projectId: string

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    projectId = await createTestProject(page, 'ReviewReport测试')
    await seedFullOntology(page, projectId)
    await page.close()
  })

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage()
    await deleteTestProject(page, projectId)
    await page.close()
  })

  test('加载审查报告页面', async ({ page }) => {
    await navigateToProject(page, projectId, 'report')

    // Page title "审核报告" should be visible
    await expect(page.getByRole('heading', { name: '审核报告' })).toBeVisible({ timeout: 10_000 })
  })

  test('显示验证摘要', async ({ page }) => {
    await navigateToProject(page, projectId, 'report')

    // Summary cards show: 通过, 一致性, 完整性, 建议
    await expect(page.getByText('通过').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('一致性').first()).toBeVisible()
    await expect(page.getByText('完整性').first()).toBeVisible()
    await expect(page.getByText('建议').first()).toBeVisible()
  })

  test('显示检查结果（通过项或问题项）', async ({ page }) => {
    await navigateToProject(page, projectId, 'report')

    // The page should load without crashing
    // Wait for summary to appear
    await expect(page.getByText('通过').first()).toBeVisible({ timeout: 10_000 })

    // There should be a "通过项" section
    await expect(page.getByText(/通过项/).first()).toBeVisible({ timeout: 5000 })
  })

  test('底部操作按钮', async ({ page }) => {
    await navigateToProject(page, projectId, 'report')

    // Should show "重新审核" button and a publish/proceed button
    await expect(page.getByRole('button', { name: '重新审核' })).toBeVisible({ timeout: 10_000 })

    // The publish button text depends on whether there are consistency issues
    const publishBtn = page.getByRole('button', { name: /发布|存在阻断/ })
    await expect(publishBtn).toBeVisible()
  })
})
