# 遥测时序数据的语义化问题

**从设备运维场景出发，讨论 Agent-Native 架构下时序数据的语义契约设计**

---

## 1. 问题的由来

客户看完备件管理 demo 后问了一个直击要害的问题：

> "你们的 Agent 是怎么处理历史数据和基于时序数据进行分析的？"

这个问题暴露了当前本体设计的一个结构性缺口。我们的本体能描述"世界由哪些实体组成"（classes）、"实体之间什么关系"（relationships）、"怎么衡量这个世界"（metrics），但无法描述**"这个世界持续产生的可观测数据流"**。

设备运维场景是时序数据的主战场：

| 数据类型 | 例子 | 频率 | 量级 |
|---|---|---|---|
| 振动 | 电机轴承座三轴振动加速度 | 1秒 | 每台设备 ~86,400 点/天 |
| 温度 | 定子绕组温度、轴承温度 | 10秒 | ~8,640 点/天 |
| 电流 | 运行电流、启动电流 | 1秒 | ~86,400 点/天 |
| 压力 | 液压系统压力 | 5秒 | ~17,280 点/天 |
| 转速 | 主轴转速 | 1秒 | ~86,400 点/天 |

一个有 200 台关键设备、每台 5 个传感器的工厂，每天产生约 **8600 万个数据点**。这些数据是设备运维 Agent 做预测性维护、故障诊断、健康评估的基础——但 Agent 不可能直接消化这些数据。

---

## 2. 两类历史数据，性质完全不同

在讨论解决方案之前，需要先区分两类"历史数据"：

### 事件历史（已覆盖）

维修记录、出入库单、工单、采购单——这些是**离散的业务事件**，每条记录有明确的业务语义。它们已经被本体的 `classes` 覆盖：维修工单是一个实体类，Agent 通过 `query_maintenance_records` 工具查询。

事件历史的特点：
- 离散：每天几十到几百条
- 结构化：每条记录有固定字段
- 业务驱动：由人的操作或业务流程产生
- 上下文友好：一条维修记录几十个 token，塞进 Agent 上下文没有压力

### 遥测时序（未覆盖）

传感器读数、设备状态流、环境监测数据——这些是**连续的物理观测**，由设备自动产生，量大、频密、需要专门的存储和查询方式。

遥测时序的特点：
- 连续：每秒/每分钟一个数据点
- 简单结构：(timestamp, value) 对
- 设备驱动：由传感器自动采集
- 上下文不友好：30 天的秒级振动数据 = 260 万个数据点，远超任何 LLM 的上下文窗口

**当前本体对遥测时序完全没有语义描述能力。** Agent 不知道设备有哪些可观测数据流、每个数据流是什么意思、正常范围是多少、该怎么查询。

---

## 3. Palantir 的解法

Palantir Foundry 对这个问题有成熟的处理方式，核心设计是三个分离。

### 3.1 语义与存储分离

时序数据在 Palantir 的本体中是**对象的一种属性类型**（Time Series Property, TSP），和字符串、数字一样，是属性的一种。本体定义"这台设备有一个叫 vibration 的时序属性"，但不关心数据存在哪里。

Palantir 内部用自研的 Epoch 时序数据库 + Soho 格式存储，但这是连接层的事，不影响本体定义。

两种建模模式并存：

**简单模式：时序属性直接挂在实体上**

```
Equipment（本体对象）
  ├── name: "3号线电机"          ← 普通属性
  ├── vibration: [t→v, t→v, ...]  ← 时序属性
  └── temperature: [t→v, t→v, ...] ← 时序属性
```

**复杂模式：传感器作为独立对象**

```
Equipment ──[装配]──→ Sensor ──[产生]──→ TimeSeries
  3号线电机              振动传感器-01        vibration_x
                        温度传感器-01        temperature
```

### 3.2 预聚合与实时查询分离

Palantir 用四层漏斗逐级减少数据量，确保 Agent 永远不碰原始数据点：

```
原始数据（百万点/天）
  ↓ Layer 1: 流式管道预聚合（AggregateOverWindow）
降采样数据（1秒 → 1分钟 → 1小时）
  ↓ Layer 2: 时序属性 + Projection 索引
按 SeriesID + 时间范围高效查询
  ↓ Layer 3: 查询时再聚合（采样/分桶/滚动统计）
统计摘要（min/max/mean/stddev per bucket）
  ↓ Layer 4: Function-Backed Context
Agent 上下文中只有几十个聚合值
```

