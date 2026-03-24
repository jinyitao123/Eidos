import { test, expect } from '@playwright/test'
import { createTestProject, deleteTestProject, navigateToProject } from './helpers'

test.describe('Page 2: Agent 构建', () => {
  let projectId: string

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    projectId = await createTestProject(page, 'AgentBuild测试')
    await page.close()
  })

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage()
    await deleteTestProject(page, projectId)
    await page.close()
  })

  test('加载 Agent 构建页面', async ({ page }) => {
    await navigateToProject(page, projectId, 'build')

    // The progress bar has 4 stages (场景分析, 本体架构, 规则设计, 审核)
    // Each stage has a progressStage class and a label
    await expect(page.getByText('场景分析')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('本体架构')).toBeVisible()
  })

  test('显示聊天输入框', async ({ page }) => {
    await navigateToProject(page, projectId, 'build')

    // Chat input has data-testid="chat-input"
    const chatInput = page.getByTestId('chat-input')
    await expect(chatInput).toBeVisible({ timeout: 5000 })
  })

  test('显示阶段进度条', async ({ page }) => {
    await navigateToProject(page, projectId, 'build')

    // Should have 4 stage labels
    const stageLabels = ['场景分析', '本体架构', '规则设计', '审核']
    for (const label of stageLabels) {
      await expect(page.getByText(label, { exact: false }).first()).toBeVisible({ timeout: 5000 })
    }
  })

  test('返回按钮可用', async ({ page }) => {
    await navigateToProject(page, projectId, 'build')

    // Back button shows "← 返回"
    const backBtn = page.getByText('← 返回')
    await expect(backBtn).toBeVisible({ timeout: 5000 })
    await backBtn.click()
    await page.waitForURL('/', { timeout: 5000 })
  })
})
