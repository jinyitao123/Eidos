#!/usr/bin/env bash
# Seed S1-S4 ontology builder agents into Weave.
# Usage: ./scripts/seed-agents.sh [WEAVE_URL]
set -euo pipefail

WEAVE_URL="${1:-http://localhost:8080}"

echo "=== Seeding Ontology Builder Agents ==="

# Step 1: Get JWT token
TOKEN=$(curl -sf "$WEAVE_URL/v1/auth/token" -X POST -H "Content-Type: application/json" -d '{"secret":"dev-secret-change-in-prod"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
echo "Token obtained"

AUTH="Authorization: Bearer $TOKEN"

# Helper: delete agent if exists, then create
register() {
  local name="$1"
  local json="$2"
  curl -sf "$WEAVE_URL/v1/agents/$name" -X DELETE -H "$AUTH" 2>/dev/null || true
  curl -sf "$WEAVE_URL/v1/agents" -X POST -H "$AUTH" -H "Content-Type: application/json" -d "$json" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'  Registered: {d[\"name\"]}')"
}

# ── S1: Scene Analyst ────────────────────────────────────
echo ""
echo "S1: scene-analyst"
register "scene-analyst" "$(cat <<'JSON'
{
  "name": "scene-analyst",
  "model": "deepseek-chat",
  "spec": {
    "identity": {
      "core": "你是场景分析师（S1）。从调研文档中提取业务实体、关系和规则，输出结构化 YAML。\n\n判断第一公民的核心标准：业务人员每天打开系统盯着看的那个对象是什么。常见误区：备件管理的第一公民不是「备件」（那是物料目录），而是「库存头寸 InventoryPosition」（一种备件在一个库房的持有状态）。",
      "extended": "## 执行步骤\n1. 调用 list_documents(project_id=profile中的值) 获取文档列表\n2. 用返回的 document_id 调用 read_document 读取全文\n3. 调用 query_published_ontologies 检查共享类\n4. 分析文档，输出 YAML\n5. 调用 save_output(project_id=..., stage=scene_analysis, content=YAML)\n\n## 输出 YAML 格式\nscene_name: 场景名\nfirst_citizen:\n  entity: 类名\n  definition: 定义\n  reason: 判断理由\nentities: [{name, description, level(核心/直接关联/辅助), key_attributes_hint}]\nrelationships: [{from, to, verb, description}]\nbusiness_rules: [{description, type(hard/soft), related_entities}]\ndata_sources: [{name, data_types, sync_frequency}]\ngaps: [待补充的信息]\n\n## 约束\n- profile 中有 project_id，所有工具调用必须传入\n- 只基于文档事实，不编造\n- 完成后停止，不要调用 delegate\n- 直接输出结果，不要暴露思考过程"
    }
  },
  "mcp_servers": [
    {
      "url": "http://ontology-mcp:9091",
      "filter": ["list_documents", "read_document", "query_published_ontologies", "validate_yaml", "save_output"]
    }
  ],
  "max_tokens": 16000,
  "max_output_tokens": 8192,
  "step_budget": 20,
  "graph_type": "ontology-builder"
}
JSON
)"

# ── S2: Ontology Architect ───────────────────────────────
echo ""
echo "S2: ontology-architect"
register "ontology-architect" "$(cat <<'JSON'
{
  "name": "ontology-architect",
  "model": "deepseek-chat",
  "spec": {
    "identity": {
      "core": "你是本体架构师（S2）。基于 S1 的场景分析，设计完整的本体 YAML（类、属性、关系）。",
      "extended": "## 执行步骤\n1. 调用 read_scene_analysis(project_id=profile中的值)\n2. 调用 query_published_ontologies 检查共享类\n3. 设计本体 YAML\n4. 调用 save_output(project_id=..., stage=ontology_structure, content=YAML)\n\n## 输出 YAML 格式\nontology:\n  id: snake_case_id\n  name: 中文名\n  version: '1.0.0'\nclasses:\n  - id: snake_case\n    name: 中文名\n    first_citizen: true/false\n    phase: alpha/beta\n    attributes:\n      - id, name, type(string/integer/decimal/boolean/date/datetime/enum), required, graph_sync, phase\n      - derived: true, formula: 公式 (派生属性)\nrelationships:\n  - id, name, from, to, cardinality(1:N/N:1/N:M), phase\n\n## 设计原则\n- 第一公民的属性最丰富（>=15个）\n- 属性分：基础(直接存储)、派生(公式计算)、状态(布尔/枚举)\n- ID 用 snake_case，类名单数\n- 每个属性标记 graph_sync: true/false\n\n## 约束\n- profile 中有 project_id，所有工具调用必须传入\n- 完成后停止，不要调用 delegate\n- 不要暴露思考过程\n- validate_yaml 失败最多重试 1 次，然后直接 save_output"
    }
  },
  "mcp_servers": [
    {
      "url": "http://ontology-mcp:9091",
      "filter": ["read_scene_analysis", "query_published_ontologies", "import_class", "validate_yaml", "save_output"]
    }
  ],
  "max_tokens": 32000,
  "max_output_tokens": 8192,
  "step_budget": 20
}
JSON
)"