当用户问"过去 30 天的振动趋势"：
- 不是取 260 万个原始数据点
- 而是取 30 个日统计值（每天的 min/max/avg/stddev），约 120 个数字，几百 token

**Function-Backed Context** 是关键机制：开发者为每个 Agent 写检索函数，精确控制"给 Agent 看什么形态的数据"。这是人设计的数据减量策略，不是自动的。

### 3.3 实时告警与 Agent 推理分离

Palantir **明确把实时处理和 Agent 推理分成两个独立层**：

```
传感器数据流
  ↓
流式管道（预聚合 + 写入本体）
  ↓
本体对象（带时序属性）
  ↙              ↘
Foundry Rules     AIP Agent
（< 15 秒）       （5-30 秒）
  ↓                ↓
自动告警          上下文推理
快速动作          解释 + 建议
```

| 维度 | 规则引擎 | Agent |
|---|---|---|
| 延迟 | < 15 秒 | 5-30 秒 |
| 逻辑 | 确定性（阈值判断） | 不确定性（推理、关联分析） |
| 成本 | 极低（规则执行） | 高（LLM 调用） |
| 用途 | 温度 > 130°C → 立即告警 | "为什么温度飙升？关联维修记录，给建议" |
| 触达 | 每秒处理百万事件 | 按需调用 |

**Agent 不做实时异常检测。** 实时告警是规则引擎的事。Agent 只在需要**解释原因和辅助决策**时才介入。

---

## 4. Agent 面对时序数据的三个真实困境

理解了 Palantir 的解法后，回到我们自己的场景，Agent 在时序数据上面临三个具体困境：

### 困境一：不知道有什么可观测数据

设备运维 Agent 收到用户提问："3号线电机最近状态怎么样？"

没有语义定义时，Agent 只能猜这台电机有哪些传感器数据。它可能猜到温度和振动，但猜不到电流、转速、油液分析。更糟的是，它可能编造一个不存在的数据流，然后调用一个不存在的工具。

**这和指标的问题一模一样**——Agent 需要一个元数据目录来发现能力，而不是靠 prompt 里的静态知识。

### 困境二：不知道数据的含义

即使 Agent 拿到了振动值 4.5 mm/s²，它不知道：
- 这个值正常吗？（需要 normal_range）
- 到什么程度该告警？（需要 alert_threshold）
- 参照什么标准？（需要 reference_standard，如 ISO 10816）
- 什么单位？（需要 unit）

没有这些语义锚点，Agent 的分析就是在猜。它可能说"4.5 看起来有点高"——这不是分析，是幻觉。

### 困境三：不知道该看多少数据

用户问"振动趋势怎么样"，Agent 该查多长时间？用什么粒度？

- 查 1 小时的秒级数据？3600 个点，可以放进上下文
- 查 30 天的秒级数据？260 万个点，直接爆掉
- 查 30 天的日均值？30 个点，但可能丢失了瞬态异常

没有语义层面的"数据减量策略"定义，Agent 要么查太多撑爆上下文，要么查太少丢失关键信息。

---

## 5. 我们的定位：语义契约层怎么处理时序

按照我们已经确立的原则——**Ontology YAML 只管语义，不管存储和计算**——时序数据的处理方式应该是：

```
Ontology YAML
  → 定义"设备有哪些可观测数据流、每个数据流是什么意思"
  → 不定义"数据存在哪里、怎么采集、怎么聚合"

时序存储服务（TDengine / InfluxDB / TimescaleDB）
  → 负责原始数据的写入、存储、查询
  → 客户根据自身技术栈选择

流式计算服务（Flink / Kafka Streams / 边缘计算）
  → 负责实时预聚合、降采样、异常检测
  → 客户根据自身技术栈选择

MCP 工具服务
  → 封装时序查询接口，向 Agent 提供标准化的查询能力
  → 工具的输入输出 schema 由本体定义的语义决定
```

本体的职责边界：

| 本体负责 | 本体不负责 |
|---|---|
| 定义有哪些遥测数据流 | 数据存在哪个时序数据库 |
| 定义每个数据流的语义（单位、正常范围、告警阈值） | 数据怎么采集（MQTT / OPC-UA / Modbus） |
| 定义 Agent 可请求的聚合方式 | 聚合的具体实现（窗口函数、降采样算法） |
| 定义 Agent 的默认查询策略（防止上下文爆炸） | 实时流式计算的部署和调度 |
| 定义遥测数据流和实体的关系 | 传感器的硬件配置和网络拓扑 |

---

## 6. 方案设计：`telemetry` 顶层节点

### 6.1 设计选择

