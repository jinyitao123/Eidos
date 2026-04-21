# S2 任务拆分实现方案

> 补充 `03-agent-definitions.md` 的 S2 章节。文档描述 **当前实际运行** 的 S2 多轮编排机制，不是设计愿景。

## 背景

S2（ontology-architect）最初设计为"一轮生成完整本体结构"，实际运行暴露出三个问题：

1. **LLM 超时**：DeepSeek 单次生成 classes + relationships + metrics + telemetry 完整 YAML 需 5-10 分钟，后端 HTTP client 超时（120s）或 SSE 断流。
2. **内容缺失**：长 prompt 下 LLM 常跳过 metrics/telemetry（输出末尾）或简化 classes 属性。
3. **难以增量修改**：一次性生成无法针对单一模块（如只改 metrics）做定向更新。

解决方案：把 S2 拆分为 **3 轮 silent 子调用**，前端编排、同一 agent session、渐进累积 YAML。

## 核心机制

### 分轮切分

| 轮次 | 产出 | 输入依赖 | UI 状态标签 |
|------|------|---------|------------|
| Round 1 | `classes` + `relationships` | `read_scene_analysis` | 类与关系设计 |
| Round 2 | Round 1 输出 + `metrics` | `read_ontology_structure` | 指标设计 |
| Round 3 | Round 1+2 输出 + `telemetry` | `read_ontology_structure` | 遥测设计 |

每轮独立 `save_output(stage="ontology_structure", content=完整YAML)`——不是 patch，是**完整覆盖**。

### 编排位置

前端编排，不在 agent 里面做：

- `app/src/pages/AgentBuild/stages.ts:getS2Prompts()` — 生成三轮 prompt
- `app/src/pages/AgentBuild/index.tsx:runS2MultiStep()` — 依次发起调用
- agent 配置无需知道有"轮次"——每轮都是标准的 agent chat 调用

### Session 延续

三轮共享同一 `session_id`：

```ts
sessionIds.current[1]  // S2 agent 的 session_id，横跨 R1/R2/R3
```

Round 2/3 的 agent 能在同一对话历史里看到 Round 1 的 tool_call 记录，但设计上不依赖这一点——prompt 明确要求每轮都重新 `read_ontology_structure` 从 PG 读取权威版本，避免 agent "记错" 前轮输出。

### 静默调用 vs 可见调用

- S1/S3/S4 用 `callAgentStream`——用户能看到流式文本、tool_call、YAML
- S2 三轮用 `callAgentStreamSilent`——不把中间输出塞进聊天流，只在 StepProgress 上更新"✅ 类与关系设计完成 / ✅ 指标设计完成 / ✅ 遥测设计完成"，最后读取 stage_output 展示合并后的完整 YAML

原因：三轮中间产物对用户没有价值，只会让聊天流冗长。用户关心的是最终合并后的本体。

## Prompt 设计

### Round 1（classes + relationships）

两个变体：

**首次（isIncremental=false）**：
```
请根据场景分析设计本体的 classes 和 relationships。
要求：
- 只设计 classes（含完整 attributes）和 relationships
- 不要添加 metrics 和 telemetry（后续步骤会单独添加）
- 第一公民类的属性要最丰富（>=15个），包含基础属性、派生属性和状态属性
- 派生属性的 formula 只能引用同类中已定义的属性
- 完成后调用 save_output
```

**增量（isIncremental=true）**：
```
本项目已有本体结构(vN)，场景分析已更新。
请先 read_ontology_structure，再 read_scene_analysis，
在已有本体基础上增量修改 classes 和 relationships：
- 新增场景分析中提到但本体中缺少的类和关系
- 修正与最新分析不一致的地方
- 保留未受影响的已有内容
```

关键约束：
- **明确告诉 agent 不要在本轮生成 metrics/telemetry**——否则 agent 会忍不住"一步到位"把所有东西塞进来
- **第一公民属性数量下限 ≥15**——防止 agent 偷懒只给 3-5 个基础字段
- **派生公式作用域**——同类属性才能互相引用，跨类引用走 `[relationship].attribute` 语法

### Round 2（metrics）

```
请在已有的本体结构上添加 metrics（指标）。
先调用 read_ontology_structure 读取当前结构，然后在其基础上添加 metrics 部分。

每个 metric 必须包含：
- kind: aggregate / composite / classification
- status: designed / implemented / undefined
- source_entities: 列表格式如 [class_id1, class_id2]
- formula: 计算公式
- description: 业务含义

注意：kind 不能用 gauge/counter/kpi/ratio 等非标准值，
      status 不能用 active/enabled/live 等非标准值。

完成后调用 save_output 保存完整的 YAML
（包含已有的 classes + relationships + 新增的 metrics）。
```

关键约束：
- **枚举值白名单**——历史上 agent 频繁编造 `kind: gauge`, `status: active` 等，prompt 里硬写死合法值
- **save_output 传完整 YAML**——不传差分；这样后端 yaml_content 在每轮末尾都是自洽的

### Round 3（telemetry）

