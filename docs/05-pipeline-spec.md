# 管道生成器技术规格

## 语义胶水生成器：从本体 YAML 语义合约生成各消费端的桥接代码

---

## 总览

管道生成器是确定性的模板代码生成器，不使用 LLM。本体 YAML 是纯语义合约——它描述业务领域的概念、关系、规则和动作，不关心存储层。管道的职责是生成语义合约与各消费端（Agent、前端、服务）之间的桥接代码。

管道分为 **4 个核心步骤**（始终运行）和 **N 个可选存储插件**（按需启用）。

```
ontology.yaml（确认发布后）
  │
  │  ── Core Steps（始终运行）──
  ├──→ Step 1: MCP Tool Interface Generator    → tools.json
  ├──→ Step 2: Agent Config Generator          → agents/{agent_id}_tools.yaml
  ├──→ Step 3: Rule Engine Config Generator    → rules/config.yaml
  ├──→ Step 4: Frontend Type Generator         → types/ontology.ts
  │
  │  ── Optional Storage Plugins（按需启用，--plugins 标志控制）──
  ├──→ PG Schema Plugin                        → migrations/xxx.sql
  ├──→ Neo4j Schema Plugin                     → neo4j/schema.cypher
  └──→ Connector Template Plugin               → connector/mapping_template.yaml
```

### 与 v1 的关键变化

- **定位转变**：从"基础设施代码生成器"转变为"语义胶水生成器"。本体 YAML 是纯语义合约，管道生成的是语义合约与各消费端之间的桥接。
- **属性类型表不再包含 PG 类型映射**：PG 类型映射移入 PG Schema Plugin。
- **属性类型表不再包含 Go 类型映射**：Go 类型由实现层自行决定。
- **不再生成 `GENERATED ALWAYS AS` 派生列**：派生属性的存储表示是存储层的关注点，不属于语义合约。
- **管道不再生成 Go 工具代码**：管道生成工具接口定义（tools.json），任何实现都可以根据接口定义来完成。
- **增量生成（ALTER TABLE 等）移入 PG Plugin**：核心步骤不涉及存储迁移。
- **连接器模板生成移入独立插件**。
- **新增 Metric 工具生成**：每个指标自动生成对应的工具接口。

---

## Core Step 1: MCP Tool Interface Generator

### 输入
`ontology.yaml` 中的 `classes`、`actions`、`metrics`、`functions`

### 输出
MCP 工具接口定义文件（`tools.json`）。定义工具的名称、输入 schema 和输出 schema。**不生成 Go 实现代码**——实现是服务层的职责。

### 生成规则

**类 → query 工具接口：**
```
每个 class → 一个 query_{class_id} 工具接口
  inputSchema:
    - 每个 graph_sync=true 的属性 → 可选查询参数
    - 额外参数：limit, offset, sort_by, order
  outputSchema:
    - 对象数组，每个对象包含该类的所有属性
```

**动作 → execute 工具接口：**
```
每个 action → 一个 execute_{action_id 去掉A前缀的名称} 工具接口
  inputSchema:
    - action.params 中的每个参数 → 工具参数
  outputSchema:
    - 执行结果（success/failure + 变更摘要）
  语义描述（嵌入到工具定义的 description 中）：
    - 前置规则列表（triggers_before）
    - 写回逻辑摘要（writes）
    - 后置规则列表（triggers_after）
    - 是否需要审批（require_approval 规则）
    - 是否记录决策日志（decision_log=true）
```

**函数 → 只读工具接口：**
```
每个 function → 一个 calc_{function_id} 工具接口
  inputSchema: function.inputs
  outputSchema: function.output_type
  implementation_hint: sql | go | agent_delegated（供实现层参考，不影响接口）
```

