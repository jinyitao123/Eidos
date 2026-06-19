# Eidos 合并设计：GitHub 版 × Nexus 版统一方案

日期：2026-06-19

## 一、背景

Eidos 存在两个独立演化的版本：

| 维度 | GitHub 版（本仓库） | Nexus 版（~/nexus/eidos/ontology） |
|------|---------------------|--------------------------------------|
| 数据模型 | Class-based（YAML 驱动） | Entity-based（JSON 驱动） |
| 端口 | :9091 | :9101 |
| MCP 工具 | 26 个（含 6 个 Neo4j 图查询） | ~20 个 |
| 前端 | React 8 页面 | 无 |
| 管道 | 7 步代码生成（PG/MCP/Neo4j/Agent/Rules/TS/Connector） | 1 步（PG DDL） |
| 存储 | PG（项目表+本体 YAML 文本） | PG（版本化文档存储） |
| 独有能力 | Agent 构建流(S1→S4)、Neo4j 图谱、策略配置、完整性守卫(12条)、项目管理 | 继承体系、提议治理、Concept/Predicate、术语表、版本化(revision/release/diff/restore)、健康分、REST API |

两版在核心（实体描述 + 关系 + 校验）上有 ~60% 重叠,但数据模型和字段名不兼容。合并目标：**一套代码、一个模型、功能并集**。

## 二、统一数据模型

### 2.1 设计原则

- **Entity = Class 的超集**：保留 Nexus 的 `Entity` 命名（语义更准确），吸收 GitHub 版 Class 的全部字段
- **YAML + JSON 双格式支持**：保留 YAML 作为人类编辑格式,JSON 作为 API 交换格式
- **向后兼容**：旧 YAML 文件无需改动即可解析（新字段全 omitempty）

### 2.2 统一 Entity（= 原 Class + 原 Entity 并集）

```go
type Entity struct {
    ID          string      `yaml:"id" json:"id"`
    Name        string      `yaml:"name" json:"name"`
    Description string      `yaml:"description,omitempty" json:"description,omitempty"`

    // --- 来自 GitHub Class ---
    Phase        string             `yaml:"phase,omitempty" json:"phase,omitempty"`       // draft|reviewing|stable
    ImportedFrom string             `yaml:"imported_from,omitempty" json:"imported_from,omitempty"`
    Extends      string             `yaml:"extends,omitempty" json:"extends,omitempty"`
    UniqueConstraints []UniqueConstraint `yaml:"unique_constraints,omitempty" json:"unique_constraints,omitempty"`

    // --- 来自 Nexus Entity ---
    Kind          string   `yaml:"kind,omitempty" json:"kind,omitempty"`            // person|event|thing
    Status        string   `yaml:"status,omitempty" json:"status,omitempty"`         // proposed|reviewing|confirmed
    Source        string   `yaml:"source,omitempty" json:"source,omitempty"`
    ParentRef     string   `yaml:"parent_ref,omitempty" json:"parent_ref,omitempty"`
    InheritedFrom string   `yaml:"inherited_from,omitempty" json:"inherited_from,omitempty"`
    FirstCitizen  bool     `yaml:"first_citizen,omitempty" json:"first_citizen,omitempty"`
    Domain        string   `yaml:"domain,omitempty" json:"domain,omitempty"`
    Layer         string   `yaml:"layer,omitempty" json:"layer,omitempty"`           // master|transactional|document|event
    Observable    *bool    `yaml:"observable,omitempty" json:"observable,omitempty"`
    Aliases       []string `yaml:"aliases,omitempty" json:"aliases,omitempty"`

    Attributes []Attribute `yaml:"attributes" json:"attributes"`
}
```

### 2.3 统一 Attribute（并集）

