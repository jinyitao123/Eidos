# 本体 YAML 格式规范

**ontology.yaml 的完整结构定义**

---

## 设计定位

Ontology YAML 是异构数据源和 Agent 之间的**语义契约**。它只定义"是什么"和"什么意思"，不管"怎么存"和"怎么算"。

各专业服务（关系型数据库、时序数据库、图数据库、IoT 平台、计算引擎）通过 MCP 工具暴露能力，Ontology 定义这些能力的语义。Agent 只认识 Ontology 描述的语义世界。

**不在 YAML 中出现的内容：**
- 存储选型和同步策略（哪个属性存在哪个数据库）
- 计算实现方式（用 SQL 还是 Go 还是 LLM）
- 数据源映射和连接器配置
- 基础设施参数（归档天数、同步频率）

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
  metrics: []                     # 指标定义列表
  telemetry: []                   # 遥测数据流定义列表
  rules: []                       # 规则定义列表
  actions: []                     # 动作定义列表
  functions: []                   # 函数定义列表（决策辅助型）
  interfaces: []                  # 接口定义列表（beta）
  security: {}                    # 安全策略定义（beta）
```

### 七类语义元素

| 元素 | 回答的问题 | 例子 |
|------|-----------|------|
| Classes | 世界里有什么东西，它们有什么特征 | 库存头寸、备件、设备 |
| Relationships | 这些东西之间什么关系 | 头寸位于库房、设备使用备件 |
| Metrics | 用什么口径衡量这些东西的状态 | 呆滞率、库存四象限、可释放金额 |
| Telemetry | 世界持续产生什么可观测数据流 | 电机振动、电机温度、液压压力 |
| Rules | 什么条件下触发什么动作 | 安全缺口 > 0 → 通知管家 |
| Actions | 可以对这些东西做什么 | 记录出库、生成请购建议 |
| Functions | 需要什么决策辅助判断 | 计算补货点、评估呆滞处置方案 |

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
        configurable: boolean     # 是否客户可调参数，默认 false
        enum_values: string[]     # 仅 type=enum 时必填
        unit: string|null         # 单位（如 "days"、"元"、"个"）
        value_range: string|null  # 值域描述（如 ">= 0"、"0-100"）
        phase: enum               # alpha / beta / full
        description: string|null  # 补充说明（业务含义，给 Agent 看）
```

### 属性类型

| type | 说明 |
|------|------|
| `integer` | 整数 |
| `decimal` | 小数 |
| `string` | 短文本（<=255） |
| `text` | 长文本 |
| `boolean` | 布尔 |
| `date` | 日期 |
| `datetime` | 日期时间 |
| `enum` | 枚举 |

> 类型到具体存储的映射（PG、Go、TS 等）由 pipeline 的存储插件负责，不在本体规范中定义。

### 派生属性公式语法

派生属性描述的是**单个实体上的固有计算口径**——这个属性的值怎么从同实体或直接关联实体的其他属性推导出来。

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

### derived 和 metrics 的边界

- **derived**：单实体的固有属性。"这个头寸的可用数量 = 当前数量 - 预留数量"——这是头寸本身的特征。
- **metrics**：跨实体的聚合度量，或有独立业务口径的分析指标。"全仓库呆滞率 = 呆滞金额 / 总金额"——这不是任何一个实体的属性，而是一种**衡量视角**。

判断原则：如果一个值"属于"某个实体实例 → `derived`；如果一个值是"观察"多个实体得出的 → `metrics`。

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

| 值 | 含义 |
|---|---|
| `one_to_one` | from 端一个对应 to 端一个 |
| `one_to_many` | from 端一个对应 to 端多个 |
| `many_to_one` | from 端多个对应 to 端一个 |
| `many_to_many` | 多对多 |

---

## metrics —— 指标定义

指标是本体的第三类语义元素。它定义**用什么口径衡量实体的状态**，是 Agent 理解和分析业务的基础。

指标不是存储的数据，也不是计算的代码——它是口径的**语义声明**。"怎么算"由 pipeline 生成的工具负责，"算出来存哪里"由下游存储服务负责。

### 为什么需要独立的 metrics 节点

