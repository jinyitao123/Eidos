# 管道生成器技术规格

**从本体 YAML 自动生成下游代码的七步管道**

---

## 总览

管道生成器是确定性的模板代码生成器，不使用 LLM。输入是本体 YAML，输出是七类下游代码。支持全量生成（首次发布）和增量生成（版本更新）。

```
ontology.yaml（确认发布后）
  │
  ├──→ Step 1: PG Schema Generator
  ├──→ Step 2: MCP Tool Generator
  ├──→ Step 3: Neo4j Schema Generator
  ├──→ Step 4: Agent Config Generator
  ├──→ Step 5: Rule Engine Config Generator
  ├──→ Step 6: Frontend Type Generator
  └──→ Step 7: Connector Mapping Template Generator
```

---

## Step 1: PG Schema Generator

### 输入
`ontology.yaml` 中的 `classes` 和 `relationships`

### 输出
SQL DDL 文件（`migrations/xxx.sql`）

### 生成规则

**类 → 表：**
```
每个 class → 一张表，表名 = spareparts.{class.id}s（复数化）
每个 attribute → 一列
  - type 按映射表转换（见 01-ontology-yaml-spec.md）
  - required=true → NOT NULL
  - unique=true → UNIQUE 约束
  - default 不为空 → DEFAULT 值
  - enum → VARCHAR(50) + CHECK 约束
  - 自动添加 id UUID PRIMARY KEY DEFAULT gen_random_uuid()
  - 自动添加 created_at TIMESTAMP DEFAULT now()
  - 自动添加 updated_at TIMESTAMP DEFAULT now()
```

**关系 → 外键或关联表：**
```
many_to_one / one_to_one → from 表加列 {to_class_id}_id UUID REFERENCES
many_to_many → 独立关联表 {from_class}_{rel_id}_{to_class}
  - 如果有 edge_attributes → 关联表中加对应列
```

**派生属性：**
```
简单公式（同表内引用）→ GENERATED ALWAYS AS (...) STORED
复杂公式（跨表/聚合/时间窗口）→ 不生成列，由定时任务或查询时计算
  - 生成一个定时刷新函数 refresh_{class_id}_{attr_id}()
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
  -- derived: safety_gap, available_qty, inventory_value 由触发器/定时任务计算
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

## Step 2: MCP Tool Generator

### 输入
`ontology.yaml` 中的 `classes`、`actions`、`functions`

### 输出
- MCP 工具注册 JSON（`tools.json`）
- Go 代码骨架（`tools/{tool_name}.go`）

### 生成规则

**类 → query 工具：**
```
每个 class → 一个 query_{class_id} 工具
  inputSchema:
    - 每个 graph_sync=true 的属性 → 可选查询参数
    - 额外参数：limit, offset, sort_by, order
  返回值：对象数组
```

**动作 → execute 工具：**
```
每个 action → 一个 execute_{action_id 去掉A前缀的名称} 工具
  inputSchema:
    - action.params 中的每个参数 → 工具参数
  执行逻辑：
    1. 参数校验
    2. 执行 triggers_before 中的规则（如果有 require_approval 规则且未审批，返回等待审批状态）
    3. 执行 writes 中的写回逻辑
    4. 执行 triggers_after 中的规则
    5. 如果 decision_log=true，写入决策日志
    6. 触发 Neo4j 同步
```

**函数 → 只读工具：**
```
每个 function → 一个 calc_{function_id} 工具
  inputSchema: function.inputs
  implementation=sql → 直接执行 SQL
  implementation=go → 调用 Go 函数
  implementation=agent_delegated → 返回 "需要Agent推理" 标记
