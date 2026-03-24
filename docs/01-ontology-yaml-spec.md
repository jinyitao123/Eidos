# 本体 YAML 格式规范

**ontology.yaml 的完整结构定义**

---

## 顶层结构

```yaml
ontology:
  name: string                    # 本体名称（中文）
  id: string                      # 本体ID（snake_case）
  version: string                 # 语义化版本号 "1.0.0"
  description: string             # 一句话描述
  scene_analysis_ref: string      # 关联的场景分析文件路径（可选）

  classes: []                     # 类定义列表
  relationships: []               # 关系定义列表
  rules: []                       # 规则定义列表
  actions: []                     # 动作定义列表
  functions: []                   # 函数定义列表
  interfaces: []                  # 接口定义列表（beta）
  security: {}                    # 安全策略定义（beta）
  graph_config: {}                # 图谱配置
  connector_hints: []             # 连接器映射提示（可选）
```

---

## classes —— 类定义

```yaml
classes:
  - id: string                    # snake_case，全局唯一
    name: string                  # 中文名
    description: string           # 一句话描述
    first_citizen: boolean        # 是否第一公民（整个本体只有一个 true）
    phase: enum                   # alpha / beta / full
    imported_from: string|null    # 如果从其他本体导入，填源本体ID（如 "spare_parts"）

    attributes:
      - id: string                # snake_case，类内唯一
        name: string              # 中文名
        type: enum                # 见「属性类型」
        required: boolean         # 是否必填，默认 false
        unique: boolean           # 是否唯一，默认 false
        default: any|null         # 默认值
        derived: string|null      # 派生公式（null = 非派生）
        graph_sync: boolean       # 是否同步到 Neo4j，默认 false
        configurable: boolean     # 是否客户可调参数，默认 false
        enum_values: string[]     # 仅 type=enum 时必填
        unit: string|null         # 单位（如 "days"、"元"、"个"）
        phase: enum               # alpha / beta / full
        description: string|null  # 补充说明
```

### 属性类型

| type | 说明 | PG 映射 | Go 映射 | TS 映射 |
|---|---|---|---|---|
| `integer` | 整数 | `INTEGER` | `int` | `number` |
| `decimal` | 小数 | `DECIMAL(18,4)` | `float64` | `number` |
| `string` | 短文本（<=255） | `VARCHAR(255)` | `string` | `string` |
| `text` | 长文本 | `TEXT` | `string` | `string` |
| `boolean` | 布尔 | `BOOLEAN` | `bool` | `boolean` |
| `date` | 日期 | `DATE` | `time.Time` | `string` (ISO) |
| `datetime` | 日期时间 | `TIMESTAMP` | `time.Time` | `string` (ISO) |
| `enum` | 枚举 | `VARCHAR(50)` + CHECK | `string` | union type |

### 派生属性公式语法

```
# 同类属性引用：直接写属性ID
safety_stock - available_qty

# 跨关系引用：[关系ID].属性ID
current_qty * [tracks].unit_price

# 聚合引用：AGG([关系ID].属性ID)，AGG = SUM / AVG / COUNT / MAX / MIN
SUM([located_in].inventory_value)

# 条件表达式
CASE WHEN stale_age_days > 365 THEN true ELSE false END

# 时间计算
DATEDIFF(days, last_consumed_date, NOW())

# 窗口计算（近N天/月）
SUM(movements.quantity WHERE movement_type='out' AND movement_date > NOW() - INTERVAL '3 months') / 3
```

管道生成器将公式翻译为 PG GENERATED ALWAYS AS（简单公式）或定时计算任务（复杂公式）。

---

## relationships —— 关系定义

```yaml
relationships:
  - id: string                    # snake_case
    name: string                  # 中文名（关系动词，如"跟踪"、"位于"）
    from: string                  # 起点类ID
    to: string                    # 终点类ID
    cardinality: enum             # one_to_one / one_to_many / many_to_one / many_to_many
    required: boolean             # 起点是否必须有此关系，默认 false
    phase: enum
    description: string|null
    edge_attributes:              # 边属性（可选，仅关系本身有数据时用）
      - id: string
        name: string
        type: enum                # 同属性类型
        description: string|null
```

### cardinality 说明

| 值 | 含义 | PG 实现 |
|---|---|---|
| `one_to_one` | from 端一个对应 to 端一个 | from 表加 UNIQUE 外键 |
| `one_to_many` | from 端一个对应 to 端多个 | to 表加外键指向 from |
| `many_to_one` | from 端多个对应 to 端一个 | from 表加外键指向 to |
| `many_to_many` | 多对多 | 独立关联表 |

---

## rules —— 规则定义

```yaml
rules:
  - id: string                    # R01, R02, ...
    name: string
    description: string           # 自然语言描述
    phase: enum

    trigger:
      type: enum                  # before_action / after_action / cron / on_change
      source: string              # 动作ID列表（逗号分隔）/ cron表达式 / 类.属性

    condition:
      entity: string              # 判断所在的类ID
      expression: string          # 条件表达式，如 "safety_gap > 0"

    action:
      type: enum                  # notify_agent / update_attribute / require_approval / create_record
      target: string              # Agent ID / 类.属性 / 审批角色 / 目标类
      value: string|null          # 更新值（update_attribute 时）

    severity: enum                # critical / warning / info
    
    params:                       # 可配置参数
      - id: string
        name: string
        type: enum
        default: any
        configurable: boolean     # 客户可在管理后台调整
```