```go
type Attribute struct {
    ID          string `yaml:"id" json:"id"`
    Name        string `yaml:"name" json:"name"`
    Description string `yaml:"description,omitempty" json:"description,omitempty"`

    // --- 共有（名称对齐）---
    Type       string   `yaml:"type" json:"type"`       // GitHub 叫 type, Nexus 叫 data_type → 统一为 type
    Required   bool     `yaml:"required,omitempty" json:"required,omitempty"`
    Unique     bool     `yaml:"unique,omitempty" json:"unique,omitempty"`
    Default    any      `yaml:"default,omitempty" json:"default,omitempty"`
    EnumValues []string `yaml:"enum_values,omitempty" json:"enum_values,omitempty"`
    Unit       string   `yaml:"unit,omitempty" json:"unit,omitempty"`

    // --- 来自 GitHub ---
    Derived      string `yaml:"derived,omitempty" json:"derived,omitempty"`
    Formula      string `yaml:"formula,omitempty" json:"formula,omitempty"`
    GraphSync    bool   `yaml:"graph_sync,omitempty" json:"graph_sync,omitempty"`
    Configurable bool   `yaml:"configurable,omitempty" json:"configurable,omitempty"`
    ValueRange   string `yaml:"value_range,omitempty" json:"value_range,omitempty"`
    Phase        string `yaml:"phase,omitempty" json:"phase,omitempty"`
    IsMetric     bool   `yaml:"is_metric,omitempty" json:"is_metric,omitempty"`
    Exposed      bool   `yaml:"exposed,omitempty" json:"exposed,omitempty"`

    // --- 来自 Nexus ---
    Constraint    map[string]any      `yaml:"constraint,omitempty" json:"constraint,omitempty"`
    RefTo         string              `yaml:"ref_to,omitempty" json:"ref_to,omitempty"`
    PrimaryKey    bool                `yaml:"primary_key,omitempty" json:"primary_key,omitempty"`
    InheritedFrom string              `yaml:"inherited_from,omitempty" json:"inherited_from,omitempty"`
    Aliases       []string            `yaml:"aliases,omitempty" json:"aliases,omitempty"`
    EnumAliases   map[string][]string `yaml:"enum_aliases,omitempty" json:"enum_aliases,omitempty"`
}
```

### 2.4 统一 Relationship（并集）

```go
type Relationship struct {
    ID          string `yaml:"id" json:"id"`
    Name        string `yaml:"name" json:"name"`
    Description string `yaml:"description,omitempty" json:"description,omitempty"`

    // 源/目标对齐：GitHub 用 from/to, Nexus 用 source/target
    // 统一用 from/to（更自然），解析时兼容 source/target
    From        string `yaml:"from" json:"from"`
    To          string `yaml:"to" json:"to"`

    Cardinality string `yaml:"cardinality" json:"cardinality"`
    Required    bool   `yaml:"required,omitempty" json:"required,omitempty"`
    Phase       string `yaml:"phase,omitempty" json:"phase,omitempty"`

    // --- 来自 GitHub ---
    EdgeAttributes []EdgeAttribute `yaml:"edge_attributes,omitempty" json:"edge_attributes,omitempty"`

    // --- 来自 Nexus ---
    Direction       string `yaml:"direction,omitempty" json:"direction,omitempty"` // one_way|mutual
    Status          string `yaml:"status,omitempty" json:"status,omitempty"`
    Kind            string `yaml:"kind,omitempty" json:"kind,omitempty"` // containment|membership|reference|event
    LinkedAttribute string `yaml:"linked_attribute,omitempty" json:"linked_attribute,omitempty"`
}
```

### 2.5 统一 Ontology 顶层文档

```go
type Ontology struct {
    Name        string `yaml:"name" json:"name"`
    ID          string `yaml:"id" json:"id"`
    Version     string `yaml:"version" json:"version"`
    Description string `yaml:"description,omitempty" json:"description,omitempty"`

    // --- 来自 Nexus Meta ---
    ParentRefs []string `yaml:"parent_refs,omitempty" json:"parent_refs,omitempty"`

    // --- 来自 GitHub ---
    SceneAnalysisRef string `yaml:"scene_analysis_ref,omitempty" json:"scene_analysis_ref,omitempty"`

    // --- 共有 ---
    Entities      []Entity       `yaml:"entities" json:"entities"`       // 统一称 entities（旧 YAML 的 classes 由解析器兼容）
    Relationships []Relationship `yaml:"relationships" json:"relationships"`

    // --- 来自 GitHub（企业能力）---
    Metrics    []Metric    `yaml:"metrics,omitempty" json:"metrics,omitempty"`
    Telemetry  []Telemetry `yaml:"telemetry,omitempty" json:"telemetry,omitempty"`
    Rules      []Rule      `yaml:"rules,omitempty" json:"rules,omitempty"`
    Actions    []Action    `yaml:"actions,omitempty" json:"actions,omitempty"`
    Functions  []Function  `yaml:"functions,omitempty" json:"functions,omitempty"`
    Interfaces []Interface `yaml:"interfaces,omitempty" json:"interfaces,omitempty"`
    Security   *Security   `yaml:"security,omitempty" json:"security,omitempty"`

    // --- 来自 Nexus ---
    Concepts []Concept `yaml:"concepts,omitempty" json:"concepts,omitempty"`
}
```

