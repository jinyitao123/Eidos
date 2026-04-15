# inocube 本体设计规范 · 实现篇

**YAML 结构标准与字段参考**

inocube 智能平台 · v1.2 · 2026.04

---

> *本文档是概念篇的实现配套。*
> *概念篇回答"本体是什么、怎么设计"。本文档回答"YAML 怎么写、每个字段什么类型、填错了会怎样"。*
> *产品经理用它来写本体定义。开发用它来实现管道生成器和服务。*

---

## 第一章 YAML 总体结构

### 1.1 结构总览

```yaml
ontology:
  # ── Ontology 级元信息 ──
  name: "设备运维"
  id: equipment_maintenance
  version: "1.0.0"
  description: "设备运维业务领域的完整本体定义"

  # ── 核心层（业务语义，存储无关） ──

  # Object Type 定义：每个类及其属性、规则、动作、函数
  classes:
    - id: equipment
      name: 设备
      attributes: [...]
      rules: [...]
      actions: [...]
      functions: [...]

    - id: work_order
      name: 工单
      attributes: [...]
      rules: [...]
      actions: [...]

  # Ontology 级元素：跨 Object Type 的定义
  relationships: [...]        # 类与类之间的关系
  interfaces: [...]           # 跨类的共享契约
  security: [...]             # 权限控制
  metrics: [...]              # 跨对象的聚合指标
  telemetry: [...]            # 设备遥测数据流定义
  business_qualifiers: [...]  # 业务限定词

  # ── 扩展层（工程配置，部署相关，可选） ──
  graph_config: {...}         # 图谱同步配置
  connector_hints: {...}      # 连接器映射提示
```

### 1.2 核心层与扩展层

核心层是业务语义定义，不包含任何特定存储技术的配置。一个核心层定义可以对接不同的存储方案而无需修改。核心层必填。

扩展层是与特定部署环境绑定的工程配置。没有扩展层的本体仍然是完整的业务语义定义。扩展层可选。

### 1.3 Object Type 级 vs Ontology 级

概念篇明确了三层概念：Ontology 包含多个 Object Type，Object Type 实例化为 Instance。YAML 结构反映这个层次：

**Object Type 级元素**（定义在 classes 的每个类内部）：属性、规则、动作、函数。它们归属于特定的 Object Type。

**Ontology 级元素**（定义在 classes 之外，与 classes 平级）：关系、接口、安全策略、指标、遥测、业务限定词。它们描述多个 Object Type 之间的联系或整体的分析视角。

### 1.4 通用命名规范

所有元素的 id 字段统一使用 snake_case，不含大写、中文、空格。中文名称使用业务公认术语，不造新词。

---

## 第二章 元素字段定义

### 2.1 元信息

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 本体名称（中文） |
| id | string | 是 | 本体ID（snake_case，全局唯一） |
| version | string | 是 | 语义化版本号（如 "1.0.0"） |
| description | string | 是 | 一句话描述本体的业务目标 |

---

### 2.2 类（Class）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | snake_case，全局唯一 |
| name | string | 是 | 中文名称 |
| description | string | 是 | 一句话定义 |
| first_citizen | boolean | 否 | 标记为设计起点。建议整个本体选择一个 |
| extends | string | 否 | 继承的接口ID或父类ID。v1.2 新增 |
| phase | enum | 否 | alpha / beta / full，默认 alpha |
| imported_from | string | 否 | 如从其他本体导入，填源本体ID |
| attributes | array | 是 | 属性列表 |
| rules | array | 否 | 规则列表 |
| actions | array | 否 | 动作列表 |
| functions | array | 否 | 函数列表 |
| unique_constraints | array | 否 | 复合唯一约束列表 |

**命名规范：** 类名必须是名词或名词短语。ID 如 `equipment`、`work_order`。

**phase 说明：**

| phase | 含义 |
|-------|------|
| alpha | Day-1 必须有，没有它核心流程跑不了 |
| beta | 3-6个月后加入，增强功能 |
| full | 12个月后，完整版本体 |

**复合唯一约束：**

```yaml
unique_constraints:
  - columns: [equipment_id, snapshot_month]
```

**extends 用法：**

