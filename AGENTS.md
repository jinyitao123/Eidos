# AGENTS.md — Ontology Toolkit

本文档描述 Ontology Toolkit 中的 4 个 Builder Agent（S1-S4），包括它们的职责、工具权限、输入输出格式，以及如何调试和扩展。

---

## Builder Agent 全景

```
业务调研文档（上传）
    ↓
S1 场景分析师 (scene-analyst)
    → 输出：场景矩阵 YAML（角色、痛点、业务动作、数据流）
    ↓ 人工确认后启动
S2 本体架构师 (ontology-architect)
    → 输出：完整本体 YAML（classes, relationships, metrics, rules, actions）
    ↓ 人工确认后启动
S3 规则设计师 (rule-designer)
    → 输出：规则与动作增强 YAML（refinement of S2 output）
    ↓ 人工确认后启动
S4 本体审查员 (ontology-reviewer)
    → 输出：审查报告 + 最终发布版 YAML
```

**关键约束**：每个 Agent 阶段结束后必须等待人工确认，系统不自动推进到下一个 Agent。S4 的审查报告中 C 类问题（一致性错误）会阻止发布，P 类和 O 类不阻止。

---

## S1：场景分析师（scene-analyst）

### 职责

从原始业务调研文档中提取结构化场景信息，为本体设计提供事实基础。

```yaml
name: scene-analyst
visibility: internal_tool        # 最终用户不可见
mcp_servers:
  - url: http://ontology-mcp:9091
permissions:
  allow_tools:
    - read_documents             # 读取上传的业务文档
    - save_output                # 保存 S1 输出到 stage_outputs.s1_output
    - validate_yaml              # 提交前验证格式
```

### 输入

- 用户上传的业务调研文档（Markdown / TXT / PDF）
- Project 元数据（project_id, domain）

### 输出格式（保存为 `s1_output`）

```yaml
# S1 输出示例片段
scene_analysis:
  domain: spare_parts_management
  roles:
    - id: engineer
      name: 设备工程师
      responsibilities: [设备检修, 备件领用]
      pain_points: [型号难记, 库存不透明]
  business_actions:
    - id: issue_spare_part
      name: 领用备件
      actor: engineer
      frequency: daily
      current_pain: 无法校验合理性
  data_flows:
    - from: engineer
      to: warehouse
      action: issue_spare_part
      data: [part_id, quantity, reason]
```

### 常见问题

- **文档太长超出上下文**：S1 会分批处理，每批聚焦一个业务场景，最后汇总。
- **调研信息矛盾**：S1 应标注冲突来源（`conflict_sources`），不要强行裁决。

---

## S2：本体架构师（ontology-architect）

### 职责

基于 S1 场景矩阵，设计完整的业务本体 YAML，包括类、关系、指标、遥测、规则草稿。

```yaml
name: ontology-architect
visibility: internal_tool
mcp_servers:
  - url: http://ontology-mcp:9091
permissions:
  allow_tools:
    - read_s1_output             # 读取 S1 场景分析结果
    - save_output                # 保存到 stage_outputs.s2_output
    - validate_yaml
    - query_published_ontologies # 检查是否有可复用的共享类
```

### 输出格式（保存为 `s2_output`）

完整的本体 YAML，遵循 `docs/01-ontology-yaml-spec.md` 规范：

```yaml
ontology:
  id: spare_parts
  name: 备件管理本体
  version: "0.1.0"
  first_citizen: inventory_position

classes:
  - id: inventory_position
    name: 库存仓位
    first_citizen: true
    phase: alpha
    attributes:
      - id: current_qty
        name: 当前库存数量
        type: integer
        phase: alpha
      - id: safety_gap
        name: 安全库存缺口
        type: integer
        formula: "safety_stock - available_qty"
        phase: alpha

relationships:
  - id: tracks
    name: 追踪
    from: inventory_position
    to: spare_part
    cardinality: many_to_one

metrics:
  - id: stale_ratio
    name: 呆滞率
    kind: aggregate
    formula: "stale_value / total_value"
    status: implemented

rules:
  - id: R01
    name: 安全库存预警
    trigger: on_movement_out
    condition: "safety_gap > 0"
    action: alert_safety_stock
```

### 设计约定