**指标 → 指标查询工具接口（新增）：**
```
每个 metric（status=implemented 或 status=designed）→ 一个工具接口

aggregate 类型指标 → query_{metric_id} 工具接口
  inputSchema:
    - dimensions: 可选的维度参数（按指标定义中的 dimensions 生成）
    - granularity: 时间粒度（day, week, month, quarter, year）
    - time_range: { start, end }
    - 指标定义中的其他参数
  outputSchema:
    - 指标值 + 维度分组结果

classification 类型指标 → classify_{metric_id} 工具接口
  inputSchema:
    - 分类目标实体的标识参数
    - 分类参数（阈值等，如指标定义中有 configurable 参数）
  outputSchema:
    - 分桶分配结果（bucket assignments）

composite 类型指标 → query_{metric_id} 工具接口
  inputSchema:
    - 组合指标引用的子指标参数
    - dimensions, granularity, time_range
  outputSchema:
    - 组合计算结果
```

**额外工具接口：**
```
query_ontology_metadata → 返回当前本体的元数据（类列表、关系列表、可用工具列表）
graph_{关系遍历类工具} → 基于 relationships 生成图谱遍历工具接口
check_{规则ID} → 基于 rules 生成规则检查工具接口
```

### 输出示例
```json
{
  "name": "query_inventory",
  "description": "查询库存头寸。可按库房、备件、状态筛选。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "warehouse_id": { "type": "string", "description": "库房ID" },
      "spare_part_id": { "type": "string", "description": "备件ID" },
      "is_stale": { "type": "boolean", "description": "是否呆滞" },
      "safety_gap_gt": { "type": "integer", "description": "安全缺口大于" },
      "criticality": { "type": "string", "enum": ["A", "B", "C"] },
      "limit": { "type": "integer", "default": 50 },
      "offset": { "type": "integer", "default": 0 }
    }
  },
  "outputSchema": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "current_qty": { "type": "integer" },
        "safety_stock": { "type": "integer" },
        "safety_gap": { "type": "integer" },
        "is_stale": { "type": "boolean" }
      }
    }
  }
}
```

```json
{
  "name": "query_stale_inventory_rate",
  "description": "查询呆滞库存率指标。支持按库房、备件分类维度聚合。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "dimensions": {
        "type": "array",
        "items": { "type": "string", "enum": ["warehouse", "category", "criticality"] }
      },
      "granularity": { "type": "string", "enum": ["day", "week", "month", "quarter", "year"] },
      "time_range": {
        "type": "object",
        "properties": {
          "start": { "type": "string", "format": "date" },
          "end": { "type": "string", "format": "date" }
        }
      }
    }
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "metric_id": { "type": "string" },
      "value": { "type": "number" },
      "unit": { "type": "string" },
      "breakdown": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "dimension_value": { "type": "string" },
            "value": { "type": "number" }
          }
        }
      }
    }
  }
}
```

---

## Core Step 2: Agent Config Generator

### 输入
`ontology.yaml` 中的 `actions`（permission 字段）+ `metrics` + Step 1 生成的工具列表

### 输出
Agent 工具绑定配置（`agents/{agent_id}_tools.yaml`）+ 提示词更新建议

### 生成规则

```
遍历 actions：
  对于每个 action.permission.agents 中的 agent_id：
    - 将对应的 execute 工具加入该 agent 的 write 工具列表
    - 将该 action 引用的类的 query 工具加入 read 工具列表
    - 将 triggers_before/after 中的规则的 check 工具加入 rules 工具列表

遍历 metrics：
  对于每个 metric，将对应的 query_{metric_id} 或 classify_{metric_id}
  工具加入相关 agent 的 metrics 工具列表

所有 agent 自动绑定 query_ontology_metadata 工具（只读）

提示词更新建议：
  - 新增的工具 → 建议在提示词中添加工具说明
  - 删除的工具 → 建议在提示词中移除工具说明
  - 新增的指标工具 → 建议在提示词中添加指标查询能力说明
  - 输出为 markdown 文本，需人工确认
```