```yaml
classes:
  - id: cnc_machine
    name: CNC机床
    extends: maintainable_asset  # 继承接口定义的属性
    attributes:
      # 继承自 maintainable_asset: location, status, last_maintenance_date
      # 本类特有：
      - id: spindle_speed
        name: 主轴转速
        type: integer
        unit: "rpm"
```

---

### 2.3 属性（Attribute）

属性定义在类的 attributes 数组内。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | snake_case，类内唯一 |
| name | string | 是 | 中文名称 |
| type | enum | 是 | 数据类型（见下表） |
| required | boolean | 否 | 是否必填，默认 false |
| unique | boolean | 否 | 是否唯一，默认 false |
| default | any | 否 | 默认值 |
| derived | string | 否 | 派生公式（非派生属性不填） |
| configurable | boolean | 否 | 是否客户可调参数，默认 false |
| is_metric | boolean | 否 | 是否为指标型属性，默认 false。v1.2 新增 |
| exposed | boolean | 否 | 是否对外可发现（能力声明），默认 false。v1.2 新增 |
| enum_values | array | 条件 | type=enum 时必填 |
| unit | string | 否 | 单位（如 "天"、"℃"、"rpm"） |
| value_range | string | 否 | 有效值范围（如 ">= 0"、"[1, 100]"） |
| phase | enum | 否 | alpha / beta / full |
| description | string | 否 | 补充说明 |
| display | object | 否 | 展示元数据（format、label） |

**数据类型：**

| type | 说明 |
|------|------|
| integer | 整数 |
| decimal | 小数 |
| string | 短文本（≤255） |
| text | 长文本 |
| boolean | 布尔值 |
| date | 日期 |
| datetime | 日期时间 |
| enum | 枚举（需配 enum_values） |

**属性分类：**

| 类别 | 特征 |
|------|------|
| 直接属性 | derived 为空，从数据源直接映射 |
| 派生属性 | derived 填公式，通过计算得出。required 不能为 true |

**is_metric 用法：** 标记该属性为指标型计算属性，在展示时可以单独归类呈现。

```yaml
- id: oee
  name: OEE
  type: decimal
  derived: "availability_rate * performance_rate * quality_rate"
  is_metric: true
  unit: "%"
```

**exposed 用法：** 标记该属性为对外可发现的能力声明。Agent 在做跨对象协作时，可以通过查询目标对象的 exposed 属性来了解对方的能力。

```yaml
- id: available_capacity
  name: 当前可用产能
  type: integer
  derived: "max_capacity - current_load"
  exposed: true
  unit: "件/小时"
```

**派生属性公式语法：**

| 语法 | 示例 |
|------|------|
| 同类引用 | `safety_stock - available_qty` |
| 跨关系引用 | `current_qty * [tracks].unit_price` |
| 聚合引用 | `SUM([located_in].inventory_value)` |
| 条件聚合 | `SUM([located_in].value WHERE is_stale = true)` |
| 条件表达式 | `CASE WHEN age_days > 365 THEN true ELSE false END` |
| 时间计算 | `DATEDIFF(days, last_date, NOW())` |
| 窗口计算 | `SUM(qty WHERE type='out' AND date > NOW()-'3M') / 3` |
| 空值保护 | `value / NULLIF(divisor, 0)` |

---

### 2.4 规则（Rule）

规则定义在类的 rules 数组内。结构为"触发→条件→动作"三段式。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | R01, R02, ... |
| name | string | 是 | 中文名称 |
| description | string | 是 | 自然语言描述 |
| phase | enum | 否 | alpha / beta / full |
| trigger | object | 是 | 触发方式 |
| condition | object | 是 | 判断条件 |
| action | object | 是 | 执行动作 |
| severity | enum | 是 | critical / warning / info |
| params | array | 否 | 可配置参数（configurable=true 的出现在管理员配置页） |

**触发方式（trigger.type）：**

| type | source 格式 | 说明 |
|------|------------|------|
| before_action | 动作ID列表 | 动作执行前拦截（可阻断） |
| after_action | 动作ID列表 | 动作执行后触发 |
| cron | cron 表达式 | 定时触发 |
| on_change | 类ID.属性ID | 属性值变更时触发 |

**执行动作（action.type）：**