在 Agent-Native 系统中，指标口径的缺失会导致三个问题：
1. **Agent 被追问时答不上来**——管理者问"呆滞率怎么算的"，Agent 只有一个数字，没有口径
2. **Agent 跨工具调用时口径不一致**——不同工具对同一概念用不同假设
3. **Agent 编造不存在的指标**——设计文档写了"断货概率 12%"，但没有计算方法，Agent 会凭空编造

### 指标结构

```yaml
metrics:
  - id: string                    # snake_case
    name: string                  # 中文名
    description: string           # 业务口径说明（给 Agent 和业务用户看）
    phase: enum                   # alpha / beta / full

    kind: enum                    # aggregate / composite / classification

    formula: string               # 计算公式

    source_entities: [string]     # 计算涉及的类ID列表

    params:                       # 口径中的可配置参数
      - id: string
        name: string
        type: enum
        default: any
        configurable: boolean     # 客户可在管理后台调整
        description: string

    dimensions: [string]          # 可切分的维度（类ID，如 warehouse, category）
    granularity: enum             # 默认粒度：system / warehouse / position / equipment

    depends_on:                   # 依赖的其他指标、属性或遥测（口径变更可追溯）
      - type: enum                # metric / attribute / rule_param / telemetry
        ref: string               # 指标ID / 类ID.属性ID / 规则ID.参数ID / 遥测ID

    status: enum                  # implemented / designed / undefined
    tool: string|null             # 返回此指标的 MCP 工具名（status=implemented 时）
    known_issues: [string]        # 已知问题（如"参数未生效"、"与设计文档定义不一致"）
```

### kind 说明

| kind | 说明 | 例子 |
|------|------|------|
| `aggregate` | 对实体属性的聚合计算 | 呆滞率 = SUM(value WHERE stale) / SUM(value) |
| `composite` | 由多个子指标加权/组合而成 | 健康分 = 100 - 金额偏离扣分 - 呆滞扣分 - 风险扣分 |
| `classification` | 将实体按条件分到多个类别中 | 库存四象限：活库存 / 安全储备 / 可优化过剩 / 呆滞沉淀 |

### classification 类型的扩展字段

当 `kind: classification` 时，用 `buckets` 替代 `formula`：

```yaml
metrics:
  - id: inventory_quadrant
    name: 库存结构四象限
    kind: classification

    buckets:
      - id: active
        name: 活库存
        condition: "近3月有消耗 且 current_qty <= safety_stock * 2"
        description: 正在流转支撑生产的库存，不可削减

      - id: safety_reserve
        name: 安全储备
        condition: "criticality = 'A' 且 (typical_lead_time > 30 或 停机损失极高)"
        description: 关键件的保险储备，削减有风险

      - id: optimizable_excess
        name: 可优化过剩
        condition: "current_qty > safety_stock * 2 且 不属于 safety_reserve"
        description: 优化主战场，可安全释放

      - id: stale_sunk
        name: 呆滞沉淀
        condition: "is_stale = true"
        description: 长期无消耗的沉淀库存，需处置

    output: enum                  # 每个实体被分配到哪个 bucket
    source_entities: [inventory_position]
```

### 指标示例

```yaml
metrics:
  - id: stale_ratio
    name: 呆滞率
    description: 呆滞库存金额占总库存金额的比例，反映库存资金的沉淀程度
    phase: alpha
    kind: aggregate
    formula: "SUM(inventory_value WHERE is_stale = true) / SUM(inventory_value)"
    source_entities: [inventory_position]
    params:
      - id: stale_threshold_days
        name: 呆滞判定天数
        type: integer
        default: 365
        configurable: true
        description: 库龄超过此天数且无消耗的头寸被判定为呆滞
    dimensions: [warehouse, category]
    granularity: system
    depends_on:
      - { type: attribute, ref: "inventory_position.is_stale" }
      - { type: attribute, ref: "inventory_position.inventory_value" }
      - { type: rule_param, ref: "R03.threshold" }
    status: implemented
    tool: get_inventory_health
```

---

## telemetry —— 遥测数据流定义

