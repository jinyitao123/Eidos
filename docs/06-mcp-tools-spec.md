# 本体工具 MCP 服务器

**ontology-tools-server · 为四个构建 Agent 和实例图谱浏览器提供工具**

---

## 服务器信息

```yaml
name: ontology-tools-server
protocol: JSON-RPC 2.0 over HTTP POST
port: 9091
methods: tools/list, tools/call
```

与备件管理的 MCP 工具服务器（:9090）是独立的两个服务。本服务服务于本体编辑器模块中的四个构建 Agent 和实例图谱浏览器。

---

## 构建工具（T01-T10）

### T01: read_document

读取用户上传的调研文档内容。

```json
{
  "name": "read_document",
  "description": "读取上传的调研文档全文内容。支持 .md / .docx / .txt 格式。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "document_id": { "type": "string", "description": "文档ID" },
      "format": { "type": "string", "enum": ["full", "sections"], "default": "full", "description": "full=返回全文，sections=按章节结构化返回" }
    },
    "required": ["document_id"]
  }
}
```

**调用方：** S1（场景分析师）

**实现要点：**
- .md 直接返回文本
- .docx 使用 pandoc 转为 markdown 后返回
- format=sections 时按 H1/H2 标题切分为章节数组
- 返回值包含 `{ content: string, sections?: [{title, content}], word_count: int }`

---

### T02: query_published_ontologies

查询已发布本体的类和关系列表。

```json
{
  "name": "query_published_ontologies",
  "description": "查询所有已发布本体的元数据。用于共享类检测和跨本体一致性检查。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "ontology_id": { "type": "string", "description": "指定本体ID（可选，不填返回全部）" },
      "include_attributes": { "type": "boolean", "default": false, "description": "是否包含属性详情" }
    }
  }
}
```

**调用方：** S1, S2, S4

**返回值：**
```json
{
  "ontologies": [
    {
      "id": "spare_parts",
      "name": "备件管理",
      "version": "1.0.0",
      "status": "published",
      "classes": [
        { "id": "inventory_position", "name": "库存头寸", "first_citizen": true, "attribute_count": 15 },
        { "id": "spare_part", "name": "备件", "attribute_count": 8 }
      ],
      "relationships": [
        { "id": "tracks", "from": "inventory_position", "to": "spare_part" }
      ]
    }
  ]
}
```

---

### T03: import_class

从已发布本体导入一个类的完整定义。

```json
{
  "name": "import_class",
  "description": "从指定的已发布本体中导入一个类的完整定义（属性+关系）。导入后 imported_from 字段自动标注来源。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "source_ontology_id": { "type": "string", "description": "源本体ID" },
      "class_id": { "type": "string", "description": "要导入的类ID" },
      "include_relationships": { "type": "boolean", "default": true, "description": "是否同时导入该类参与的关系" }
    },
    "required": ["source_ontology_id", "class_id"]
  }
}
```

**调用方：** S2（本体架构师）

**返回值：** 该类的完整 YAML 定义片段，可直接合并到当前本体中。

---

### T04: validate_yaml

验证本体 YAML 的格式和语义合规性。

```json
{
  "name": "validate_yaml",
  "description": "验证本体 YAML 格式和语义。返回错误列表和警告列表。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "yaml_content": { "type": "string", "description": "YAML 内容字符串" },
      "check_level": { "type": "string", "enum": ["format", "semantic", "full"], "default": "full" }
    },
    "required": ["yaml_content"]
  }
}
```

**调用方：** S2, S3

**返回值：**
```json
{
  "valid": false,
  "errors": [
    { "type": "format", "message": "class 'inv_pos' 的属性 'Qty' 不符合 snake_case", "path": "classes[0].attributes[0].id" }
  ],
  "warnings": [
    { "type": "semantic", "message": "类 'equipment' 只有5个属性，作为核心类建议至少8个" }
  ]
}
```

---

