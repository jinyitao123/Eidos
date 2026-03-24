# 测试后待修复与优化清单（2026-03-24）

## 背景

本清单基于以下实测结果整理：

- `bash docs/test/e2e/backend_e2e_test.sh`：60/60 通过
- `bash docs/test/mcp/curl_smoke_test.sh`：23/24 通过（`graph_aggregate` 失败）
- `cd docs/test/e2e && E2E_BASE_URL=http://localhost:8089 npm run test`：28 passed / 8 failed / 1 skipped
- Playwright MCP 真实浏览器访问 `http://localhost:8089/` 复核关键路径（创建项目、进入构建页、图谱交互、类编辑页、审核报告、发布页）

---

## P0（阻断发布/核心能力）

### 1) 发布页 Pipeline 在特定项目上执行失败（YAML 重复键）

- 现象：发布页执行后 7 步全部失败，错误包含 `parse yaml: yaml: unmarshal errors`，提示 `id/name` 重复定义。
- 影响：该项目无法发布，属于真实阻断问题。
- 建议修复：
  - 在发布前增加 YAML 重复键检测（明确定位到行号和键名）。
  - 在 `save_output` 合并阶段对重复键做防御（拒绝保存并返回友好错误）。
  - 在发布页错误弹层增加“可操作修复提示”（跳转到来源阶段或 YAML 片段）。
- 验收标准：
  - 重复键 YAML 在发布前被阻断，且提示精确到键与位置。
  - 修复后同项目可成功跑完 7 步 pipeline。

### 2) MCP `graph_aggregate` 工具语法错误

- 现象：`curl_smoke_test.sh` 中 `graph_aggregate` 失败，报 Neo4j Cypher 语法错误（`Invalid input ')'`）。
- 影响：图聚合分析能力不可用，影响图谱分析场景。
- 建议修复：
  - 复核 `graph_aggregate` 的 Cypher 组装逻辑和空条件分支。
  - 为工具增加最小可用参数集的单元级回归（成功 + 空参数 + 边界参数）。
  - 将 `docs/test/mcp/curl_smoke_test.sh` 里的该用例作为回归门禁。
- 验收标准：
  - `graph_aggregate` 在默认与典型参数下返回成功。
  - MCP 冒烟脚本恢复 24/24 通过。

---

## P1（高优先：测试可靠性/工程质量）

### 3) 前端 Playwright 用例与当前 UI 结构漂移（8 个失败）

- 现象聚类：
  - 选择器过脆：`input[type="text"]` 在弹层里不可稳定命中。
  - strict mode 多匹配：广泛 class 模糊匹配导致非唯一定位。
  - 点击被遮罩拦截：弹层/overlay 存在时触发误失败。
- 结论：多数失败更像测试代码问题，而非功能缺陷（已由真实浏览器复核关键流程）。
- 建议修复：
  - 统一改为语义化定位（`getByRole`/`getByLabel`/`getByText` + 精确范围）。
  - 为关键元素补充稳定 `data-testid`（仅测试关键控件）。
  - 增加等待条件：overlay 消失、按钮可交互、页面加载稳定。
  - 将失败用例拆分为“页面渲染断言”和“交互断言”，降低耦合。
- 验收标准：
  - `docs/test/e2e` 全量回归通过，且重复执行稳定（至少连续 2 次）。

### 4) 前端 lint 未通过（5 errors, 2 warnings）

- 现象：
  - `app/src/pages/ProjectList/index.tsx` 存在 `@typescript-eslint/no-explicit-any` 错误。
  - `app/src/pages/AgentBuild/index.tsx`、`app/src/pages/ReviewReport/index.tsx` 有 `react-hooks/exhaustive-deps` 警告。
- 影响：质量门禁不完整，降低长期可维护性。
- 建议修复：
  - 用精确类型替代 `any`（优先项目卡片和统计结构）。
  - 修复 hooks 依赖声明或显式解释稳定依赖来源。
- 验收标准：
  - `cd app && npm run lint` 零 error（warning 可按策略逐步清零）。

---

## P2（优化项）

### 5) 构建与文档口径一致性

- 现象：项目文档中部分“测试现状/通过率”描述已过期（例如历史通过率数字）。
- 建议优化：
  - 将测试结果沉淀到固定文件（本文件）并在 `docs/test/README.md` 增加“最新测试快照”链接。
  - 每次回归后更新日期与摘要，避免口径漂移。
- 验收标准：
  - `docs/test/README.md` 可快速跳转到最新修复清单和结果摘要。

---

## 建议执行顺序

1. 修复 P0-1（发布阻断）
2. 修复 P0-2（graph_aggregate）
3. 修复 P1-3（Playwright 稳定性）
4. 修复 P1-4（lint）
5. 更新文档与回归记录（P2）

---

## 回归命令（修复后统一执行）

```bash
bash docs/test/mcp/curl_smoke_test.sh
bash docs/test/e2e/backend_e2e_test.sh
cd app && npm run lint && npm run build
cd docs/test/e2e && E2E_BASE_URL=http://localhost:8089 npm run test
```
