# Palantir 方法论对齐分析与修正要求

**确保本体工具设计符合行业最佳实践**

---

## 对齐总览

| 维度 | Palantir 方法论 | 我们的设计 | 状态 |
|---|---|---|---|
| 动态本体（Actions 内生） | 语义元素 + 动能元素 | classes + relationships + rules + actions | 完全对齐 |
| 业务驱动（第一公民） | "人们脑子里想的是什么对象" | S1 的思考框架 step_1 | 完全对齐 |
| 最小可用本体 | "先让骨架跑起来" | phase: alpha/beta/full 分阶段 | 完全对齐 |
| 确定性梯度建模 | 按确定性高低分层 | 规则处理确定性，Agent 处理不确定性 | 完全对齐 |
| AI 接入三步 | 元数据暴露→工具封装→按需检索 | YAML→MCP 工具→Function Calling | 完全对齐 |
| 写回机制 | Action 执行结果反馈回本体 | actions.writes + triggers_after | 完全对齐 |
| Functions | 复杂只读逻辑封装 | functions 字段（已补充） | 已补充 |
| Interfaces/多态 | 抽象父类 | interfaces 字段（已预留，beta） | 已预留 |
| Dynamic Security | 三级权限控制 | security 字段（已预留，beta） | 已预留 |
| 决策日志 | 决策是可分析的本体对象 | decision_log 类 + actions.decision_log 标记 | 已补充 |
| 元数据索引 | "给 AI 一本能力目录" | query_ontology_metadata 工具 | 已补充 |
| 混合存储 | 核心在本体，长尾留源系统 | PG + Neo4j 双存储，快照不入图谱 | 对齐 |

---

## 必须在 alpha 阶段实现的修正

### M01: query_ontology_metadata 工具

**来源：** Palantir "元数据索引表给 AI 一本能力目录"

**要求：** 管道生成器额外生成一个 `query_ontology_metadata` MCP 工具。业务 Agent 调用它可以动态发现当前本体有哪些类、哪些工具可用、哪些动作可执行。

**返回值格式：**
```json
{
  "ontology": "spare_parts",
  "version": "1.0.0",
  "classes": [
    { "id": "inventory_position", "name": "库存头寸", "first_citizen": true, "queryable": true, "tool": "query_inventory" }
  ],
  "actions": [
    { "id": "A01", "name": "记录出库", "tool": "execute_movement_out", "permission": ["engineer", "warehouse_keeper"] }
  ],
  "rules": [
    { "id": "R01", "name": "安全库存预警", "trigger": "after A01,A02" }
  ],
  "functions": [
    { "id": "calc_consumption_trend", "name": "计算消耗趋势", "tool": "calc_consumption_trend" }
  ]
}
```

### M02: 决策日志自动记录

**来源：** Palantir "每一次人的决策都记录到决策日志，决策日志是本体的一部分"

**要求：** 所有 `decision_log: true` 的动作（A04 生成请购、A05 提交采购、A07 取消采购、A08 库存调整），执行时自动在 decision_log 表中创建记录。记录内容包括：原始建议（Agent 给的建议）、最终决策（用户的选择）、决策人、决策时间、理由。

### M03: 交叉校验在审核中执行

**来源：** Palantir/FORGE "当本体模型包含多个文件时必须进行交叉校验"

**要求：** S4 审核员的检查项中已包含一致性检查。但需要确保：当本体跨场景共享类时（如设备类在备件管理和设备运维中都出现），审核员要交叉检查两个本体中同名类的属性是否兼容。

---

## beta 阶段实现的修正

### M04: Interfaces 支持

**来源：** Palantir 七大能力元素中的 Interfaces

**设计：** 见 01-ontology-yaml-spec.md 中的 interfaces 字段。

**典型场景：** 设备运维上线后，"设备"类同时属于备件管理和设备运维。提取一个 `TrackableAsset` Interface，包含 location、status、responsible_person 等公共属性。

### M05: Dynamic Security

**来源：** Palantir 七大能力元素中的 Security

**设计：** 见 01-ontology-yaml-spec.md 中的 security 字段。

**典型场景：** 工段 A 的库管员不应看到工段 B 的库存数据。实现为 PG 的 Row Level Security（RLS）策略，由管道生成器从 security.object_level 自动生成。

### M06: Functions 完整实现

**来源：** Palantir 七大能力元素中的 Functions

**设计：** 见 01-ontology-yaml-spec.md 中的 functions 字段和 02 样板中的三个函数定义。

**实现：**
- `implementation: sql` → 管道生成器将 SQL 片段包装为 MCP 只读工具
- `implementation: go` → 生成 Go 函数骨架，开发者填充逻辑
- `implementation: agent_delegated` → 生成一个工具壳，内部调用 Weave Agent API 让 LLM 推理

---

## 设计决策记录

以下记录我们有意偏离 Palantir 方法论的地方及理由：

### D01: 不使用 OWL/RDF 标准

**Palantir 参考中提到：** W3C OWL/SHACL 标准、Protégé 工具链

**我们的选择：** 自定义 YAML 格式

**理由：** OWL/RDF 的表达能力远超我们当前需要，引入它会大幅增加学习成本和实现复杂度。YAML 格式对团队更友好，且管道生成器可以在需要时将 YAML 导出为 OWL。这是一个务实的工程决策，不影响本体的语义完整性。

### D02: 管道生成器是确定性的，不用 LLM

**Palantir/行业趋势：** 很多工具用 LLM 生成代码

**我们的选择：** 模板化代码生成，确定性，不用 LLM

**理由：** 管道生成的是基础设施代码（DDL、CRUD、schema），必须100%可靠。LLM 生成代码有幻觉风险，在基础设施层不可接受。"确定性交给代码"这个原则也适用于管道本身。

### D03: Agent 构建是辅助不是替代

**Palantir：** 人是本体的设计者

**我们的选择：** Agent 做初稿，人做审核

**理由：** 完全契合 Palantir 的理念——本体需要业务理解，AI 可以加速但不能替代。S1-S4 四个 Agent 的输出都要经过人确认才进入下一步。Agent 降低的是重复劳动（翻译调研文档为结构化定义），不是判断责任。