### T05: read_scene_analysis

读取 S1（场景分析师）的输出。

```json
{
  "name": "read_scene_analysis",
  "description": "读取场景分析师的结构化输出。供本体架构师和规则设计师使用。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "project_id": { "type": "string", "description": "本体项目ID" }
    },
    "required": ["project_id"]
  }
}
```

**调用方：** S2, S3

**返回值：** S1 输出的完整 `scene_analysis` YAML 结构。

---

### T06: read_ontology_structure

读取 S2（本体架构师）的输出。

```json
{
  "name": "read_ontology_structure",
  "description": "读取本体架构师生成的类和关系定义。供规则设计师使用。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "project_id": { "type": "string", "description": "本体项目ID" }
    },
    "required": ["project_id"]
  }
}
```

**调用方：** S3

**返回值：** S2 输出的 `classes` + `relationships` + `graph_config` YAML 结构。

---

### T07: read_full_ontology_yaml

读取完整的本体 YAML（S2+S3 合并后）。

```json
{
  "name": "read_full_ontology_yaml",
  "description": "读取当前项目的完整本体 YAML 定义。供审核员全面检查。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "project_id": { "type": "string", "description": "本体项目ID" }
    },
    "required": ["project_id"]
  }
}
```

**调用方：** S4

---

### T08: query_agent_configs

查询已注册的业务 Agent 配置。

```json
{
  "name": "query_agent_configs",
  "description": "查询已注册的业务 Agent 的工具绑定和提示词概要。用于审核员检查图谱同步标记的合理性。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "agent_id": { "type": "string", "description": "指定 Agent ID（可选）" }
    }
  }
}
```

**调用方：** S4

**返回值：**
```json
{
  "agents": [
    {
      "id": "inventory-steward",
      "name": "库存管家",
      "tools": ["query_inventory", "execute_movement", "graph_equipment_parts"],
      "graph_queries_used": ["设备→备件→头寸遍历需要 criticality, current_qty 过滤"]
    }
  ]
}
```

---

### T09: validate_rule_references

验证规则和动作中引用的属性和类是否存在。

```json
{
  "name": "validate_rule_references",
  "description": "检查规则条件和动作写回中引用的类、属性、关系是否存在于当前本体定义中。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "project_id": { "type": "string", "description": "本体项目ID" },
      "rules_yaml": { "type": "string", "description": "待验证的 rules+actions YAML 片段" }
    },
    "required": ["project_id", "rules_yaml"]
  }
}
```

**调用方：** S3, S4

**返回值：**
```json
{
  "valid": false,
  "invalid_references": [
    { "location": "R05.condition", "reference": "equipment", "suggestion": "应使用关系 consumed_by 遍历到 equipment" }
  ]
}
```

---

### T10: save_output

保存 Agent 输出到项目上下文。

```json
{
  "name": "save_output",
  "description": "将 Agent 的输出保存到项目上下文中。后续 Agent 通过 read 工具读取。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "project_id": { "type": "string", "description": "本体项目ID" },
      "stage": { "type": "string", "enum": ["scene_analysis", "ontology_structure", "rules_actions", "review_report"], "description": "当前阶段" },
      "content": { "type": "string", "description": "YAML 格式的输出内容" }
    },
    "required": ["project_id", "stage", "content"]
  }
}
```

**调用方：** S1, S2, S3, S4

---

## 实例图谱查询工具（T11-T16）

以下工具是本体工具包提供的图谱查询能力，供实例图谱浏览器和业务 Agent 使用，用于查询实例级图谱数据。这些工具由管道 Step 3（Graph Schema Generator）自动生成注册框架，由本体 MCP 服务器统一暴露。

> **实现无关性说明：** 这些工具代表本体工具包对外暴露的图谱查询能力。底层实现可以使用 Neo4j、自定义图引擎、或任何其他图数据库。工具契约（输入 Schema + 输出格式）不因实现方式的变化而改变。调用方只需关注语义操作，无需感知具体的图数据库技术。