### 2.6 字段名迁移映射

| 旧名 | 新名 | 说明 |
|-------|------|------|
| `classes` (YAML key) | `entities` | 解析器向后兼容：读到 `classes` 自动映射到 `Entities` |
| `Attribute.data_type` (Nexus) | `Attribute.type` | 统一字段名 |
| `Relationship.source/target` (Nexus) | `Relationship.from/to` | 统一字段名 |
| `Class.Phase` | `Entity.Phase` | 直接保留 |
| `Entity.Kind` (Nexus) | `Entity.Kind` | 直接保留 |

## 三、合并后目录结构

```
Eidos/
├── server/
│   ├── cmd/ontologyserver/
│   │   └── main.go              # 统一入口（MCP + REST 双协议）
│   ├── internal/
│   │   ├── model/               # ← 新增：统一数据模型（从 Nexus model 包迁来）
│   │   │   ├── ontology.go      # Entity/Attribute/Relationship/Concept/Predicate
│   │   │   └── ontology_test.go
│   │   ├── yaml/                # YAML 解析 + 向后兼容层
│   │   │   ├── types.go         # ← 改为引用 model 包（薄包装）
│   │   │   ├── parser.go        # ← 加 classes→entities 兼容
│   │   │   └── validate.go      # ← 合并两边校验逻辑
│   │   ├── store/               # ← 新增：版本化存储接口（从 Nexus store 包迁来）
│   │   │   ├── store.go
│   │   │   └── store_pg.go
│   │   ├── proposals/           # ← 新增：提议治理（从 Nexus proposals 包迁来）
│   │   │   ├── proposals.go
│   │   │   └── store_pg.go
│   │   ├── assess/              # ← 新增：健康评估（从 Nexus assess 包迁来）
│   │   │   ├── assess.go
│   │   │   └── assess_test.go
│   │   ├── tools/               # MCP 工具（合并后 ~38 个）
│   │   │   ├── registry.go      # ← 扩展注册
│   │   │   ├── integrity.go     # ← 保留 GitHub 版 12 条完整性守卫
│   │   │   ├── inheritance.go   # ← 新增：继承体系工具（从 Nexus tools 提取）
│   │   │   ├── proposals.go     # ← 新增：提议工具
│   │   │   ├── concepts.go      # ← 新增：概念/谓词工具
│   │   │   ├── glossary.go      # ← 新增：术语表工具
│   │   │   ├── versions.go      # ← 新增：版本化工具
│   │   │   ├── assess.go        # ← 新增：健康分工具
│   │   │   └── ... (保留现有文件)
│   │   ├── rest/                # ← 新增：REST API 端点（从 Nexus rest.go 迁来）
│   │   ├── mcp/                 # MCP 协议层（保留 GitHub 版）
│   │   ├── neo/                 # Neo4j 驱动（保留 GitHub 版）
│   │   ├── pg/                  # PG 连接池（保留 GitHub 版）
│   │   └── config/              # 配置（保留 GitHub 版）
├── pipeline/                    # 7 步代码生成管道（保留 GitHub 版，适配统一模型）
│   ├── internal/types/
│   │   └── ontology.go          # ← 改为引用 server/internal/model（消除重复定义）
│   └── ...
├── app/                         # React 前端（保留 GitHub 版，适配统一模型）
│   └── src/types/ontology.ts    # ← 更新字段名
├── docs/
├── design/
└── scripts/
```

## 四、MCP 工具合并清单

### 4.1 保留不动（来自 GitHub，共 26 个）