遥测是本体的第四类语义元素。它定义**实体持续产生的可观测时序数据流**——传感器读数、设备状态、环境监测等连续的物理观测。

遥测不是存储配置，也不是采集方案——它是数据流的**语义声明**。"数据存在哪里"由时序存储服务负责，"怎么采集"由 IoT 连接服务负责。

### 为什么需要独立的 telemetry 节点

在 Agent-Native 系统中，遥测数据流的语义缺失会导致三个问题：

1. **Agent 不知道有什么可观测数据**——设备有温度、振动、电流，Agent 靠什么发现？没有语义定义就只能猜，或者编造不存在的数据流
2. **Agent 无法判断异常**——振动值 4.5 mm/s² 是正常还是危险？没有 normal_range 和 alert_threshold，Agent 的分析就是幻觉
3. **Agent 查询时上下文爆炸**——30 天的秒级数据有 260 万个点，远超上下文窗口。没有 context_strategy，Agent 要么查太多撑爆，要么查太少漏掉异常

### 遥测与属性的区别

| 维度 | 普通属性（attribute） | 遥测数据流（telemetry） |
|------|---------------------|----------------------|
| 数据形态 | 单个值（当前状态） | 时间序列（连续观测） |
| 更新频率 | 业务操作触发 | 传感器自动、秒级/分钟级 |
| 数据量 | 每个实体一个值 | 每个实体每天数万到数十万个点 |
| 存储 | 关系型数据库 | 时序数据库 |
| Agent 消费方式 | 直接读取 | 必须先聚合降采样 |

### 遥测与指标的关系

```
telemetry（原始观测）
  ↓ 聚合/计算
metrics（业务度量）
  ↓ 触发
rules（业务规则）
  ↓ 驱动
actions（业务动作）
```

一个 metric 可以 `depends_on` 一个或多个 telemetry。例如：`motor_vibration`（遥测）→ `vibration_health_score`（指标）→ `R-PM01 预测性维护告警`（规则）。

### 遥测结构

```yaml
telemetry:
  - id: string                      # snake_case 唯一标识
    name: string                    # 中文名称
    description: string             # 业务含义（给 Agent 读的，应包含判断基准和行业标准）
    phase: enum                     # alpha / beta / full

    # ── 数据源语义 ──
    source_class: string            # 哪个实体类产生此数据流
    source_filter: string|null      # 可选：哪类实例才有此数据流（如 "category = '旋转设备'"）
    value_type: enum                # decimal / integer / boolean / string
    unit: string                    # 度量单位
    dimensions:                     # 数据维度（如振动的 x/y/z 轴）
      - id: string
        values: [string]
    sampling: string                # 语义采样频率（1s / 10s / 1m / 1h）

    # ── 语义锚点 ──
    normal_range: [number, number]|null   # 正常范围（Agent 判断正常/异常的基准）
    warning_threshold: number|null        # 预警线
    alert_threshold: number|null          # 告警线
    reference_standard: string|null       # 参照标准（如 ISO 10816、GB/T 755）

    # ── Agent 查询策略 ──
    aggregations: [string]          # Agent 可请求的聚合方式：avg / max / min / sum / rms / stddev / count / diff
    context_strategy:               # Agent 获取此时序数据时的默认减量策略
      default_window: string        # 默认查询时间窗口（如 7d）
      max_window: string            # 最大可查时间窗口（如 90d）
      default_aggregation: string   # 默认聚合方式（如 avg）
      default_granularity: string   # 默认降采样粒度（如 1h）
    retention: string               # 语义层面的数据保留周期（如 90d）

    # ── 工具绑定和状态 ──
    tool: string|null               # Agent 调用的查询工具
    status: enum                    # implemented / designed / undefined
    known_issues: [string]|null     # 已知问题
```

### context_strategy 说明

`context_strategy` 是防止上下文爆炸的关键机制。它定义了 Agent 在不明确指定查询参数时的安全默认行为：

| 字段 | 说明 | 示例 |
|------|------|------|
| `default_window` | Agent 不指定时间范围时的默认值 | `7d` → 7天 × 24小时 = 168 个点 |
| `max_window` | 硬限制，超过则拒绝或自动降粒度 | `90d` → 最多查 90 天 |
| `default_aggregation` | Agent 不指定聚合方式时的默认值 | `rms` / `avg` |
| `default_granularity` | Agent 不指定降采样粒度时的默认值 | `1h` → 按小时聚合 |