```

**额外工具：**
```
query_ontology_metadata → 返回当前本体的元数据（类列表、关系列表、可用工具列表）
graph_{关系遍历类工具} → 基于 relationships 生成图谱遍历工具
check_{规则ID} → 基于 rules 生成规则检查工具
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
  }
}
```

---

## Step 3: Neo4j Schema Generator

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

## Step 4: Agent Config Generator

### 输入
`ontology.yaml` 中的 `actions`（permission 字段）+ Step 2 生成的工具列表

### 输出
Agent 工具绑定配置（`agents/{agent_id}_tools.yaml`）+ 提示词更新建议

### 生成规则

```
遍历 actions：
  对于每个 action.permission.agents 中的 agent_id：
    - 将对应的 execute 工具加入该 agent 的 write 工具列表
    - 将该 action 引用的类的 query 工具加入 read 工具列表
    - 将 triggers_before/after 中的规则的 check 工具加入 rules 工具列表

所有 agent 自动绑定 query_ontology_metadata 工具（只读）

提示词更新建议：
  - 新增的工具 → 建议在提示词中添加工具说明
  - 删除的工具 → 建议在提示词中移除工具说明
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
```

---

## Step 5: Rule Engine Config Generator

### 输入
`ontology.yaml` 中的 `rules`

### 输出
规则引擎配置（`rules/config.yaml`）+ Go 代码骨架（`rules/{rule_id}.go`）

### 生成规则

```
每个 rule → 一个规则配置 + 一个 Go 评估函数

trigger.type:
  before_action → 注册为动作的前置钩子
  after_action → 注册为动作的后置钩子
  cron → 注册为定时任务（使用 robfig/cron）
  on_change → 注册为 PG 触发器通知（LISTEN/NOTIFY）

condition.expression → 翻译为 Go 条件判断代码
  简单比较 → 直接 if 语句
  跨表引用 → 先查关联数据再判断

action.type:
  notify_agent → 调用 Weave API 发送通知给指定 Agent
  update_attribute → 执行 UPDATE SQL
  require_approval → 创建审批记录，暂停动作执行
  create_record → 执行 INSERT SQL
```

---

## Step 6: Frontend Type Generator

### 输入
`ontology.yaml` 中的 `classes`、`relationships`、`actions`

### 输出
TypeScript 类型定义文件（`types/ontology.ts`）

### 生成规则

```
每个 class → 一个 interface
  属性 → 字段（类型按映射表转换）
  derived 属性 → 加 | null（可能尚未计算）
  关系外键 → {to_class_id}Id: string

每个 action → 一个 params interface
  execute_{action_name}Params

枚举 → union type
  type Criticality = 'A' | 'B' | 'C'
```

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
```

---

## Step 7: Connector Mapping Template Generator

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

### 全量生成（首次发布）

```
1. 解析 ontology.yaml
2. 校验 YAML 格式和语义（使用 01-ontology-yaml-spec.md 中的校验规则）
3. 按顺序执行 Step 1-7
4. 每步输出写入 output/ 目录
5. 生成变更日志 CHANGELOG.md
6. 输出总结报告
```

### 增量生成（版本更新）

```
1. 解析新版 ontology.yaml
2. 加载旧版 ontology.yaml（从版本库）
3. 计算 diff（新增/修改/删除的类、属性、关系、规则、动作）
4. 每步只生成差异部分：
   - Step 1: ALTER TABLE 而非 CREATE TABLE
   - Step 2: 只重新生成变更的工具
   - Step 3: 只同步变更的节点属性
   - Step 4: 只更新受影响的 Agent 配置
   - Step 5-7: 同理
5. 需人工确认的变更（删除列、类型变更）标记为 PENDING
6. 生成变更日志
```

### 部署流程

```
管道生成完成后，点击"部署到生产"：
1. 执行 PG 迁移脚本
2. 重新注册 MCP 工具（热更新，不重启服务）
3. 更新 Neo4j schema 并触发增量同步
4. 更新 Agent 工具绑定配置
5. 更新规则引擎配置
6. 前端类型文件写入代码仓库（触发 CI/CD）
7. 连接器映射模板更新
```
