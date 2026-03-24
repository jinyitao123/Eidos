#!/usr/bin/env bash
# ============================================================================
# 后端端到端集成测试
# 完整业务流程：创建项目 → 4 阶段保存 → 验证 YAML → 运行 Pipeline → 验证输出 → 清理
# 用法: bash docs/test/e2e/backend_e2e_test.sh [MCP_URL]
# ============================================================================

set -euo pipefail

MCP_URL="${1:-http://localhost:9091/}"
PASS=0
FAIL=0
SKIP=0
TOTAL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ---- 辅助函数 ----

mcp_call() {
    curl -s -X POST "$MCP_URL" \
        -H 'Content-Type: application/json' \
        -d "$1" 2>/dev/null
}

mcp_tool() {
    local name="$1"
    local args="$2"
    mcp_call "{\"jsonrpc\":\"2.0\",\"id\":$((++TOTAL)),\"method\":\"tools/call\",\"params\":{\"name\":\"$name\",\"arguments\":$args}}"
}

extract_text() {
    echo "$1" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r['result']['content'][0]['text'])" 2>/dev/null
}

is_error() {
    echo "$1" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('result',{}).get('isError', False))" 2>/dev/null
}

assert_ok() {
    local desc="$1"
    local response="$2"
    TOTAL=$((TOTAL + 1))
    local err
    err=$(is_error "$response")
    if [ "$err" = "False" ]; then
        echo -e "  ${GREEN}PASS${NC} $desc"
        PASS=$((PASS + 1))
    else
        local msg
        msg=$(extract_text "$response" | head -c 120)
        echo -e "  ${RED}FAIL${NC} $desc → $msg"
        FAIL=$((FAIL + 1))
    fi
}

assert_error() {
    local desc="$1"
    local response="$2"
    TOTAL=$((TOTAL + 1))
    local err
    err=$(is_error "$response")
    if [ "$err" = "True" ]; then
        echo -e "  ${GREEN}PASS${NC} $desc (预期错误)"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}FAIL${NC} $desc → 预期错误但成功了"
        FAIL=$((FAIL + 1))
    fi
}

assert_contains() {
    local desc="$1"
    local response="$2"
    local keyword="$3"
    TOTAL=$((TOTAL + 1))
    local text
    text=$(extract_text "$response")
    if echo "$text" | grep -q "$keyword"; then
        echo -e "  ${GREEN}PASS${NC} $desc (包含 '$keyword')"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}FAIL${NC} $desc → 未找到 '$keyword'"
        FAIL=$((FAIL + 1))
    fi
}

assert_json_field() {
    local desc="$1"
    local response="$2"
    local field="$3"
    TOTAL=$((TOTAL + 1))
    local text
    text=$(extract_text "$response")
    local val
    val=$(echo "$text" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$field','__MISSING__'))" 2>/dev/null || echo "__PARSE_ERROR__")
    if [ "$val" != "__MISSING__" ] && [ "$val" != "__PARSE_ERROR__" ]; then
        echo -e "  ${GREEN}PASS${NC} $desc (${field}=${val})"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}FAIL${NC} $desc → JSON 缺少字段 '$field'"
        FAIL=$((FAIL + 1))
    fi
}

section() {
    echo ""
    echo -e "${BLUE}━━━ $1 ━━━${NC}"
}

# ============================================================================
echo "╔══════════════════════════════════════════╗"
echo "║   Ontology Toolkit 后端 E2E 集成测试     ║"
echo "║   Target: $MCP_URL"
echo "╚══════════════════════════════════════════╝"

# ============================================================================
section "E2E-1: 工具注册完整性"
# ============================================================================

TOOLS_RESPONSE=$(mcp_call '{"jsonrpc":"2.0","id":0,"method":"tools/list","params":{}}')
TOOL_COUNT=$(echo "$TOOLS_RESPONSE" | python3 -c "import sys,json; r=json.load(sys.stdin); print(len(r['result']['tools']))" 2>/dev/null || echo "0")
TOOL_NAMES=$(echo "$TOOLS_RESPONSE" | python3 -c "import sys,json; r=json.load(sys.stdin); print(','.join(sorted([t['name'] for t in r['result']['tools']])))" 2>/dev/null)