- 所有 `id` 字段：snake_case，不含大写、中文、空格
- 类 ID 用单数（`inventory_position`），PG 表名由 pipeline 自动复数化
- 每个本体有且仅有一个 `first_citizen: true` 的类
- `phase: alpha` = Day-1 必须，`beta` = 3-6 月，`full` = 12 月+
- 公式中同类引用直接写属性名；跨关系引用用 `[relationship_id].attribute`

---

## S3：规则设计师（rule-designer）

### 职责

深化 S2 输出中的规则和动作设计，确保规则的完整性、无歧义性和可执行性。

```yaml
name: rule-designer
visibility: internal_tool
mcp_servers:
  - url: http://ontology-mcp:9091
permissions:
  allow_tools:
    - read_s2_output             # 读取 S2 本体草稿
    - save_output                # 保存到 stage_outputs.s3_output
    - validate_yaml
```

### 关注点

1. **规则完整性**：每条规则必须有明确的 `trigger`、`condition`、`action`
2. **动作可执行性**：`action` 必须对应 MCP 工具或系统内置操作
3. **阈值显式化**：不允许"大量"、"频繁"等模糊表述，必须是具体数值
4. **边界条件**：规则之间是否有冲突？条件是否可能永远为 false？

### 输出格式（保存为 `s3_output`）

在 S2 YAML 基础上增补/修订 `rules` 和 `actions` 节点，以及 `configurable` 参数：

```yaml
rules:
  - id: R05
    name: 领用频次异常
    trigger: on_movement_out
    condition: "COUNT(movements[same_equipment, same_part, last_30_days]) >= 3"
    action: alert_abnormal_consumption
    parameters:
      threshold:
        value: 3
        configurable: true       # 出现在业务应用的管理员设置页
        description: 30天内触发异常的领用次数阈值

actions:
  - id: alert_abnormal_consumption
    name: 触发频次异常告警
    type: notification
    targets: [section_leader, engineer]
    decision_log: true           # 自动写入 decision_log 表
```

---

## S4：本体审查员（ontology-reviewer）

### 职责

对 S3 输出进行系统性审查，生成结构化审查报告，决定是否可以发布。

```yaml
name: ontology-reviewer
visibility: internal_tool
mcp_servers:
  - url: http://ontology-mcp:9091
permissions:
  allow_tools:
    - read_s3_output
    - read_s1_output             # 对照场景矩阵做覆盖度检查
    - save_output                # 保存审查报告到 stage_outputs.s4_output
    - validate_yaml
    - query_published_ontologies # 跨本体一致性检查（M03）
    - query_ontology_metadata    # 发现已有本体的结构（M01）
```

### 审查维度

| 类别 | 代码 | 说明 | 是否阻止发布 |
|------|------|------|------------|
| 一致性 | C | 定义矛盾、关系方向错误、孤立节点 | ✅ 阻止 |
| 完整性 | P | 属性缺失、规则条件不完整 | ❌ 不阻止（警告） |
| 优化 | O | 冗余设计、可合并的类、命名改进建议 | ❌ 不阻止（建议） |

### 审查报告格式（`s4_output`）

```yaml
review_report:
  version: "0.1.0"
  status: BLOCKED               # APPROVED | BLOCKED | APPROVED_WITH_WARNINGS
  summary: "发现 2 个一致性问题，需修复后才能发布"
  
  issues:
    - id: C001
      category: C
      severity: error
      location: "relationships.tracks"
      description: "tracks 关系从 inventory_position 指向 spare_part，但 spare_part 没有对应的反向关系声明"
      suggestion: "在 spare_part 类添加 tracked_by 反向关系，或在 tracks 关系中添加 bidirectional: true"
    
    - id: P003
      category: P
      severity: warning
      location: "classes.purchase_order.attributes.urgency"
      description: "urgency 属性缺少枚举值定义"
      suggestion: "添加 enum: [NORMAL, URGENT]"
    
    - id: O001
      category: O
      severity: info
      location: "classes.warehouse"
      description: "warehouse.level 和 warehouse.has_safety_stock 可能存在冗余，level=SECONDARY 隐含了 has_safety_stock=false"
      suggestion: "考虑移除 has_safety_stock，改为派生属性"

  cross_ontology_check:
    shared_classes:
      - class_id: equipment
        also_in: [equipment_maintenance]
        compatibility: COMPATIBLE   # COMPATIBLE | INCOMPATIBLE | NOT_CHECKED
```