有两种建模方式：

**选项 A：`telemetry` 作为独立顶层节点**

和 `metrics` 平级，专门描述遥测数据流的语义。

优点：时序数据的特殊性（采样频率、阈值、聚合方式、数据减量策略）有专门的字段，不污染属性定义。

**选项 B：时序作为 class 的属性类型**

在 attribute 的 `type` 里新增 `time_series`。

优点：保持"一切都是实体属性"的统一模型。缺点：属性字段严重膨胀。

**选择 A。** 理由：

1. 时序数据流有自己的生命周期（采样频率、保留周期、聚合策略），这些和普通属性（字符串、数字、枚举）性质完全不同
2. 一个时序数据流可能关联多个实体类（同一种温度传感器装在不同类型的设备上）
3. Agent 需要独立发现"有哪些可观测数据流"，而不是遍历所有类的所有属性来找时序类型
4. 和 metrics 的设计一致——metrics 也没有挂在 class 下面，而是独立的顶层节点

### 6.2 `telemetry` 节点结构

```yaml
telemetry:
  - id: string                      # snake_case 唯一标识
    name: string                    # 中文名称
    description: string             # 业务含义，给 Agent 读的
    phase: enum                     # alpha / beta / full

    # ── 数据源语义 ──
    source_class: string            # 哪个实体类产生此数据流
    source_filter: string|null      # 可选：哪类实例才有此数据流
    value_type: enum                # decimal / integer / boolean / string
    unit: string                    # 度量单位
    dimensions: []|null             # 数据维度（如振动的 x/y/z 轴）
      - id: string
        values: [string]
    sampling: string                # 语义采样频率（1s / 10s / 1m / 1h）

    # ── 语义锚点 ──
    normal_range: [number, number]|null   # 正常范围（Agent 判断异常的基准）
    warning_threshold: number|null        # 预警线
    alert_threshold: number|null          # 告警线
    reference_standard: string|null       # 参照标准（如 ISO 10816）

    # ── Agent 查询策略 ──
    aggregations: [string]          # Agent 可请求的聚合方式：avg, max, min, sum, rms, stddev, count
    context_strategy:               # Agent 获取此时序数据时的默认策略
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

### 6.3 备件管理场景的遥测定义（示例）

备件管理本身不是时序数据的主战场，但设备和备件通过关系连接后，Agent 需要理解设备的运行状态来做备件预测：

```yaml
telemetry:
  - id: equipment_running_hours
    name: 设备累计运行小时数
    description: 设备自上次大修后的累计运行时间，用于判断备件的预防性更换周期
    phase: beta
    source_class: equipment
    value_type: decimal
    unit: hours
    sampling: 1h
    normal_range: null              # 因设备不同而异
    aggregations: [max, diff]       # diff = 一段时间内的增量
    context_strategy:
      default_window: 30d
      max_window: 365d
      default_aggregation: max
      default_granularity: 1d
    retention: 365d
    tool: query_telemetry
    status: designed
    known_issues:
      - 部分老旧设备无自动记录，需人工填报
```

### 6.4 设备运维场景的遥测定义（示例）

```yaml
telemetry:
  - id: motor_vibration
    name: 电机振动
    description: >
      电机轴承座振动加速度，反映轴承磨损程度。
      是预测性维护的核心观测指标。
      ISO 10816 标准：< 4.5 良好，4.5-7.1 可接受，> 7.1 需关注，> 11.2 危险。
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
      持续高温（> 100°C）会加速绝缘老化，缩短电机寿命。
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

  - id: motor_current
    name: 电机电流
    description: >
      电机运行电流。异常波动可能预示负载变化或电气故障。
      阈值依赖设备额定电流（rated_current），无法统一定义。
    phase: beta
    source_class: equipment
    value_type: decimal
    unit: A
    sampling: 1s
    normal_range: null
    warning_threshold: null
    alert_threshold: null
    aggregations: [avg, max, rms]
    context_strategy:
      default_window: 7d
      max_window: 90d
      default_aggregation: avg
      default_granularity: 1h
    retention: 90d
    tool: query_telemetry
    status: undefined
    known_issues:
      - 阈值依赖设备铭牌参数（rated_current），需逐台配置
      - 启动电流瞬态脉冲需特殊处理，不能简单判定为异常

  - id: hydraulic_pressure
    name: 液压系统压力
    description: 液压站工作压力，压力下降通常意味着密封件老化或油液泄漏
    phase: beta
    source_class: equipment
    source_filter: "category = '液压设备'"
    value_type: decimal
    unit: MPa
    sampling: 5s
    normal_range: [8.0, 12.0]
    warning_threshold: 7.0
    alert_threshold: 5.0            # 注意：压力是下限告警
    aggregations: [avg, min, stddev]
    context_strategy:
      default_window: 7d
      max_window: 90d
      default_aggregation: avg
      default_granularity: 1h
    retention: 90d
    tool: query_telemetry
    status: designed