### 输出示例
```yaml
# agents/inventory-steward_tools.yaml
agent_id: inventory-steward
mcp_tools:
  read:
    - query_inventory
    - query_movements
    - query_ontology_metadata
  write:
    - execute_movement_out    # from A01
    - execute_movement_in     # from A02
    - execute_purchase_draft   # from A04
  rules:
    - check_safety_stock      # R01
    - check_frequency_anomaly # R05
  graph:
    - graph_equipment_parts
    - graph_part_substitutes
  functions:
    - calc_consumption_trend
    - calc_reorder_point
  metrics:
    - query_stale_inventory_rate
    - classify_abc_classification
    - query_inventory_turnover
```

---

## Core Step 3: Rule Engine Config Generator

### 输入
`ontology.yaml` 中的 `rules`

### 输出
规则引擎配置（`rules/config.yaml`）

### 生成规则

```
每个 rule → 一个规则触发/条件/动作配置

trigger.type:
  before_action → 注册为动作的前置钩子
  after_action → 注册为动作的后置钩子
  cron → 注册为定时任务
  on_change → 注册为数据变更通知

condition.expression → 结构化条件定义
  简单比较 → 条件表达式
  跨表引用 → 关联数据引用 + 条件判断

action.type:
  notify_agent → 通知指定 Agent
  update_attribute → 更新属性值
  require_approval → 创建审批记录，暂停动作执行
  create_record → 创建新记录
```

**注意**：规则引擎配置是声明式的触发/条件/动作定义，不生成 Go 代码。实现层根据配置文件完成具体的规则评估逻辑。

---

## Core Step 4: Frontend Type Generator

### 输入
`ontology.yaml` 中的 `classes`、`relationships`、`actions`、`metrics`

### 输出
TypeScript 类型定义文件（`types/ontology.ts`）

### 生成规则

```
每个 class → 一个 interface
  属性 → 字段（类型按 TS 映射表转换）
  derived 属性 → 加 | null（可能尚未计算）
  关系外键 → {to_class_id}Id: string

每个 action → 一个 params interface
  execute_{action_name}Params

每个 metric → 一个结果 interface
  {MetricName}Result

枚举 → union type
  type Criticality = 'A' | 'B' | 'C'
```

### TS 类型映射

| 本体类型 | TypeScript 类型 |
| --------- | ---------------- |
| string | string |
| integer | number |
| decimal | number |
| boolean | boolean |
| date | string |
| timestamp | string |
| enum | union type |
| uuid | string |

### 输出示例
```typescript
// Generated from spare_parts ontology v1.0.0

export type Criticality = 'A' | 'B' | 'C';
export type MovementType = 'out' | 'in' | 'return' | 'adjust' | 'transfer';
export type PurchaseStatus = 'draft' | 'submitted' | 'approved' | 'in_transit' | 'arrived' | 'cancelled';

export interface InventoryPosition {
  id: string;
  currentQty: number;
  safetyStock: number;
  safetyGap: number | null;
  availableQty: number | null;
  reservedQty: number;
  inventoryValue: number | null;
  isStale: boolean;
  lastConsumedDate: string | null;
  staleAgeDays: number | null;
  monthlyAvgConsumption: number | null;
  dataSource: string | null;
  sparePartId: string;
  warehouseId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SparePart {
  id: string;
  code: string;
  name: string;
  specification: string | null;
  category: string | null;
  criticality: Criticality | null;
  typicalLeadTime: number | null;
  unitPrice: number | null;
  unit: string | null;
}

// ... 其他类

export interface ExecuteMovementOutParams {
  positionId: string;
  quantity: number;
  movementReason: string;
  equipmentId?: string;
  faultDescription?: string;
}

// ... 其他动作参数

export interface StaleInventoryRateResult {
  metricId: string;
  value: number;
  unit: string;
  breakdown: Array<{
    dimensionValue: string;
    value: number;
  }>;
}

// ... 其他指标结果
```

---