上下文 token 预算参考：

| 查询方式 | 数据点数 | 约 token |
|----------|---------|---------|
| 概览（7天 × 日粒度） | 7 | ~50 |
| 趋势（30天 × 小时粒度） | 720 | ~2,500 |
| 诊断（24小时 × 10分钟粒度） | 144 | ~500 |
| 极端（90天 × 小时粒度） | 2,160 | ~7,500 |

### 遥测示例

```yaml
telemetry:
  - id: motor_vibration
    name: 电机振动
    description: >
      电机轴承座振动加速度，反映轴承磨损程度。
      是预测性维护的核心观测指标。
      ISO 10816：< 4.5 良好，4.5-7.1 可接受，> 7.1 需关注，> 11.2 危险。
    phase: alpha
    source_class: equipment
    source_filter: "category = '旋转设备'"
    value_type: decimal
    unit: mm/s²
    dimensions:
      - id: axis
        values: [x, y, z]
    sampling: 1s
    normal_range: [0, 4.5]
    warning_threshold: 7.1
    alert_threshold: 11.2
    reference_standard: ISO 10816
    aggregations: [avg, max, rms, stddev]
    context_strategy:
      default_window: 7d
      max_window: 90d
      default_aggregation: rms
      default_granularity: 1h
    retention: 90d
    tool: query_telemetry
    status: designed

  - id: motor_temperature
    name: 电机温度
    description: >
      电机定子绕组温度。B级绝缘限值 130°C，超过需立即停机。
      持续高温（> 100°C）加速绝缘老化，缩短电机寿命。
    phase: alpha
    source_class: equipment
    source_filter: "category = '旋转设备'"
    value_type: decimal
    unit: °C
    sampling: 10s
    normal_range: [20, 85]
    warning_threshold: 100
    alert_threshold: 130
    reference_standard: GB/T 755
    aggregations: [avg, max, min]
    context_strategy:
      default_window: 7d
      max_window: 180d
      default_aggregation: avg
      default_granularity: 1h
    retention: 180d
    tool: query_telemetry
    status: designed
```

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

函数封装**决策辅助型**的复杂只读逻辑——需要推理、判断、多因素权衡的计算，不适合用公式表达。

> **functions 与 metrics 的区别：** metrics 定义的是"怎么衡量"（口径确定、可机械计算），functions 定义的是"怎么判断"（需要推理、输出建议或方案）。例如"呆滞率"是 metric（公式确定），"呆滞处置方案推荐"是 function（需要权衡多种因素）。

```yaml
functions:
  - id: string                    # snake_case
    name: string
    description: string           # 这个函数做什么判断、给出什么建议
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
```

> 函数的实现方式（SQL / Go / LLM 推理）不在本体中声明。pipeline 根据函数的复杂度和输出结构决定生成策略。

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
- metrics 的 source_entities 引用的类ID必须存在
- metrics 的 depends_on 引用的指标/属性/参数必须存在
- classification 类型的 metrics 必须有 buckets 字段
- telemetry 的 source_class 引用的类ID必须存在
- telemetry 的 context_strategy 必须包含 default_window、max_window、default_aggregation、default_granularity
- telemetry 的 aggregations 不能为空

### 语义校验（警告，不阻断）

- 第一公民属性数 >= 10
- 无孤立类（没有任何关系的类）
- 每个非派生可写属性至少被一个动作覆盖
- 规则条件引用的属性存在于对应类中
- 状态枚举的转换覆盖率
- metrics 中 status=implemented 的指标应有 tool 字段
- metrics 中 status=undefined 的指标应在 known_issues 中说明原因
- 指标的 params 与关联 rule 的 params 一致性（如 stale_ratio 的 stale_threshold_days 应与 R03.threshold 一致）
- telemetry 中 status=implemented 的数据流应有 tool 字段
- telemetry 的 alert_threshold 应有对应的 rule 定义（否则告警无法触发）