### T11: graph_query_nodes

按标签和过滤条件查询实例节点。

```json
{
  "name": "graph_query_nodes",
  "description": "按类标签和属性条件查询图谱中的实例节点。支持按类类型过滤、按属性过滤、分页。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "label": { "type": "string", "description": "节点标签（类ID），如 inventory_position、spare_part" },
      "filters": { "type": "object", "description": "属性过滤条件（仅 graph_sync=true 的属性可用）" },
      "limit": { "type": "integer", "default": 100, "description": "最大返回数" }
    },
    "required": ["label"]
  }
}
```

**返回值：**
```json
{
  "nodes": [
    { "id": "uuid-xxx", "label": "inventory_position", "properties": { "current_qty": 28, "safety_stock": 8, "is_stale": false } }
  ],
  "total": 486
}
```

---

### T12: graph_query_neighbors

查询指定节点的邻居节点和连接关系。

```json
{
  "name": "graph_query_neighbors",
  "description": "查询指定节点的所有邻居节点和连接关系。支持按关系类型和方向过滤。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "node_id": { "type": "string", "description": "起点节点ID" },
      "relationship_type": { "type": "string", "description": "关系类型过滤（可选，如 tracks、located_in）" },
      "direction": { "type": "string", "enum": ["out", "in", "both"], "default": "both", "description": "关系方向" },
      "limit": { "type": "integer", "default": 50 }
    },
    "required": ["node_id"]
  }
}
```

**返回值：**
```json
{
  "neighbors": [
    {
      "node": { "id": "uuid-yyy", "label": "spare_part", "properties": { "name": "6205轴承" } },
      "relationship": { "type": "tracks", "direction": "out", "properties": {} }
    }
  ]
}
```

---

### T13: graph_traverse

从起点节点执行多跳遍历（正向扩散、反向溯源）。

```json
{
  "name": "graph_traverse",
  "description": "从起点节点沿关系扩散 N 跳，返回遍历路径上的所有节点和边。用于正向扩散和反向溯源推演模式。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "start_node_id": { "type": "string", "description": "起点节点ID" },
      "direction": { "type": "string", "enum": ["out", "in", "both"], "description": "遍历方向。out=正向扩散，in=反向溯源" },
      "max_hops": { "type": "integer", "default": 3, "description": "最大跳数" },
      "relationship_types": { "type": "array", "items": { "type": "string" }, "description": "限定遍历的关系类型（可选，不填遍历所有关系）" },
      "filter_labels": { "type": "array", "items": { "type": "string" }, "description": "只返回指定标签的节点（可选）" }
    },
    "required": ["start_node_id", "direction"]
  }
}
```

**返回值：**
```json
{
  "paths": [
    {
      "nodes": [
        { "id": "eq-003", "label": "equipment", "properties": { "name": "3号线电机" } },
        { "id": "sp-001", "label": "spare_part", "properties": { "name": "6205轴承" } },
        { "id": "ip-042", "label": "inventory_position", "properties": { "current_qty": 28 } }
      ],
      "relationships": [
        { "type": "uses", "from": "eq-003", "to": "sp-001" },
        { "type": "tracks", "from": "ip-042", "to": "sp-001" }
      ],
      "hops": 2
    }
  ],
  "total_nodes": 12,
  "total_relationships": 15
}
```

---

### T14: graph_shortest_path

查找两个节点之间的最短路径。

```json
{
  "name": "graph_shortest_path",
  "description": "查找两个节点之间的最短路径。用于路径发现推演模式。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "from_node_id": { "type": "string", "description": "起点节点ID" },
      "to_node_id": { "type": "string", "description": "终点节点ID" },
      "max_hops": { "type": "integer", "default": 6, "description": "最大路径长度" },
      "relationship_types": { "type": "array", "items": { "type": "string" }, "description": "限定关系类型（可选）" }
    },
    "required": ["from_node_id", "to_node_id"]
  }
}
```