| # | 工具名 | 说明 |
|---|--------|------|
| 1 | list_projects | 项目管理 |
| 2 | get_project | 项目管理 |
| 3 | create_project | 项目管理 |
| 4 | delete_project | 项目管理 |
| 5 | upload_document | 文档上传 |
| 6 | list_documents | 文档列表 |
| 7 | read_document | 文档读取 |
| 8 | query_published_ontologies | 查询已发布本体 |
| 9 | import_class | 导入类（将改名 import_entity） |
| 10 | validate_yaml | YAML 校验 |
| 11 | read_scene_analysis | 读场景分析 |
| 12 | read_ontology_structure | 读本体结构 |
| 13 | read_full_ontology_yaml | 读完整 YAML |
| 14 | read_review_report | 读审核报告 |
| 15 | read_rules_actions | 读规则/动作 |
| 16 | query_agent_configs | 查询 Agent 配置 |
| 17 | validate_rule_references | 校验规则引用 |
| 18 | save_output | 保存输出（含完整性守卫） |
| 19 | update_ontology_yaml | 更新本体 YAML |
| 20 | run_pipeline | 运行代码生成管道 |
| 21 | list_ontology_templates | 列出本体模板 |
| 22 | get_strategy_profile | 获取策略配置 |
| 23 | update_strategy_profile | 更新策略配置 |
| 24-26 | graph_query_* (6个) | Neo4j 图查询 |

### 4.2 新增（从 Nexus 迁入，共 ~12 个）

| # | 工具名 | 来源 | 说明 |
|---|--------|------|------|
| 1 | get_inheritance | Nexus GetInheritance | 查看继承树 |
| 2 | realign_inheritance | Nexus RealignInheritance | 重新对齐继承 |
| 3 | propose_change | Nexus ProposeOntologyChange | 提议本体变更 |
| 4 | list_proposals | Nexus ListProposals | 列出待审提议 |
| 5 | approve_proposal | Nexus ApproveProposal | 批准提议 |
| 6 | reject_proposal | Nexus RejectProposal | 拒绝提议 |
| 7 | list_glossary | Nexus ListGlossary | 列出术语表 |
| 8 | resolve_terms | Nexus ResolveTerms | 解析业务术语 |
| 9 | upsert_concept | Nexus UpsertConcept | 增改概念 |
| 10 | evaluate_concept | Nexus EvaluateConcept | 求值概念 |
| 11 | review_entities | Nexus ReviewClasses | 审核实体 |
| 12 | assess_health | Nexus EvaluateOntology | 健康评估 |
| 13 | list_versions | Nexus ListOntologyVersions | 版本列表 |
| 14 | diff_versions | Nexus DiffOntologyVersions | 版本差异 |
| 15 | restore_version | Nexus RestoreOntologyVersion | 恢复版本 |
| 16 | publish_ontology | Nexus PublishOntology | 发布（打 release tag） |

### 4.3 合并/替换

| GitHub 版 | Nexus 版 | 结果 |
|-----------|----------|------|
| validate_yaml | validate（硬拦+软警告） | 合并：保留 GitHub 完整性守卫 + 加入 Nexus 的分层校验 |
| save_output | SaveOntology | 合并：save_output 内调用统一 store，保留完整性守卫链 |
| update_ontology_yaml | UpsertEntity/Attribute/Relationship | 保留两套入口（整文档更新 + 细粒度 upsert）|

## 五、实施批次

### Batch 1：统一数据模型 + 存储层（3-5 天）

**目标**：`server/internal/model/` 成为唯一数据定义，所有包引用它。

1. 创建 `server/internal/model/ontology.go`（§2 定义的统一结构）
2. 改写 `server/internal/yaml/types.go` → 薄包装，`type Ontology = model.Ontology` 等类型别名
3. 改写 `server/internal/yaml/parser.go` → 加 `classes`↔`entities` 兼容层
4. 迁入 `server/internal/store/`（版本化存储，从 Nexus store 包搬运并适配）
5. 迁入 `server/internal/proposals/`（提议治理）
6. 迁入 `server/internal/assess/`（健康评估）
7. 合并校验逻辑：`yaml/validate.go` 保留 GitHub 版 + 加入 Nexus `validate.Document()` 的检查项
8. `pipeline/internal/types/ontology.go` → 改为引用 `server/internal/model`（消除重复定义）
9. 全量测试通过

**验收标准**：
- 现有 YAML 文件无需修改即可解析
- `go test ./...` 全绿
- 旧版 26 个 MCP 工具功能不变

### Batch 2：MCP 工具扩展 + REST API（3-4 天）

**目标**：迁入 Nexus 的 ~15 个新工具 + REST 端点。