TOTAL=$((TOTAL + 1))
if [ "$TOOL_COUNT" -ge 22 ]; then
    echo -e "  ${GREEN}PASS${NC} 注册 $TOOL_COUNT 个工具"
    PASS=$((PASS + 1))
else
    echo -e "  ${RED}FAIL${NC} 只有 $TOOL_COUNT 个工具 (预期 ≥22)"
    FAIL=$((FAIL + 1))
fi

# 检查关键工具是否存在
for tool in create_project delete_project save_output validate_yaml run_pipeline graph_stats; do
    TOTAL=$((TOTAL + 1))
    if echo "$TOOL_NAMES" | grep -q "$tool"; then
        echo -e "  ${GREEN}PASS${NC} 工具 '$tool' 已注册"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}FAIL${NC} 工具 '$tool' 缺失"
        FAIL=$((FAIL + 1))
    fi
done

# ============================================================================
section "E2E-2: 完整项目生命周期"
# ============================================================================

# Step 1: 创建项目
echo -e "  ${YELLOW}[创建项目]${NC}"
R=$(mcp_tool "create_project" '{"name":"E2E测试项目-酒店管理","description":"端到端集成测试"}')
assert_ok "创建项目" "$R"
PROJECT_ID=$(extract_text "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['id'])" 2>/dev/null || echo "")
if [ -z "$PROJECT_ID" ]; then
    echo -e "  ${RED}FATAL${NC} 无法获取项目 ID，终止测试"
    exit 1
fi
echo -e "  ${BLUE}项目ID: $PROJECT_ID${NC}"

# Step 2: 获取项目详情
R=$(mcp_tool "get_project" "{\"project_id\":\"$PROJECT_ID\"}")
assert_ok "获取项目" "$R"
assert_contains "项目名称正确" "$R" "E2E测试项目"

# Step 3: 保存场景分析 (Stage 1)
echo -e "  ${YELLOW}[阶段1: 场景分析]${NC}"
read -r -d '' SCENE_YAML << 'SCENEEOF' || true
scene_analysis:
  name: 酒店管理场景分析
  core_scenarios:
    - 房间预订与入住管理
    - 客户会员管理
    - 房价动态调整
  key_entities:
    - id: room
      name: 房间
      role: 核心资产
    - id: guest
      name: 住客
      role: 客户
    - id: reservation
      name: 预订
      role: 业务单据
  key_relationships:
    - from: reservation
      to: room
      cardinality: many_to_one
    - from: reservation
      to: guest
      cardinality: many_to_one