```
请在已有的本体结构上添加 telemetry（遥测数据流）。
先调用 read_ontology_structure 读取当前结构，然后在其基础上添加 telemetry 部分。

每个 telemetry 必须包含：
- source_class: 数据来源类（字段名是 source_class 不是 source）
- value_type: decimal / integer / boolean / string（不能用 float/gauge/percentage）
- sampling: 采样频率如 1s / 10s / 1min（字段名是 sampling 不是 interval）
- aggregations: 列表格式 [avg, max, min]（字段名是 aggregations 复数）
- status: designed / implemented / undefined
- context_strategy: 对象格式，含 default_window / max_window /
                    default_aggregation / default_granularity

完成后调用 save_output 保存完整的 YAML
（包含 classes + relationships + metrics + 新增 telemetry）。
```

关键约束：
- **字段名防漂移**——`source_class` / `sampling` / `aggregations` 这些都是 agent 最容易写错的字段名（会写成 `source`/`interval`/`aggregation`），prompt 里点名纠正
- **context_strategy 强制对象结构**——防止 agent 用字符串糊弄

## 增量 vs 全新

通过 `stageVersions[1]` 判断：

- `stageVersions[1] === 0` → 本项目 S2 从未运行过，走 greenfield prompt
- `stageVersions[1] > 0` → 已有 v(N) 本体，走 incremental prompt，要求 agent 先 read 再改

**三轮都分别走 incremental 判断**，不是"Round 1 incremental, Round 2/3 overwrite"——因为用户可能只改 metrics 不改 classes，也可能只补 telemetry。

## UI 反馈

`StepProgress` 三级状态：

```ts
const steps: StepProgress[] = [
  { label: '类与关系设计', status: 'running' },
  { label: '指标设计', status: 'pending' },
  { label: '遥测设计', status: 'pending' },
]
```

每完成一轮，上一步 → `done`、下一步 → `running`，渲染成带勾/转圈图标的步骤条。

三轮全部完成后：
1. 调用 `fetchStageOutput(pid, 'ontology_structure')` 读取最终合并后的 YAML
2. 截取前 500 字符作 preview，塞进消息 `content`
3. 完整 YAML 存入 `fullContent`，供"查看完整"按钮展开
4. 调用 `completeStage(1)` 触发 UI 进入 S3 阶段

## 错误处理

每轮独立 try/catch 在 `runS2MultiStep` 最外层：

```ts
try {
  await callAgentStreamSilent(prompts.round1, ...)  // 任意轮抛错
  ...
} catch (err) {
  const running = steps.find(s => s.status === 'running')
  if (running) running.status = 'error'  // 对应步骤显示红叉
  updateSteps(steps, `设计失败: ${errMsg}`)
  setAlertState({ message: `本体架构设计失败: ${errMsg}`, type: 'error' })
}
```

**失败恢复**：目前没有自动重试。用户在错误提示后可手动"重新运行 S2"——由于每轮末尾都 `save_output` 了完整 YAML，所以重新运行会走 incremental 路径，从已保存的版本继续而不是重头开始。

## 已知限制与后续优化

| 问题 | 现状 | 后续方向 |
|------|------|---------|
| 三轮都要 LLM 重新写一遍已有内容 | LLM 每轮的 output 是完整 YAML（含前轮内容），浪费 token | 可探索让 agent 只返回 `metrics:` 或 `telemetry:` 片段，前端做 YAML 合并 |
| 轮次粒度固定三轮 | 如果未来新增 functions/interfaces 等顶级节点，得加第 4、5 轮 | 改成配置驱动：`getS2Prompts` 返回 N 个 prompt，runS2MultiStep 循环消费 |
| 单轮内 LLM 还是可能超时 | R1 生成完整 classes 如果类数 >20 仍会慢 | 可进一步把 R1 拆成"类骨架 → 逐类加属性" |
| agent 可能忽视 prompt 里"只做本轮"的约束 | 实测 DeepSeek/gpt-5.4 基本遵守，偶发越界 | 后端 guard 检测：R2 输出里如果出现 telemetry 就拒绝保存（未实现） |

## 与 save_output guard 的关系

每轮 `save_output` 都会走后端 `RunOntologyGuards`：

- R1 保存时：guard 检查 classes/relationships 的完整性（重复 ID、派生公式引用、first_citizen 唯一等）
- R2 保存时：guard 额外检查 metrics（kind 白名单、source_entities 存在性、formula 引用可达）
- R3 保存时：guard 额外检查 telemetry（source_class 存在性、字段名规范、context_strategy 结构）

Guard 发现阻断级错误时返回 `Blocked: true`，agent 在 chat 中收到错误并自修复——这是"硬壳保护"的核心。参见 `server/internal/tools/integrity.go`。

## 关键代码位置

| 功能 | 文件:行 |
|------|--------|
| 三轮 prompt 定义 | `app/src/pages/AgentBuild/stages.ts:80-125` |
| 编排循环 | `app/src/pages/AgentBuild/index.tsx:257-326` |
| 静默调用实现 | `app/src/pages/AgentBuild/index.tsx:241-253` |
| StepProgress 渲染 | `app/src/pages/AgentBuild/ProgressBar.tsx` |
| 保存阶段后端 | `server/internal/tools/save.go` + `integrity.go` |
