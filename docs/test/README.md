# Ontology Toolkit 测试用例与测试数据

## 最新修复清单

- `REMEDIATION_NOTES_2026-03-24.md`：本地实测后的待修复/优化项（含优先级、验收标准、回归命令）
- `EXPLORATORY_TEST_REPORT_2026-03-24.md`：探索性测试报告（证据、分级结论、下一轮 charters）

## 目录结构

```
test/
├── yaml/                          # YAML 解析与验证测试数据
│   ├── valid_wrapped.yaml         # 合法：wrapped 格式 (ontology: {...})
│   ├── valid_flat.yaml            # 合法：flat 格式 (顶层 classes, relationships)
│   ├── valid_hybrid.yaml          # 合法：hybrid 格式 (ontology: 元数据 + 顶层数据)
│   ├── valid_minimal.yaml         # 合法：最小有效本体 (1 class, 0 relationships)
│   ├── valid_full_features.yaml   # 合法：完整特性覆盖 (rules, actions, functions, graph_config, connector_hints)
│   ├── invalid_format.yaml        # 非法：格式错误集合 (11 种错误)
│   ├── invalid_semantic.yaml      # 非法：语义错误集合 (7 种错误)
│   └── edge_cases.yaml            # 边界：FlexStrings、自引用、全类型覆盖、特殊字符等
├── pipeline/                      # Pipeline 代码生成测试
│   ├── input_simple.yaml          # 简单本体 (CRM, 2 classes, 1 relationship)
│   ├── input_complex.yaml         # 复杂本体 (学校管理, 6 classes, rules, actions, functions)
│   ├── input_many_to_many.yaml    # 多对多关系 + edge_attributes (社交网络, 自引用 m:n)
│   ├── input_derived_attrs.yaml   # 派生属性公式覆盖 (SUM/AVG/COUNT/DATEDIFF)
│   ├── input_all_types.yaml       # 所有属性类型 + 标记覆盖
│   └── expected/                  # 预期输出 (用于回归测试)
│       ├── simple_pg_schema.sql
│       └── simple_types.ts
├── mcp/                           # MCP 工具测试用例
│   ├── tool_test_cases.json       # 所有 22 个工具的请求/预期响应
│   └── curl_smoke_test.sh         # curl 冒烟测试脚本 (22/24 pass)
├── e2e/                           # 端到端集成测试
│   ├── backend_e2e_test.sh        # 后端 E2E: 完整项目生命周期 (8 个场景, 50+ 断言)
│   ├── playwright.config.ts       # Playwright 前端 E2E 配置
│   ├── package.json               # Playwright 依赖
│   └── tests/                     # Playwright 测试用例
│       ├── helpers.ts             # 辅助函数 (MCP 调用, 数据注入, 导航)
│       ├── 01-project-list.spec.ts     # 项目列表: 创建/删除/导航/统计
│       ├── 02-agent-build.spec.ts      # Agent 构建: 阶段/输入框/进度条
│       ├── 03-graph-review.spec.ts     # 图谱审查: Schema/实例/节点交互/AI
│       ├── 04-class-editor.spec.ts     # 类编辑器: 属性表/拖拽排序/Tab 切换
│       ├── 05-rule-editor.spec.ts      # 规则编辑: 规则列表/操作列表/权限
│       ├── 06-review-report.spec.ts    # 审查报告: 验证摘要/问题分类
│       ├── 07-publish-pipeline.spec.ts # 发布管道: 7步骤/执行/文件预览
│       └── 08-full-workflow.spec.ts    # 全流程: 创建→编辑→发布→清理
└── frontend/                      # 前端手动测试用例
    └── manual_test_checklist.md   # 手动测试清单 (7 页面 + 5 UI 特性, ~100 项)
```

## 快速开始

### 1. 后端 E2E 测试 (无需额外依赖)

```bash
# 前置：Docker Compose 已启动
bash docs/test/e2e/backend_e2e_test.sh
```

覆盖 8 个场景，50+ 断言：
- 工具注册完整性 (22 工具)
- 完整项目生命周期 (创建→4 阶段→验证→Pipeline→输出校验)
- YAML 验证边界 (空/非 YAML/缺字段)
- 阶段输出覆盖与幂等性
- 图谱工具集成 (stats/nodes/neighbors/traverse/shortest_path)
- 跨项目工具
- 错误处理
- 数据清理验证

### 2. 前端 E2E 测试 (Playwright)

```bash
cd docs/test/e2e
npm install
npx playwright install chromium
npx playwright test                 # 无头模式
npx playwright test --headed        # 有头模式 (可观察)
npx playwright test --ui            # 交互式 UI
npx playwright show-report          # 查看 HTML 报告
```

覆盖 8 个测试套件，30+ 测试用例：
- 7 个页面各自的功能测试
- 1 个完整工作流 E2E (创建→浏览所有页面→Pipeline→清理)

### 3. MCP 冒烟测试

```bash
bash docs/test/mcp/curl_smoke_test.sh
```

### 4. Pipeline 回归测试

```bash
cd pipeline && go build -o bin/generate ./cmd/generate

# 全部输入文件生成
for f in ../docs/test/pipeline/input_*.yaml; do
  echo "=== $(basename $f) ==="
  ./bin/generate --from "$f" --output "/tmp/test-$(basename $f .yaml)" 2>&1 | tail -1
done

# 回归比较
diff /tmp/test-input_simple/01_pg_schema.sql ../docs/test/pipeline/expected/simple_pg_schema.sql
diff /tmp/test-input_simple/06_types.ts ../docs/test/pipeline/expected/simple_types.ts
```

### 5. 前端手动测试

参照 `frontend/manual_test_checklist.md` 逐项验证（~100 个检查项）。

## 测试数据场景覆盖

| 场景 | YAML 文件 | 覆盖要点 |
|------|-----------|----------|
| 酒店管理 | yaml/valid_wrapped.yaml | wrapped 格式, derived 属性, 3 classes |
| 物流运输 | yaml/valid_flat.yaml | flat 格式, unit 单位, boolean |
| 餐厅管理 | yaml/valid_hybrid.yaml | hybrid 格式 (Agent 常见输出) |
| 最小本体 | yaml/valid_minimal.yaml | 1 class, 0 relationships |
| 设备维护 | yaml/valid_full_features.yaml | 完整特性: rules/actions/functions/graph_config/connector_hints/edge_attributes/imported_from |
| 格式错误 | yaml/invalid_format.yaml | 11 种错误: 大写 ID、空格、中文、未知类型、空枚举、derived+required 冲突 |
| 语义错误 | yaml/invalid_semantic.yaml | 7 种错误: 缺 first_citizen、幽灵引用、无效触发源 |
| 边界测试 | yaml/edge_cases.yaml | FlexStrings 两种格式、自引用关系、全类型覆盖、20 值枚举 |
| 简单 CRM | pipeline/input_simple.yaml | 回归基线, 2 classes |
| 学校管理 | pipeline/input_complex.yaml | rules+actions+functions+graph_config |
| 社交网络 | pipeline/input_many_to_many.yaml | 3 种 m:n + 自引用 + edge_attributes |
| 库存分析 | pipeline/input_derived_attrs.yaml | SUM/AVG/COUNT/DATEDIFF 公式 |
| 类型覆盖 | pipeline/input_all_types.yaml | 8 种类型 + unique/default/derived/graph_sync |