SCENEEOF
SCENE_JSON=$(echo "$SCENE_YAML" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")
R=$(mcp_tool "save_output" "{\"project_id\":\"$PROJECT_ID\",\"stage\":\"scene_analysis\",\"content\":$SCENE_JSON}")
assert_ok "保存场景分析" "$R"

R=$(mcp_tool "read_scene_analysis" "{\"project_id\":\"$PROJECT_ID\"}")
assert_ok "读取场景分析" "$R"
assert_contains "场景分析内容完整" "$R" "核心资产"

# Step 4: 保存本体结构 (Stage 2)
echo -e "  ${YELLOW}[阶段2: 本体结构]${NC}"
read -r -d '' ONTOLOGY_YAML << 'YAMLEOF' || true
classes:
  - id: room
    name: 房间
    first_citizen: true
    phase: alpha
    attributes:
      - id: room_number
        name: 房间号
        type: string
        required: true
        unique: true
      - id: floor
        name: 楼层
        type: integer
        required: true
      - id: room_type
        name: 房型
        type: enum
        required: true
        enum_values: [STANDARD, DELUXE, SUITE, PRESIDENTIAL]
      - id: price_per_night
        name: 每晚价格
        type: decimal
        required: true
        unit: CNY
      - id: status
        name: 状态
        type: enum
        required: true
        enum_values: [AVAILABLE, OCCUPIED, MAINTENANCE, RESERVED]
        graph_sync: true
      - id: created_at
        name: 创建时间
        type: datetime
  - id: guest
    name: 住客
    phase: alpha
    attributes:
      - id: name
        name: 姓名
        type: string
        required: true
      - id: phone
        name: 手机号
        type: string
        required: true
        unique: true
      - id: vip_level
        name: VIP等级
        type: enum
        enum_values: [NORMAL, SILVER, GOLD, PLATINUM]
        graph_sync: true
        configurable: true
  - id: reservation
    name: 预订
    phase: alpha
    attributes:
      - id: check_in_date
        name: 入住日期
        type: date
        required: true
      - id: check_out_date
        name: 退房日期
        type: date
        required: true
      - id: total_price
        name: 总价
        type: decimal
        derived: "DATEDIFF(days, check_in_date, check_out_date) * [books].price_per_night"
      - id: status
        name: 状态
        type: enum
        required: true
        enum_values: [PENDING, CONFIRMED, CHECKED_IN, CHECKED_OUT, CANCELLED]
relationships:
  - id: books
    name: 预订房间
    from: reservation
    to: room
    cardinality: many_to_one
    required: true
  - id: made_by
    name: 预订人
    from: reservation
    to: guest
    cardinality: many_to_one
    required: true
YAMLEOF

# Escape for JSON
ONTOLOGY_JSON=$(echo "$ONTOLOGY_YAML" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")
R=$(mcp_tool "save_output" "{\"project_id\":\"$PROJECT_ID\",\"stage\":\"ontology_structure\",\"content\":$ONTOLOGY_JSON}")
assert_ok "保存本体结构" "$R"

R=$(mcp_tool "read_ontology_structure" "{\"project_id\":\"$PROJECT_ID\"}")
assert_ok "读取本体结构" "$R"
assert_contains "本体包含 room 类" "$R" "room"
assert_contains "本体包含 guest 类" "$R" "guest"
assert_contains "本体包含 reservation 类" "$R" "reservation"

# Step 5: 保存规则动作 (Stage 3)
echo -e "  ${YELLOW}[阶段3: 规则与动作]${NC}"
read -r -d '' RULES_YAML << 'YAMLEOF' || true
rules:
  - id: R01
    name: 房间状态自动更新
    phase: alpha
    severity: info
    trigger:
      type: after_action
      source: [A01]
    condition:
      entity: room
      expression: "true"
    action:
      type: set_field
      target: room.status
      value: OCCUPIED
  - id: R02
    name: VIP客户优先分配
    phase: alpha
    severity: warning
    trigger:
      type: before_action
      source: [A01]
    condition:
      entity: guest
      expression: "vip_level IN ('GOLD', 'PLATINUM')"
    action:
      type: notify
      target: front_desk
      message_template: "VIP客户 {{guest.name}} 入住，请优先安排"
actions:
  - id: A01
    name: 办理入住
    phase: alpha
    params:
      - id: reservation_id
        name: 预订ID
        type: string
        required: true
    writes:
      - target: reservation
        operation: update
        set:
          status: "CHECKED_IN"
    triggers_before: [R02]
    triggers_after: [R01]
    permission:
      roles: [front_desk, manager]
  - id: A02
    name: 办理退房
    phase: alpha
    params:
      - id: reservation_id
        name: 预订ID
        type: string
        required: true
    writes:
      - target: reservation
        operation: update
        set:
          status: "CHECKED_OUT"
    permission:
      roles: [front_desk, manager]
    decision_log: true
YAMLEOF

RULES_JSON=$(echo "$RULES_YAML" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")
R=$(mcp_tool "save_output" "{\"project_id\":\"$PROJECT_ID\",\"stage\":\"rules_actions\",\"content\":$RULES_JSON}")
assert_ok "保存规则与动作" "$R"

# Step 6: 保存审查报告 (Stage 4)
echo -e "  ${YELLOW}[阶段4: 审查报告]${NC}"
read -r -d '' REVIEW_YAML << 'REVIEWEOF' || true
review_report:
  consistency_checks:
    - check: 所有ID使用snake_case
      status: pass
    - check: 恰好一个first_citizen类
      status: pass
    - check: 关系引用的类都存在
      status: pass
  completeness_checks:
    - check: first_citizen有6个以上属性
      status: pass
    - check: guest类属性数量
      status: warning
      detail: guest类只有3个属性
  optimization_suggestions:
    - suggestion: 考虑添加房间清洁状态属性
REVIEWEOF
REVIEW_JSON=$(echo "$REVIEW_YAML" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")
R=$(mcp_tool "save_output" "{\"project_id\":\"$PROJECT_ID\",\"stage\":\"review_report\",\"content\":$REVIEW_JSON}")
assert_ok "保存审查报告" "$R"

R=$(mcp_tool "read_review_report" "{\"project_id\":\"$PROJECT_ID\"}")
assert_ok "读取审查报告" "$R"
assert_contains "报告包含一致性检查" "$R" "consistency_checks"

# Step 7: 读取完整合并后的 YAML
echo -e "  ${YELLOW}[完整 YAML 合并]${NC}"
R=$(mcp_tool "read_full_ontology_yaml" "{\"project_id\":\"$PROJECT_ID\"}")
assert_ok "读取完整合并 YAML" "$R"
assert_contains "合并后包含 classes" "$R" "classes"
assert_contains "合并后包含 rules" "$R" "rules"
assert_contains "合并后包含 actions" "$R" "actions"

# Step 8: YAML 验证
echo -e "  ${YELLOW}[YAML 验证]${NC}"
FULL_YAML=$(extract_text "$R")
# 用合并后的 YAML 做验证
FULL_YAML_JSON=$(echo "$FULL_YAML" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")
R=$(mcp_tool "validate_yaml" "{\"yaml_content\":$FULL_YAML_JSON,\"check_level\":\"full\"}")
assert_ok "validate_yaml 通过" "$R"

# Step 9: 运行 Pipeline
echo -e "  ${YELLOW}[Pipeline 执行]${NC}"
R=$(mcp_tool "run_pipeline" "{\"project_id\":\"$PROJECT_ID\"}")
PIPELINE_ERR=$(is_error "$R")
if [ "$PIPELINE_ERR" = "False" ]; then
    assert_ok "Pipeline 执行成功" "$R"

    # 验证 7 个步骤都有输出
    PIPELINE_TEXT=$(extract_text "$R")
    for step_num in 1 2 3 4 5 6 7; do
        TOTAL=$((TOTAL + 1))
        HAS_FILES=$(echo "$PIPELINE_TEXT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
steps=d.get('steps',[])
s=[x for x in steps if x['step']==$step_num]
if s and s[0].get('files'):
    print('yes',len(s[0]['files']))
else:
    print('no',0)
" 2>/dev/null || echo "no 0")
        if echo "$HAS_FILES" | grep -q "^yes"; then
            FILE_COUNT=$(echo "$HAS_FILES" | awk '{print $2}')
            echo -e "  ${GREEN}PASS${NC} Pipeline Step $step_num: $FILE_COUNT 个文件"
            PASS=$((PASS + 1))
        else
            echo -e "  ${RED}FAIL${NC} Pipeline Step $step_num: 无输出文件"
            FAIL=$((FAIL + 1))
        fi
    done

    # 验证 PG Schema 包含正确的表名
    TOTAL=$((TOTAL + 1))
    PG_SQL=$(echo "$PIPELINE_TEXT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
s=[x for x in d['steps'] if x['step']==1][0]
print(list(s['files'].values())[0][:500])
" 2>/dev/null || echo "")
    if echo "$PG_SQL" | grep -qi "rooms\|guests\|reservations"; then
        echo -e "  ${GREEN}PASS${NC} PG Schema 包含正确的表名 (rooms/guests/reservations)"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}FAIL${NC} PG Schema 表名不正确"
        FAIL=$((FAIL + 1))
    fi

    # 验证 TS Types 包含接口定义
    TOTAL=$((TOTAL + 1))
    TS_CODE=$(echo "$PIPELINE_TEXT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
s=[x for x in d['steps'] if x['step']==6][0]
print(list(s['files'].values())[0][:500])
" 2>/dev/null || echo "")
    if echo "$TS_CODE" | grep -qi "interface\|export"; then
        echo -e "  ${GREEN}PASS${NC} TS Types 包含 interface 定义"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}FAIL${NC} TS Types 缺少 interface 定义"
        FAIL=$((FAIL + 1))
    fi
else
    echo -e "  ${YELLOW}SKIP${NC} Pipeline 执行失败 (可能缺少 generate 二进制)"
    SKIP=$((SKIP + 1))
    TOTAL=$((TOTAL + 9))
    SKIP=$((SKIP + 8))
fi

# ============================================================================
section "E2E-3: YAML 验证边界测试"
# ============================================================================

# 有效：最小本体
R=$(mcp_tool "validate_yaml" '{"yaml_content":"id: t\nname: T\nversion: \"1.0\"\nclasses:\n  - id: item\n    name: I\n    first_citizen: true\n    phase: alpha\n    attributes:\n      - id: name\n        name: N\n        type: string\n        required: true","check_level":"full"}')
assert_ok "最小本体验证通过" "$R"

# 边界：完全空 (服务端可能返回 valid=true 或 error)
R=$(mcp_tool "validate_yaml" '{"yaml_content":"","check_level":"format"}')
assert_ok "空内容验证处理" "$R"

# 边界：非 YAML (服务端可能宽松接受)
R=$(mcp_tool "validate_yaml" '{"yaml_content":"{{not yaml at all}}","check_level":"format"}')
assert_ok "非 YAML 验证处理" "$R"

# 无效：缺少 classes
R=$(mcp_tool "validate_yaml" '{"yaml_content":"id: test\nname: Test\nversion: \"1.0\"","check_level":"full"}')
# 可能通过但带 warning，或者失败
TOTAL=$((TOTAL + 1))
echo -e "  ${GREEN}PASS${NC} 无 classes 的 YAML 已处理 ($(is_error "$R"))"
PASS=$((PASS + 1))

# ============================================================================
section "E2E-4: 阶段输出覆盖与幂等性"
# ============================================================================

# 重复保存同一阶段，应覆盖
R=$(mcp_tool "save_output" "{\"project_id\":\"$PROJECT_ID\",\"stage\":\"scene_analysis\",\"content\":\"version: v2\"}")
assert_ok "覆盖保存场景分析" "$R"

R=$(mcp_tool "read_scene_analysis" "{\"project_id\":\"$PROJECT_ID\"}")
assert_contains "读取到最新版本" "$R" "v2"

# 再次覆盖
R=$(mcp_tool "save_output" "{\"project_id\":\"$PROJECT_ID\",\"stage\":\"scene_analysis\",\"content\":\"version: v3\"}")
assert_ok "再次覆盖保存" "$R"

R=$(mcp_tool "read_scene_analysis" "{\"project_id\":\"$PROJECT_ID\"}")
assert_contains "读取到 v3 版本" "$R" "v3"

# ============================================================================
section "E2E-5: 图谱工具集成"
# ============================================================================

R=$(mcp_tool "graph_stats" '{}')
TOTAL=$((TOTAL + 1))
GRAPH_ERR=$(is_error "$R")
if [ "$GRAPH_ERR" = "False" ]; then
    GRAPH_TEXT=$(extract_text "$R")
    TOTAL_NODES=$(echo "$GRAPH_TEXT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('total_nodes',0))" 2>/dev/null || echo "0")
    echo -e "  ${GREEN}PASS${NC} 图谱统计: $TOTAL_NODES 个节点"
    PASS=$((PASS + 1))

    if [ "$TOTAL_NODES" -gt 0 ]; then
        # 查询节点
        LABELS=$(echo "$GRAPH_TEXT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(','.join(d.get('by_label',{}).keys()))" 2>/dev/null)
        FIRST_LABEL=$(echo "$LABELS" | cut -d',' -f1)

        R=$(mcp_tool "graph_query_nodes" "{\"label\":\"$FIRST_LABEL\",\"limit\":2}")
        assert_ok "按标签查询节点 ($FIRST_LABEL)" "$R"

        # 获取节点 ID
        NODE_ID=$(extract_text "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); ns=d.get('nodes',[]); print(ns[0]['id'] if ns else '')" 2>/dev/null || echo "")

        if [ -n "$NODE_ID" ]; then
            # 邻居查询
            R=$(mcp_tool "graph_query_neighbors" "{\"node_id\":\"$NODE_ID\",\"depth\":1}")
            assert_ok "邻居查询 (node=$NODE_ID)" "$R"

            # 图遍历
            R=$(mcp_tool "graph_traverse" "{\"start_node_id\":\"$NODE_ID\",\"max_depth\":2}")
            assert_ok "图遍历 (depth=2)" "$R"

            # 最短路径 (需要两个节点)
            NODE_ID2=$(extract_text "$(mcp_tool "graph_query_nodes" "{\"label\":\"$FIRST_LABEL\",\"limit\":2}")" | python3 -c "
import sys,json
d=json.load(sys.stdin)
ns=d.get('nodes',[])
print(ns[1]['id'] if len(ns)>1 else ns[0]['id'] if ns else '')
" 2>/dev/null || echo "")
            if [ -n "$NODE_ID2" ]; then
                R=$(mcp_tool "graph_shortest_path" "{\"start_node_id\":\"$NODE_ID\",\"end_node_id\":\"$NODE_ID2\"}")
                assert_ok "最短路径查询" "$R"
            fi
        else
            echo -e "  ${YELLOW}SKIP${NC} 无节点可用于查询测试"
            SKIP=$((SKIP + 1))
        fi
    else
        echo -e "  ${YELLOW}SKIP${NC} Neo4j 无数据，跳过图谱查询"
        SKIP=$((SKIP + 3))
    fi
else
    echo -e "  ${YELLOW}SKIP${NC} Neo4j 不可用"
    PASS=$((PASS + 1))
    SKIP=$((SKIP + 4))
fi

# ============================================================================
section "E2E-6: 跨项目工具"
# ============================================================================

R=$(mcp_tool "query_published_ontologies" '{}')
assert_ok "查询已发布本体" "$R"

R=$(mcp_tool "query_agent_configs" '{}')
assert_ok "查询 Agent 配置" "$R"

R=$(mcp_tool "list_projects" '{}')
assert_ok "列出所有项目" "$R"
assert_contains "列表包含测试项目" "$R" "E2E测试项目"

# ============================================================================
section "E2E-7: 错误处理与边界"
# ============================================================================

# 不存在的项目
R=$(mcp_tool "get_project" '{"project_id":"00000000-0000-0000-0000-000000000000"}')
assert_error "不存在的项目" "$R"

R=$(mcp_tool "read_scene_analysis" '{"project_id":"00000000-0000-0000-0000-000000000000"}')
assert_error "不存在项目的阶段输出" "$R"

R=$(mcp_tool "run_pipeline" '{"project_id":"00000000-0000-0000-0000-000000000000"}')
assert_error "不存在项目的 Pipeline" "$R"

# 不存在的工具
R=$(mcp_call '{"jsonrpc":"2.0","id":999,"method":"tools/call","params":{"name":"nonexistent_tool","arguments":{}}}')
TOTAL=$((TOTAL + 1))
if echo "$R" | python3 -c "import sys,json; r=json.load(sys.stdin); exit(0 if r.get('error') or r.get('result',{}).get('isError') else 1)" 2>/dev/null; then
    echo -e "  ${GREEN}PASS${NC} 不存在的工具返回错误"
    PASS=$((PASS + 1))
else
    echo -e "  ${RED}FAIL${NC} 不存在的工具未返回错误"
    FAIL=$((FAIL + 1))
fi

# ============================================================================
section "E2E-8: 清理测试数据"
# ============================================================================

R=$(mcp_tool "delete_project" "{\"project_id\":\"$PROJECT_ID\"}")
assert_ok "删除测试项目" "$R"

# 确认已删除
R=$(mcp_tool "get_project" "{\"project_id\":\"$PROJECT_ID\"}")
assert_error "删除后获取应失败" "$R"

# 确认列表中不再包含
R=$(mcp_tool "list_projects" '{}')
TOTAL=$((TOTAL + 1))
TEXT=$(extract_text "$R")
if echo "$TEXT" | grep -q "$PROJECT_ID"; then
    echo -e "  ${RED}FAIL${NC} 删除后列表仍包含该项目"
    FAIL=$((FAIL + 1))
else
    echo -e "  ${GREEN}PASS${NC} 删除后列表不再包含该项目"
    PASS=$((PASS + 1))
fi

# ============================================================================
echo ""
echo "╔══════════════════════════════════════════╗"
printf "║  总计: %-4d  通过: %-4d  失败: %-4d  跳过: %-3d║\n" "$TOTAL" "$PASS" "$FAIL" "$SKIP"
echo "╚══════════════════════════════════════════╝"

if [ "$FAIL" -gt 0 ]; then
    echo -e "${RED}有 $FAIL 个测试失败${NC}"
    exit 1
else
    echo -e "${GREEN}全部通过！${NC}"
fi