**返回值：**
```json
{
  "found": true,
  "path": {
    "nodes": [ ... ],
    "relationships": [ ... ],
    "length": 3
  },
  "alternative_paths": []
}
```

---

### T15: graph_aggregate

按维度聚合子图统计。

```json
{
  "name": "graph_aggregate",
  "description": "按指定维度聚合图谱子图，返回统计结果。用于子图聚合推演模式。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "group_by_label": { "type": "string", "description": "聚合维度的节点标签（如 warehouse）" },
      "target_label": { "type": "string", "description": "被聚合的节点标签（如 inventory_position）" },
      "relationship_type": { "type": "string", "description": "连接两者的关系类型（如 located_in）" },
      "metrics": {
        "type": "array",
        "items": { "type": "string" },
        "description": "聚合指标列表（如 [\"SUM:inventory_value\", \"COUNT:*\", \"AVG:current_qty\"]）"
      }
    },
    "required": ["group_by_label", "target_label", "relationship_type", "metrics"]
  }
}
```

**返回值：**
```json
{
  "groups": [
    {
      "node": { "id": "wh-001", "label": "warehouse", "properties": { "name": "一级总库" } },
      "metrics": { "SUM:inventory_value": 2450000, "COUNT:*": 312, "AVG:current_qty": 15.2 }
    },
    {
      "node": { "id": "wh-002", "label": "warehouse", "properties": { "name": "二级库-A" } },
      "metrics": { "SUM:inventory_value": 680000, "COUNT:*": 87, "AVG:current_qty": 8.6 }
    }
  ]
}
```

---

### T16: graph_stats

查询图谱全局统计信息。

```json
{
  "name": "graph_stats",
  "description": "查询图谱的全局统计：各类型节点数、关系数、最后同步时间。供实例图谱浏览器的统计栏使用。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "ontology_id": { "type": "string", "description": "本体ID" }
    },
    "required": ["ontology_id"]
  }
}
```

**返回值：**

```json
{
  "total_nodes": 854,
  "total_relationships": 2137,
  "by_label": {
    "inventory_position": 486,
    "spare_part": 127,
    "warehouse": 12,
    "equipment": 89,
    "stock_movement": 140
  },
  "last_sync_at": "2026-03-23T18:20:00Z"
}
```

---

## 数据存储（本体工具包内部元数据）

以下表属于本体工具包自身的内部存储，用于管理本体项目的元数据、构建阶段输出、版本历史和上传文档。这些不是业务数据存储——业务数据的表结构由管道根据本体 YAML 自动生成到各自的 schema 中（如 `spareparts.*`）。

### 项目元数据表

```sql
CREATE TABLE ontology.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'building',  -- building / reviewing / published / archived
  current_stage VARCHAR(50),               -- scene_analysis / ontology_structure / rules_actions / review / published
  yaml_content TEXT,                       -- 完整的本体 YAML
  published_version VARCHAR(20),
  published_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);
```

### 阶段输出表

```sql
CREATE TABLE ontology.stage_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES ontology.projects(id),
  stage VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,                   -- YAML 格式
  agent_id VARCHAR(100),
  confirmed_by VARCHAR(255),
  confirmed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now()
);
```

### 版本历史表

```sql
CREATE TABLE ontology.versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES ontology.projects(id),
  version VARCHAR(20) NOT NULL,
  yaml_content TEXT NOT NULL,
  changelog TEXT,
  published_at TIMESTAMP DEFAULT now()
);
```

### 上传文档表

```sql
CREATE TABLE ontology.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES ontology.projects(id),
  filename VARCHAR(255) NOT NULL,
  content TEXT,                            -- 解析后的文本内容
  original_path VARCHAR(500),
  uploaded_at TIMESTAMP DEFAULT now()
);
```
