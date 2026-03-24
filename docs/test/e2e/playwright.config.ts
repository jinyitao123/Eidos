import { defineConfig, devices } from '@playwright/test'

/**
 * Ontology Toolkit 前端 E2E 测试配置
 *
 * 运行方式:
 *   cd docs/test/e2e
 *   npx playwright install
 *   npx playwright test
 *
 * 前置条件:
 *   - Docker Compose 已启动 (Weave API, MCP Server, Neo4j, PG)
 *   - 前端已构建并通过 nginx 在 :8089 提供服务 (或 dev server :5180)
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // 页面间有顺序依赖
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'html',
  timeout: 30_000,

  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:8089',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