## Optional Storage Plugin: PG Schema Plugin

当部署使用 PostgreSQL 时启用（`--plugins pg`）。

### 输入
`ontology.yaml` 中的 `classes` 和 `relationships`

### 输出
SQL DDL 文件（`migrations/xxx.sql`）

### PG 类型映射

| 本体类型 | PG 类型 |
| --------- | --------- |
| string | VARCHAR(255) |
| integer | INTEGER |
| decimal | DECIMAL(18,4) |
| boolean | BOOLEAN |
| date | DATE |
| timestamp | TIMESTAMP |
| enum | VARCHAR(50) + CHECK |
| uuid | UUID |

### 生成规则

**类 → 表：**
```
每个 class → 一张表，表名 = spareparts.{class.id}s（复数化）
每个 attribute → 一列
  - type 按 PG 类型映射表转换
  - required=true → NOT NULL
  - unique=true → UNIQUE 约束
  - default 不为空 → DEFAULT 值
  - enum → VARCHAR(50) + CHECK 约束
  - 自动添加 id UUID PRIMARY KEY DEFAULT gen_random_uuid()
  - 自动添加 created_at TIMESTAMP DEFAULT now()
  - 自动添加 updated_at TIMESTAMP DEFAULT now()
  - 派生属性不生成列（派生计算由实现层处理）
```

**关系 → 外键或关联表：**
```
many_to_one / one_to_one → from 表加列 {to_class_id}_id UUID REFERENCES
many_to_many → 独立关联表 {from_class}_{rel_id}_{to_class}
  - 如果有 edge_attributes → 关联表中加对应列
```

### 增量生成

对比旧版 YAML 和新版 YAML：

- 新增类 → CREATE TABLE
- 新增属性 → ALTER TABLE ADD COLUMN
- 删除属性 → ALTER TABLE DROP COLUMN（需人工确认）
- 类型变更 → ALTER TABLE ALTER COLUMN TYPE（需人工确认）
- 新增关系 → ALTER TABLE ADD COLUMN（外键）或 CREATE TABLE（关联表）

### 输出示例
```sql
-- Migration: 001_initial_spare_parts.sql
-- Generated from: spare_parts ontology v1.0.0

CREATE SCHEMA IF NOT EXISTS spareparts;

CREATE TABLE spareparts.spare_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  specification VARCHAR(255),
  category VARCHAR(255),
  criticality VARCHAR(50) CHECK (criticality IN ('A', 'B', 'C')),
  typical_lead_time INTEGER,
  unit_price DECIMAL(18,4),
  unit VARCHAR(255),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE spareparts.inventory_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  current_qty INTEGER NOT NULL,
  safety_stock INTEGER DEFAULT 2,
  reserved_qty INTEGER DEFAULT 0,
  is_stale BOOLEAN DEFAULT false,
  last_consumed_date DATE,
  data_source VARCHAR(255),
  last_sync_at TIMESTAMP,
  spare_part_id UUID NOT NULL REFERENCES spareparts.spare_parts(id),
  warehouse_id UUID NOT NULL REFERENCES spareparts.warehouses(id),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);
-- ... 其他表
```

---

## Optional Storage Plugin: Neo4j Schema Plugin

当部署使用 Neo4j 进行图查询时启用（`--plugins neo4j`）。

### 输入
`ontology.yaml` 中的 `classes`（graph_sync 属性）、`relationships`、`graph_config`

### 输出

- Cypher schema 脚本（`neo4j/schema.cypher`）
- 同步配置（`neo4j/sync_config.yaml`）

### 生成规则

```
每个 class（不在 nodes_not_in_graph 中）→ 一个节点标签
  节点属性 = 该类中 graph_sync=true 的属性 + id + created_at + updated_at

每个 relationship → 一个关系类型
  关系属性 = edge_attributes

同步配置：
  结构层节点（class.phase != 事件类）→ 按 structure_sync 策略同步
  状态层属性 → 按 status_sync 策略同步
  事件层节点 → 按 event_sync 策略同步 + archive_events_after_days 天后归档
```