1. 从 Nexus `tools.go`（1160 行）按职责拆分为多个文件：
   - `inheritance.go` → GetInheritance, RealignInheritance + 8 条契约守卫
   - `proposals.go` → Propose/List/Approve/Reject
   - `concepts.go` → UpsertConcept, EvaluateConcept
   - `glossary.go` → ListGlossary, ResolveTerms
   - `versions.go` → List/Diff/Restore + PublishOntology
   - `assess.go` → 健康分
2. 在 `registry.go` 注册所有新工具
3. 迁入 `server/internal/rest/`（REST API,从 Nexus rest.go 搬运）
4. `main.go` 启动时同时开 MCP(:9091) + REST(:9101) 双端口
5. 完整性守卫合并：GitHub 12 条 + Nexus 8 条继承契约守卫

**验收标准**：
- 38+ MCP 工具全部可调用
- REST API `/api/ontology/{id}` 可用
- 提议回路端到端跑通

### Batch 3：管道适配 + Neo4j（1-2 天）

**目标**：7 步代码生成管道在统一模型下正常运行。

1. `pipeline/internal/*/generator.go` → 所有 `Class` 引用改为 `Entity`
2. Neo4j schema generator → 加入新字段映射（kind/status/domain/layer）
3. Agent config generator → 适配统一模型
4. 运行 pipeline 端到端测试

**验收标准**：
- `run_pipeline` 对现有本体产出与合并前一致
- 新字段（kind/domain/aliases）正确映射到 Neo4j 属性

### Batch 4：前端适配（2-3 天）

**目标**：React UI 适配统一模型。

1. `app/src/types/ontology.ts` → 更新 TypeScript 类型定义
2. 8 个页面组件适配字段名变更
3. 新增页面/组件：
   - 提议管理页（list/approve/reject）
   - 版本历史页（list/diff/restore）
   - 继承可视化（树状图）
   - 健康分仪表板
4. 术语表面板（glossary/resolve）

**验收标准**：
- 现有 8 页正常渲染
- 新增页面可用

## 六、PG Schema 迁移

```sql
-- Batch 1: 版本化存储
CREATE TABLE IF NOT EXISTS ontology_versions (
    ontology_id TEXT NOT NULL,
    version     INT  NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'revision',  -- revision | release
    content     JSONB NOT NULL,
    content_hash TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'edit',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (ontology_id, version)
);

-- Batch 2: 提议治理
CREATE TABLE IF NOT EXISTS ontology_proposals (
    id          TEXT PRIMARY KEY,
    ontology_id TEXT NOT NULL,
    kind        TEXT NOT NULL,    -- attribute | entity | relationship
    entity_id   TEXT,
    payload     JSONB NOT NULL,
    reason      TEXT NOT NULL,
    proposer    TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at  TIMESTAMPTZ
);
CREATE INDEX idx_proposals_ontology_status ON ontology_proposals(ontology_id, status);
```

## 七、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 旧 YAML 文件解析失败 | 现有用户不能用了 | 解析器兼容层（classes→entities），加 round-trip 测试 |
| 两版校验逻辑冲突 | 某些本体通不过 | 分层：GitHub 完整性守卫(blocking) + Nexus 软警告(warning) |
| pipeline 类型重复定义 | 维护成本高 | Batch 1 就统一为单一 model 包 |
| Neo4j schema 变更 | 已有图数据不兼容 | 新字段全加默认值，不删旧字段 |
| 前端 class→entity 术语变更 | UI 上下文混乱 | 内部统一叫 entity，用户显示层保留"类"字样（中文语境更自然） |

## 八、不合并的东西

以下 Nexus 特有代码**不迁入**（它们属于 Nexus 的其他模块,与 Eidos 本体服务无关）：

- `nexus/eidos/` 下 ontology 以外的包（如果有）
- nexus 其他服务的代码
- Nexus 特有的 go.mod 依赖（合并后以 GitHub Eidos 的 go.mod 为基础）

## 九、后续（合并完成后）

1. 更新 `CLAUDE.md` 和 `README.md` 反映统一架构
2. Ontopia 世界引擎对接统一后的 Eidos（通过 REST API 或 MCP）
3. 考虑将 module path 从 `ontologyserver` 改为 `github.com/jinyitao123/Eidos`