| type | target 格式 | 说明 |
|------|------------|------|
| notify_agent | Agent ID | 通知指定 Agent |
| update_attribute | 类ID.属性ID | 更新属性值 |
| require_approval | 角色名 | 暂停执行，等待审批 |
| create_record | 类ID | 创建一条新记录 |

**严重等级：** critical = 阻断操作；warning = 通知不阻断；info = 仅记录。

---

### 2.5 动作（Action）

动作定义在类的 actions 数组内。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | A01, A02, ... |
| name | string | 是 | 中文名称（动词+宾语格式） |
| description | string | 是 | 一句话描述 |
| phase | enum | 否 | alpha / beta / full |
| exposed | boolean | 否 | 是否对外暴露为协作能力，默认 false。v1.2 新增 |
| params | array | 是 | 输入参数列表 |
| writes | array | 是 | 写回逻辑 |
| triggers_before | array | 否 | 执行前触发的规则ID列表 |
| triggers_after | array | 否 | 执行后触发的规则ID列表 |
| permission | object | 是 | 执行权限（roles + agents） |
| decision_log | boolean | 否 | 是否记录决策日志，默认 false |

**写回操作（writes.operation）：** update = 更新已有记录；create = 创建新记录。

**三级决策权限：**

| permission.mode | 适用场景 | 人的角色 |
|----------------|---------|---------|
| FULL_AUTO | 纯计算类（状态更新、指标重算） | 不参与，事后可审计 |
| AUTO_WITH_CONFIRM | 建议类（请购建议、优化清单） | 确认/修改/驳回 |
| ADVISORY | 高影响类（调整安全水位、资金决策） | 主动发起，系统只分析 |

**命名规范：** 动词+宾语格式，如"创建维修工单""调整运行参数"。

---

### 2.6 函数（Function）

函数定义在类的 functions 数组内。只读计算，不修改数据。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | snake_case |
| name | string | 是 | 中文名称 |
| description | string | 是 | 业务目的说明（不写实现细节） |
| phase | enum | 否 | alpha / beta / full |
| exposed | boolean | 否 | 是否对外暴露为协作能力，默认 false。v1.2 新增 |
| inputs | array | 是 | 输入参数 |
| output | object | 是 | 输出类型和字段 |

函数的 description 应写清楚业务目的和决策语境，让实现者理解意图。实现方式（sql / code / agent_delegated）属于工程层决策，不在本体定义中指定。

---

### 2.7 关系（Relationship）

关系定义在 Ontology 级的 relationships 数组内，与 classes 平级。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | snake_case |
| name | string | 是 | 中文名称（关系动词，如"位于"、"消耗"） |
| from | string | 是 | 起点类ID |
| to | string | 是 | 终点类ID |
| cardinality | enum | 是 | one_to_one / one_to_many / many_to_one / many_to_many |
| required | boolean | 否 | 起点是否必须有此关系，默认 false |
| phase | enum | 否 | alpha / beta / full |
| description | string | 否 | 补充说明 |
| edge_attributes | array | 否 | 边属性（关系本身携带数据时使用） |

**命名规范：** 使用动词短语，明确方向性。from 是主动方，to 是被动方。选择最自然的业务阅读方向：「设备 消耗 备件」而不是「备件 被消耗于 设备」。

**关系的两层语义（v1.2 说明）：** 关系定义描述的是 Object Type 之间的语义关系——"设备"这个类跟"备件"这个类之间存在"消耗"关系。运行时，每条关系会实例化为具体 Instance 之间的关联——"3号CNC机床 消耗 轴承6205"。关系定义是结构，实例关联是数据。

**自引用关系：** 当 from 和 to 指向同一个类时（如"备件可替代备件"），需在描述中标注为自引用。

---

### 2.8 接口（Interface）

接口定义在 Ontology 级的 interfaces 数组内。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | snake_case |
| name | string | 是 | 中文名称 |
| description | string | 是 | 描述 |
| attributes | array | 是 | 实现此接口的类必须包含的属性 |
| actions | array | 否 | 实现此接口的类可以执行的动作 |
| implemented_by | array | 是 | 实现此接口的类ID列表 |

类通过 `extends` 字段引用接口ID来实现接口。实现接口的类必须包含接口定义的所有属性，并可扩展特有属性。

---

### 2.9 安全策略（Security）