---

## MCP 工具清单（ontology-mcp:9091）

| 工具 | 可用 Agent | 说明 |
|------|-----------|------|
| `read_documents` | S1 | 读取 project 下上传的文档列表 |
| `read_s1_output` | S2 | 读取 stage_outputs.s1_output |
| `read_s2_output` | S3 | 读取 stage_outputs.s2_output |
| `read_s3_output` | S4 | 读取 stage_outputs.s3_output |
| `save_output` | S1-S4 | 写入 stage_outputs.s{N}_output |
| `validate_yaml` | S1-S4 | 验证 YAML 格式，返回错误列表 |
| `list_projects` | 所有 | 列出所有 ontology projects |
| `get_project` | 所有 | 获取 project 元数据 |
| `create_project` | — | 前端直接调用 |
| `list_versions` | 所有 | 列出已发布版本 |
| `get_version` | 所有 | 获取某个版本的 YAML |
| `query_published_ontologies` | S2, S4 | 查询所有已发布本体的类和关系（跨本体复用） |
| `query_ontology_metadata` | S4 | 动态发现当前本体的结构（M01） |
| `cypher_query` | S4 | 在本体图谱上执行自定义查询 |

**Protocol**：JSON-RPC 2.0，POST `/`，method: `tools/list` 或 `tools/call`。

---

## 调试 Agent

### 查看 Agent 输出

```bash
# 直接查询 stage_outputs 表
psql $PG_URL -c "
  SELECT stage, saved_at, LEFT(yaml_content, 200)
  FROM ontology.stage_outputs
  WHERE project_id = 'your-project-id'
  ORDER BY saved_at;
"
```

### 手动调用 MCP 工具

```bash
# 读取 S2 输出
curl -X POST http://localhost:9091/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "read_s2_output",
      "arguments": {"project_id": "proj-abc"}
    },
    "id": 1
  }'
```

### 验证 YAML

```bash
# 通过 MCP 工具
curl -X POST http://localhost:9091/ \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "validate_yaml",
      "arguments": {"yaml_content": "...", "project_id": "proj-abc"}
    },
    "id": 1
  }'

# 通过 Pipeline CLI
cd pipeline && ./bin/generate --from path/to/ontology.yaml --validate-only
```

---

## Pipeline 代码生成

Pipeline 在 S4 审查通过后由前端 PublishPipeline 页面触发，完全确定性，不调用 LLM：

```bash
cd pipeline

# 全量生成（7 步）
./bin/generate --from ontology.yaml --output ./out

# 增量生成（仅生成 ALTER TABLE，不 DROP+CREATE）
./bin/generate \
  --from ontology-v2.yaml \
  --previous ontology-v1.yaml \
  --output ./out

# 只生成特定步骤
./bin/generate --from ontology.yaml --output ./out --steps pg,mcp,types
```

**7 步输出：**

| 步骤 | 目录 | 内容 |
|------|------|------|
| 1 PG DDL | `out/pg/` | `schema.sql`（CREATE TABLE + INDEX） |
| 2 MCP Tools | `out/mcp/` | Go handlers（CRUD per class） |
| 3 Neo4j Schema | `out/neo4j/` | `schema.cypher`（CONSTRAINT + INDEX） |
| 4 Agent Config | `out/agents/` | AgentRecord YAML（per business role） |
| 5 Rule Engine | `out/rules/` | 规则引擎配置 JSON |
| 6 TS Types | `out/types/` | `types.ts`（per class interface） |
| 7 Connector | `out/connectors/` | 字段映射模板（for Foundry） |

---

## 关键约束

- **Agent 输出必须是合法 YAML**：`save_output` 前必须调用 `validate_yaml`，验证失败不得保存。
- **Agent 从工具读取上一阶段输出，不从对话历史读取**：S3 调用 `read_s2_output`，不依赖 Session 里的消息。
- **人工确认门控**：前端 AgentBuild 页面在每个 Stage 完成后显示确认按钮，只有用户点击才能推进到下一个 Agent。
- **Pipeline 不调用 LLM**：Pipeline 是纯模板渲染，不得引入任何 LLM 调用或网络请求。
- **不手工编辑生成代码**：所有修改必须回到 YAML，重新发布，重新生成。生成代码是 derived artifact。