### trigger.type 说明

| type | source 格式 | 说明 |
|---|---|---|
| `before_action` | `A01,A04` | 动作执行前拦截（可阻断） |
| `after_action` | `A01,A02` | 动作执行后触发（反应型） |
| `cron` | `0 0 1 * *` | cron 表达式（定时） |
| `on_change` | `inventory_position.current_qty` | 属性值变更时触发 |

### action.type 说明

| type | target 格式 | 说明 |
|---|---|---|
| `notify_agent` | Agent ID | 通知指定 Agent |
| `update_attribute` | `类ID.属性ID` | 更新属性值 |
| `require_approval` | 角色名 | 暂停执行，等待审批 |
| `create_record` | 类ID | 创建一条新记录 |

---

## actions —— 动作定义

```yaml
actions:
  - id: string                    # A01, A02, ...
    name: string
    description: string
    phase: enum

    params:
      - id: string
        name: string
        type: enum
        required: boolean

    writes:                       # 写回逻辑
      - target: string            # 类ID.属性ID（更新）或 类ID（创建）
        operation: enum           # update / create
        expression: string|null   # 更新表达式（update 时），如 "current_qty - quantity"

    triggers_before: [string]     # 执行前触发的规则ID列表
    triggers_after: [string]      # 执行后触发的规则ID列表

    permission:
      roles: [string]             # 可执行的角色
      agents: [string]            # 可执行的 Agent ID

    decision_log: boolean         # 是否记录决策日志，默认 false（require_approval 的动作默认 true）
```

---

## functions —— 函数定义

封装复杂只读计算逻辑。管道生成为只读 MCP 工具。

```yaml
functions:
  - id: string                    # snake_case
    name: string
    description: string
    phase: enum

    inputs:
      - id: string
        type: enum
        required: boolean
        default: any|null

    output:
      type: enum                  # primitive（integer/decimal/string/boolean）或 object
      fields:                     # type=object 时
        - id: string
          type: enum
          description: string

    implementation: enum          # sql / go / agent_delegated
    body: string|null             # SQL 片段或函数签名（implementation=agent_delegated 时为自然语言描述）
```

---

## interfaces —— 接口定义（beta）

定义跨类共享的属性和能力契约。

```yaml
interfaces:
  - id: string                    # snake_case
    name: string
    description: string
    phase: enum                   # 最早 beta

    attributes:                   # 实现此接口的类必须包含这些属性
      - id: string
        name: string
        type: enum

    actions:                      # 实现此接口的类可以执行这些动作
      - action_id: string

    implemented_by: [string]      # 实现此接口的类ID列表
```

---

## security —— 安全策略（beta）

```yaml
security:
  object_level:                   # 对象级权限
    - class: string               # 类ID
      rule: string                # 权限表达式
      description: string

  attribute_level:                # 属性级权限
    - class: string
      attribute: string           # 属性ID
      visible_to: [string]        # 可见角色列表
      description: string

  action_level:                   # 动作级权限（与 actions.permission 等效，这里是汇总视图）
    - action: string
      executable_by:
        roles: [string]
        agents: [string]
```

---

## graph_config —— 图谱配置

```yaml
graph_config:
  archive_events_after_days: integer    # 事件层节点归档天数，默认 90
  structure_sync: enum                  # on_publish / daily（结构层同步时机）
  status_sync:
    primary: enum                       # daily_batch / realtime（一级库）
    secondary: enum                     # daily_batch / realtime（二级库）
  event_sync: enum                      # daily_batch / realtime
  nodes_not_in_graph: [string]          # 不入图的类ID列表（如 inventory_snapshot）
```

---

## connector_hints —— 连接器映射提示

给连接器配置提供映射骨架。管道生成器从 classes 自动生成。

```yaml
connector_hints:
  - class_id: string
    attributes:
      - attribute_id: string
        source_hint: string|null        # 源系统参考字段名（如 "MENGE"）
        mapping_status: enum            # mapped / unmapped / derived_no_source
```

---

## 校验规则

本体 YAML 保存时必须通过以下校验：

### 格式校验（阻断保存）

- 所有 id 字段为 snake_case，不含大写、中文、空格
- 所有引用的类ID存在于 classes 中
- 所有引用的属性ID存在于对应类中
- enum 类型必须有 enum_values
- first_citizen=true 的类全局只有一个
- 关系的 from 和 to 不能相同（自引用除外，自引用需标注）
- 派生属性的 required 不能为 true（派生值不由用户填写）

### 语义校验（警告，不阻断）

- 第一公民属性数 >= 10
- 无孤立类
- 每个非派生可写属性至少被一个动作覆盖
- 规则条件引用的属性如果标记 graph_sync=true 则通过图谱评估，否则通过 PG 评估
- 状态枚举的转换覆盖率