安全策略定义在 Ontology 级的 security 节点内。

**三级权限：**

```yaml
security:
  object_level:
    - class: equipment
      rule: "user.factory_scope CONTAINS obj.factory_ref"
      description: "用户只能访问所属工厂的设备"

  attribute_level:
    - class: equipment
      attribute: maintenance_cost
      visible_to: [maintenance_manager, finance]

  action_level:
    - action: A03
      executable_by:
        roles: [procurement_manager]
        agents: [inventory_agent]
```

---

### 2.10 指标（Metric）

跨对象的聚合指标定义在 Ontology 级的 metrics 数组内。归属明确的指标放在类的属性中标记 `is_metric: true`。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | snake_case |
| name | string | 是 | 中文名称 |
| description | string | 是 | 业务含义说明 |
| phase | enum | 否 | alpha / beta / full |
| kind | enum | 是 | aggregate / classification / composite |
| formula | string | 条件 | 计算公式（classification 不填，用 buckets） |
| source_entities | array | 是 | 参与计算的类ID列表 |
| params | array | 否 | 可配置参数 |
| dimensions | array | 否 | 支持的分析维度 |
| granularity | enum | 否 | system / warehouse / position 等 |
| depends_on | array | 否 | 依赖声明 |
| status | enum | 否 | designed / implemented / undefined |
| known_issues | array | 否 | 已知问题 |
| tool | string | 否 | 绑定的MCP工具名称 |
| buckets | array | 条件 | kind=classification 时必填 |

**指标类型：**

| kind | formula | buckets | 用途 |
|------|---------|---------|------|
| aggregate | 必填 | 不填 | 数值聚合（如呆滞率、风险数） |
| classification | 不填 | 必填 | 分桶分类（如四象限、ABC分类） |
| composite | 必填 | 不填 | 多子指标加权（如健康分） |

**桶定义示例：**

```yaml
buckets:
  - id: high_risk
    name: 高风险
    condition: "failure_count > 3 AND criticality = 'A'"
    description: 故障频发且关键等级高的设备
```

**依赖声明：**

```yaml
depends_on:
  - { type: attribute, ref: "equipment.failure_count" }
  - { type: metric, ref: equipment_availability }
  - { type: rule_param, ref: "R01.threshold" }
```

**实现状态：** designed = 已设计未实现；implemented = 已实现；undefined = 公式未确定，Agent 不应编造数值。

---

### 2.11 遥测（Telemetry）

遥测定义在 Ontology 级的 telemetry 数组内。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | snake_case |
| name | string | 是 | 中文名称 |
| description | string | 是 | 业务含义说明 |
| phase | enum | 否 | alpha / beta / full |
| source_class | string | 是 | 数据来源的类ID |
| source_filter | string | 否 | 来源过滤条件 |
| value_type | enum | 是 | integer / decimal / boolean / string |
| unit | string | 否 | 物理单位 |
| sampling | string | 是 | 采样周期（如 "1s"、"1min"） |
| normal_range | array | 否 | 正常值范围 [min, max] |
| warning_threshold | number | 否 | 预警阈值 |
| alert_threshold | number | 否 | 告警阈值 |
| reference_standard | string | 否 | 参考标准（如 "ISO 10816"） |
| aggregations | array | 否 | 支持的聚合方式（avg / max / min / rms / p95 等） |
| context_strategy | object | 否 | Agent 查询此遥测时的默认策略 |
| status | enum | 否 | designed / implemented / undefined |

**上下文策略：**

```yaml
context_strategy:
  default_window: "1h"
  max_window: "24h"
  default_aggregation: "avg"
  default_granularity: "5min"
```

---

### 2.12 业务限定词（Business Qualifiers）

```yaml
business_qualifiers:
  - id: stale
    name: 呆滞
    filter:
      entity: inventory_position
      expression: "is_stale = true"
```

---

### 2.13 扩展层：图谱配置（Graph Config）

可选。配置本体数据在图数据库中的同步策略。

```yaml
graph_config:
  sync_attributes:
    equipment: [status, criticality, failure_count]
    work_order: [priority, status]
  archive_events_after_days: 90
  structure_sync: on_publish
  status_sync: { strategy: "incremental", interval: "5min" }
  event_sync: realtime
  nodes_not_in_graph: [inventory_snapshot]
```