```

---

## 7. 上下文管理：Agent 怎么用时序数据

### 7.1 数据减量的四层策略

对应 Palantir 的四层漏斗，我们的实现方式：

| 层 | Palantir | 我们 | 谁负责 |
|---|---|---|---|
| L1 预聚合 | Pipeline Builder 流式管道 | 时序存储服务的连续聚合 / 边缘计算 | 存储服务 |
| L2 索引查询 | Projection + SeriesID | 时序数据库的索引能力 | 存储服务 |
| L3 查询时聚合 | Quiver 采样/分桶 | MCP 工具的 aggregation + granularity 参数 | MCP 工具 |
| L4 上下文策略 | Function-Backed Context | 本体 telemetry 的 context_strategy | 本体语义 |

L4 是本体的职责。`context_strategy` 定义了 Agent 在不知道该查多少数据时的安全默认行为：

```yaml
context_strategy:
  default_window: 7d          # 不指定时间范围时，默认查 7 天
  max_window: 90d             # 最大 90 天，防止查一年的数据
  default_aggregation: rms    # 不指定聚合方式时，用 RMS
  default_granularity: 1h     # 不指定粒度时，按小时聚合
```

这确保了：
- Agent 默认查 7天 × 24小时 = 168 个数据点，约 500 token
- 即使查最大 90 天，也是 90 × 24 = 2160 个点，约 6000 token
- 永远不会出现"260 万个原始数据点塞进上下文"的灾难

### 7.2 Agent 的查询模式

**模式一：概览查询**

用户："3号线电机状态怎么样？"

Agent 通过 `query_ontology_metadata` 发现这台设备有 motor_vibration、motor_temperature 两个遥测数据流，然后用 context_strategy 的默认参数查询：

```
query_telemetry(
  source: "equipment:3号线电机",
  telemetry_id: "motor_vibration",
  window: "7d",              ← 来自 default_window
  aggregation: "rms",        ← 来自 default_aggregation
  granularity: "1d"          ← 用日粒度做概览
)
→ 返回 7 个日统计值
```

Agent 对比 normal_range 和 warning_threshold，给出判断。

**模式二：趋势分析**

用户："过去一个月的振动趋势怎么样？"

```
query_telemetry(
  source: "equipment:3号线电机",
  telemetry_id: "motor_vibration",
  window: "30d",
  aggregation: "rms",
  granularity: "1h"          ← 小时粒度看趋势
)
→ 返回 720 个小时统计值
```

Agent 识别趋势（上升/下降/突变），关联维修记录和备件更换历史。

**模式三：异常定位**

规则引擎告警："3号线电机振动超限"。Agent 被调用做诊断。

```
query_telemetry(
  source: "equipment:3号线电机",
  telemetry_id: "motor_vibration",
  window: "24h",             ← 缩小到告警前后
  aggregation: "max",        ← 看峰值
  granularity: "10m"         ← 10分钟粒度定位时间点
)
→ 返回 144 个数据点
```

Agent 找到异常时间点，再查同时段的温度、电流，做关联分析。

### 7.3 上下文 token 预算估算

| 查询类型 | 数据点数 | 约占 token | 占 200k 上下文比例 |
|---|---|---|---|
| 概览（7天日粒度） | 7 | ~50 | 0.03% |
| 趋势（30天小时粒度） | 720 | ~2,500 | 1.25% |
| 诊断（24小时10分钟粒度） | 144 | ~500 | 0.25% |
| 多传感器概览（5个×7天） | 35 | ~250 | 0.13% |
| 极端情况（90天小时粒度） | 2,160 | ~7,500 | 3.75% |

即使在极端情况下，时序数据也只占 Agent 上下文的不到 4%。`context_strategy` 的 `max_window` 是硬限制，确保不会出现上下文爆炸。

---

## 8. 实时处理：规则引擎的职责

### 8.1 架构分层

```
传感器数据流
  ↓
时序存储服务（写入 + 预聚合）
  ↓
MCP 工具（标准化查询接口）
  ↙              ↘
Rules 引擎        Agent
（确定性判断）    （推理 + 决策）
  ↓                ↓