### 输出示例
```cypher
// Node labels
CREATE CONSTRAINT inventory_position_id IF NOT EXISTS
  FOR (n:InventoryPosition) REQUIRE n.id IS UNIQUE;

// Relationship types
// (:InventoryPosition)-[:TRACKS]->(:SparePart)
// (:InventoryPosition)-[:LOCATED_IN]->(:Warehouse)
// (:Equipment)-[:USES {typical_qty: INT, install_position: STRING}]->(:SparePart)

// Sync properties for InventoryPosition:
// current_qty, safety_stock, safety_gap, available_qty, inventory_value,
// is_stale, last_consumed_date, monthly_avg_consumption, data_source
```

---

## Optional Storage Plugin: Connector Template Plugin

当需要数据集成时启用（`--plugins connector`）。

### 输入
`ontology.yaml` 中的 `classes`（所有非派生属性）+ `connector_hints`

### 输出
连接器映射配置骨架（`connector/mapping_template.yaml`）

### 生成规则

```
每个 class 的每个非派生属性 → 一条映射记录
  如果 connector_hints 中有对应的 source_hint → 填入
  否则 → mapping_status = unmapped
```

---

## 管道执行流程

### 全量生成

```
1. 解析 ontology.yaml
2. 校验 YAML 格式和语义（使用 01-ontology-yaml-spec.md 中的校验规则）
3. 执行 Core Steps 1-4：
   - Step 1: MCP Tool Interface Generator → tools.json
   - Step 2: Agent Config Generator → agents/*.yaml
   - Step 3: Rule Engine Config Generator → rules/config.yaml
   - Step 4: Frontend Type Generator → types/ontology.ts
4. 执行 --plugins 指定的可选插件（如有）
5. 所有输出写入 output/ 目录
6. 生成变更日志 CHANGELOG.md
7. 输出总结报告
```

### 增量生成（版本更新）

```
1. 解析新版 ontology.yaml
2. 加载旧版 ontology.yaml（从版本库）
3. 计算 diff（新增/修改/删除的类、属性、关系、规则、动作、指标）
4. Core Steps 只重新生成变更部分：
   - Step 1: 只重新生成变更的工具接口
   - Step 2: 只更新受影响的 Agent 配置
   - Step 3: 只更新变更的规则配置
   - Step 4: 重新生成完整类型文件（TS 类型无增量概念）
5. 可选插件增量行为：
   - PG Plugin: ALTER TABLE 而非 CREATE TABLE
   - Neo4j Plugin: 只同步变更的节点属性
   - Connector Plugin: 只更新变更的映射记录
6. 需人工确认的变更（PG Plugin 中的删除列、类型变更）标记为 PENDING
7. 生成变更日志
```

### CLI 用法

```bash
# 全量生成（仅核心步骤）
./bin/generate --from ontology.yaml --output ./out

# 全量生成 + PG 和 Neo4j 插件
./bin/generate --from ontology.yaml --output ./out --plugins pg,neo4j

# 全量生成 + 所有插件
./bin/generate --from ontology.yaml --output ./out --plugins pg,neo4j,connector

# 增量生成
./bin/generate --from ontology.yaml --previous ./versions/v1.0.0.yaml --output ./out --plugins pg,neo4j
```

### 部署流程

```
管道生成完成后，点击"部署到生产"：
1. 重新注册 MCP 工具接口（热更新，不重启服务）
2. 更新 Agent 工具绑定配置
3. 更新规则引擎配置
4. 前端类型文件写入代码仓库（触发 CI/CD）
5. （如果启用 PG Plugin）执行 PG 迁移脚本
6. （如果启用 Neo4j Plugin）更新 Neo4j schema 并触发增量同步
7. （如果启用 Connector Plugin）连接器映射模板更新
```