---

### 2.14 扩展层：连接器映射提示（Connector Hints）

可选。为连接器配置提供映射骨架。

| 映射状态 | 说明 |
|---------|------|
| mapped | 已映射到源系统字段 |
| unmapped | 未映射，需手动配置 |
| derived_no_source | 派生属性，无源字段 |

---

## 第三章 校验规则

### 3.1 格式校验（阻断保存）

- 所有 id 为 snake_case，不含大写、中文、空格
- 所有引用的类ID存在于 classes 中
- 所有引用的属性ID存在于对应类中
- enum 类型必须有 enum_values
- 派生属性的 required 不能为 true
- 关系的 from/to 必须引用已定义的类
- 动作的 triggers_before/after 必须引用已定义的规则
- 指标的 source_entities 必须引用已定义的类
- 指标 kind=classification 时必须有 buckets
- 指标 kind=aggregate/composite 时必须有 formula
- 遥测的 source_class 必须引用已定义的类
- unique_constraints 的 columns 必须引用该类已定义的属性ID
- extends 引用的接口ID必须存在于 interfaces 中

### 3.2 语义校验（警告，不阻断）

- 标记为 first_citizen 的类属性数建议 ≥ 10
- 无孤立类（每个类至少参与一个关系）
- 每个非派生可写属性至少被一个动作覆盖
- 每个规则至少有一个触发源
- 枚举状态字段的转换覆盖率
- 指标的 depends_on 引用的属性/指标/规则参数存在
- status=undefined 的指标应有 known_issues
- 遥测的 warning_threshold < alert_threshold
- classification 类型指标的 buckets 应互斥且完整覆盖
- 实现接口的类必须包含接口定义的所有属性

### 3.3 跨本体校验

当多个本体共享类时：

- 共享类的属性定义必须兼容（同名属性类型一致）
- 共享类的关系语义必须一致
- 通过 Interface 保证公共契约

---

## 第四章 版本管理

### 4.1 版本号规范

采用语义化版本号 MAJOR.MINOR.PATCH：

| 变更类型 | 版本变化 | 示例 |
|---------|---------|------|
| 新增类/属性/关系/规则/动作/指标/遥测 | MINOR +1 | 1.0.0 → 1.1.0 |
| 修改属性类型、删除类或关系 | MAJOR +1 | 1.1.0 → 2.0.0 |
| 修复描述、调整默认值 | PATCH +1 | 1.1.0 → 1.1.1 |

### 4.2 增量发布

发布新版本时，管道生成器只生成差异部分。破坏性变更（删除列、类型变更）需人工确认后才执行。

### 4.3 回滚

支持一键回滚到任意已发布版本。回滚操作会重新运行管道，用旧版本定义重新生成所有下游代码。

---

## 附：v1.2 相对 v1.1 的变更记录

| 变更项 | 变更内容 | 变更原因 |
|-------|---------|---------|
| 文档拆分 | 概念解释、设计原则、方法论移至概念篇和方法论文档 | 实现篇只保留 YAML 参考 |
| YAML 结构（1.1） | 明确 Object Type 级和 Ontology 级的分层 | 对齐概念篇的三层概念 |
| 类定义（2.2） | 新增 extends 字段 | 支持继承接口或父类 |
| 类定义（2.2） | first_citizen 改为建议标记，不再要求"有且仅有一个" | 复杂场景下多角色可能关注不同对象 |
| 属性定义（2.3） | 新增 is_metric 字段 | 标记对象级指标型属性 |
| 属性定义（2.3） | 新增 exposed 字段 | 标记对外可发现的能力声明 |
| 动作定义（2.5） | 新增 exposed 字段 | 标记对外暴露的协作能力 |
| 函数定义（2.6） | 新增 exposed 字段 | 同上 |
| 关系定义（2.7） | 增加两层语义说明 | 区分 Object Type 间关系和 Instance 间关联 |
| 规则和动作 | 归属从 Ontology 级调整为 Object Type 级（类内部定义） | 会议共识：规则和动作归属于特定的本体对象 |
| 校验规则（3.1） | 新增 extends 引用校验 | 配合新增字段 |

---

*inocube 本体设计规范 · 实现篇 · v1.2 · 2026.04*