自动告警          解释 + 建议
快速动作          维修方案
```

### 8.2 规则覆盖实时告警

当前本体的 `rules` 机制完全可以覆盖基于时序的实时告警：

```yaml
rules:
  - id: R-PM01
    name: 振动超限告警
    trigger: data_change
    trigger_source: telemetry:motor_vibration
    condition: "motor_vibration.rms > alert_threshold"
    severity: critical
    action: notify_agent
    params:
      - id: alert_threshold
        type: decimal
        default: 11.2
        configurable: true
        unit: mm/s²
```

规则引擎在时序存储服务内部（或流式计算服务中）执行，延迟在秒级。不经过 LLM。

### 8.3 Agent 做事后推理

规则引擎触发告警后，Agent 被调用做深层分析：

1. 读取告警上下文（哪台设备、什么指标、什么时间）
2. 查询告警前后的多维时序数据（振动 + 温度 + 电流）
3. 查询设备的维修历史和备件更换记录
4. 查询同类设备是否有类似趋势
5. 综合判断原因，生成维修建议和备件准备清单

这条链路的每一环都需要语义定义的支持：
- `telemetry` 告诉 Agent 有哪些可观测数据、怎么查
- `metrics` 告诉 Agent 怎么评估设备健康度
- `classes` + `relationships` 告诉 Agent 设备关联了哪些备件
- `rules` 告诉 Agent 什么条件触发了告警

---

## 9. telemetry 在整个本体中的位置

```
本体 YAML 的语义层次：

classes（世界由什么组成）
  ↕ relationships（实体之间什么关系）

telemetry（世界持续产生什么可观测数据）
  ↓ 聚合/计算
metrics（怎么衡量这个世界）
  ↓ 触发
rules（什么条件需要响应）
  ↓ 驱动
actions（响应时做什么）

functions（需要什么判断能力）
```

每一层都是纯语义定义，不涉及存储和计算的实现。

telemetry 和 metrics 的关系：
- `telemetry` 是原始观测（"振动值是 4.5 mm/s²"）
- `metrics` 是业务度量（"振动健康评分是 72 分"，基于多个传感器加权计算）
- 一个 metric 可以 `depends_on` 一个或多个 telemetry
- 两者的 `status` 机制相同：implemented / designed / undefined

---

## 10. 回答客户的问题

> "你们的 Agent 是怎么处理历史数据和基于时序数据进行分析的？"

**回答框架：**

1. **语义定义层**：本体 YAML 定义了每个设备类型有哪些可观测数据流——叫什么、什么单位、正常范围、告警阈值。Agent 通过元数据发现这些能力，不需要硬编码。

2. **数据减量策略**：本体为每个数据流定义了 Agent 的默认查询策略（时间窗口、聚合方式、降采样粒度），确保 Agent 永远只看聚合后的摘要数据，不碰原始数据点。30 天的传感器数据，Agent 看到的是 30 个日统计值，不是 260 万个原始读数。

3. **实时与推理分离**：实时异常检测由规则引擎在时序存储层完成（秒级延迟，确定性判断）。Agent 只在需要**解释原因和辅助决策**时介入——读取告警上下文、关联多维数据、查询维修历史、生成维修建议。

4. **技术栈无关**：时序存储（TDengine/InfluxDB/TimescaleDB）、流式计算（Flink/边缘计算）、IoT 连接（MQTT/OPC-UA）由客户根据技术栈选择。本体只定义语义契约，不绑定实现。

---

## 11. 下一步

### 短期（设备运维 demo 准备）

1. 在 01-ontology-yaml-spec.md 中正式加入 `telemetry` 顶层节点定义
2. 在设备运维本体 YAML 中定义 4-6 个核心遥测数据流（振动、温度、电流、压力）
3. 更新 `query_ontology_metadata` 的返回值，包含 telemetry 信息
4. 更新 Agent 定义（S2 需要识别和定义遥测数据流）

### 中期（功能实现）

5. 实现 `query_telemetry` MCP 工具（对接时序存储服务）
6. 在规则引擎中支持 `trigger_source: telemetry:*` 的实时告警
7. 在管道生成器中为 telemetry 生成 MCP 工具接口

### 长期（完整闭环）

8. 派生时序支持（基于基础时序计算新时序，如 RMS 振动）
9. metrics 引用 telemetry 的 depends_on 链路
10. 跨本体共享 telemetry 定义（如"温度"传感器在多个业务场景复用）

---

*本体工具 · 遥测时序数据语义化分析 v1.0 · 2026.03*