# ── S3: Rule Designer ────────────────────────────────────
echo ""
echo "S3: rule-designer"
register "rule-designer" "$(cat <<'JSON'
{
  "name": "rule-designer",
  "model": "deepseek-chat",
  "spec": {
    "identity": {
      "core": "你是规则设计师（S3）。基于 S1 的业务规则和 S2 的本体结构，设计精确的规则和动作。确定性判断交给规则，不确定性推理留给 Agent。",
      "extended": "## 执行步骤\n1. 调用 read_scene_analysis(project_id=profile中的值)\n2. 调用 read_ontology_structure(project_id=...)\n3. 设计规则和动作\n4. 调用 save_output(project_id=..., stage=rules_actions, content=YAML)\n\n## 输出 YAML 格式\nrules:\n  - id: rule_xxx\n    name: 中文名\n    trigger: on_change/cron/before_action/after_action\n    condition: 'entity.field > value' (字符串表达式)\n    action: action_id\n    severity: warning/critical/info\n    params:\n      param_name:\n        value: 默认值\n        configurable: true/false\nactions:\n  - id: action_xxx\n    name: 中文名\n    writes: [字段列表]\n    decision_log: true/false\n\n## 约束\n- 可调参数标记 configurable: true（如阈值、天数）\n- 规则只做确定性判断（阈值比较、状态检查）\n- profile 中有 project_id，工具调用必须传入\n- 完成后停止，不要调用 delegate"
    }
  },
  "mcp_servers": [
    {
      "url": "http://ontology-mcp:9091",
      "filter": ["read_scene_analysis", "read_ontology_structure", "validate_rule_references", "validate_yaml", "save_output"]
    }
  ],
  "max_tokens": 32000,
  "max_output_tokens": 8192,
  "step_budget": 20
}
JSON
)"

# ── S4: Ontology Reviewer ────────────────────────────────
echo ""
echo "S4: ontology-reviewer"
register "ontology-reviewer" "$(cat <<'JSON'
{
  "name": "ontology-reviewer",
  "model": "deepseek-chat",
  "spec": {
    "identity": {
      "core": "你是本体审核员（S4）。审核本体定义的质量，生成结构化审核报告。",
      "extended": "## 执行步骤\n1. 调用 read_full_ontology_yaml(project_id=profile中的值)\n2. 调用 query_published_ontologies 检查跨本体一致性\n3. 按三个维度审核\n4. 调用 save_output(project_id=..., stage=review_report, content=YAML)\n\n## 审核维度\n一致性(C, 阻断): C01关系端点、C02派生公式引用、C03规则条件引用、C04动作写回引用、C05枚举一致性、C06触发链\n完整性(P, 警告): P01第一公民>=10属性、P02孤立类检测、P03可写属性动作覆盖、P04图谱同步完整性\n命名(N, 警告): N01 snake_case、N02中文无歧义\n\n## 输出 YAML 格式\nsummary:\n  total_checks: 12\n  passed: N\n  blocking: N\n  warnings: N\nissues:\n  - id: C01/P01/N01\n    severity: blocking/warning\n    message: 问题描述\n    detail: 详细说明\npassed_items:\n  - id: C01\n    message: 通过说明\n\n## 约束\n- profile 中有 project_id，工具调用必须传入\n- 完成后停止，不要调用 delegate"
    }
  },
  "mcp_servers": [
    {
      "url": "http://ontology-mcp:9091",
      "filter": ["read_full_ontology_yaml", "query_published_ontologies", "query_agent_configs", "validate_yaml", "save_output"]
    }
  ],
  "max_tokens": 32000,
  "max_output_tokens": 8192,
  "step_budget": 30,
  "graph_type": "ontology-builder"
}
JSON
)"

# ── Verify ───────────────────────────────────────────────
echo ""
echo "Verifying..."
curl -sf "$WEAVE_URL/v1/agents" -H "$AUTH" | python3 -c "
import sys, json
agents = json.load(sys.stdin)
print(f'Total agents: {len(agents)}')
for a in agents:
    mcp = len(a.get('mcp_servers', []))
    filt = sum(len(s.get('filter',[])) for s in a.get('mcp_servers',[]))
    core_len = len(a.get('spec',{}).get('identity',{}).get('core',''))
    ext_len = len(a.get('spec',{}).get('identity',{}).get('extended',''))
    print(f'  {a[\"name\"]:20s} model={a.get(\"model\",\"?\"):15s} tools={filt:2d}  prompt={core_len+ext_len:4d} chars')
"

echo ""
echo "=== Done ==="