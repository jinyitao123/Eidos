#!/usr/bin/env bash
# MCP 工具冒烟测试脚本
# 用法: bash docs/test/mcp/curl_smoke_test.sh [MCP_URL]
# 默认: http://localhost:9091/

set -euo pipefail

MCP_URL="${1:-http://localhost:9091/}"
PASS=0
FAIL=0
TOTAL=0

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

call_mcp() {
    local name="$1"
    local args="$2"
    local desc="$3"
    local expect_error="${4:-false}"
    TOTAL=$((TOTAL + 1))

    local response
    response=$(curl -s -X POST "$MCP_URL" \
        -H 'Content-Type: application/json' \
        -d "{\"jsonrpc\":\"2.0\",\"id\":$TOTAL,\"method\":\"tools/call\",\"params\":{\"name\":\"$name\",\"arguments\":$args}}" \
        2>/dev/null)

    local is_error
    is_error=$(echo "$response" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('result',{}).get('isError', False))" 2>/dev/null || echo "PARSE_ERROR")

    if [ "$is_error" = "PARSE_ERROR" ]; then
        echo -e "  ${RED}FAIL${NC} [$name] $desc - 响应解析失败"
        FAIL=$((FAIL + 1))
        return
    fi

    if [ "$expect_error" = "true" ]; then
        if [ "$is_error" = "True" ]; then
            echo -e "  ${GREEN}PASS${NC} [$name] $desc (预期错误)"
            PASS=$((PASS + 1))
        else
            echo -e "  ${RED}FAIL${NC} [$name] $desc - 预期错误但成功了"
            FAIL=$((FAIL + 1))
        fi
    else
        if [ "$is_error" = "False" ]; then
            echo -e "  ${GREEN}PASS${NC} [$name] $desc"
            PASS=$((PASS + 1))
        else
            local err_msg
            err_msg=$(echo "$response" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r['result']['content'][0]['text'][:100])" 2>/dev/null || echo "unknown")
            echo -e "  ${RED}FAIL${NC} [$name] $desc - $err_msg"
            FAIL=$((FAIL + 1))
        fi
    fi
}

echo "============================================"
echo "  Ontology MCP 冒烟测试"
echo "  Target: $MCP_URL"
echo "============================================"
echo ""

# --- tools/list ---
echo -e "${YELLOW}[工具列表]${NC}"
TOTAL=$((TOTAL + 1))
TOOL_COUNT=$(curl -s -X POST "$MCP_URL" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":0,"method":"tools/list","params":{}}' \
    | python3 -c "import sys,json; r=json.load(sys.stdin); print(len(r['result']['tools']))" 2>/dev/null || echo "0")

if [ "$TOOL_COUNT" -ge 20 ]; then
    echo -e "  ${GREEN}PASS${NC} [tools/list] 发现 $TOOL_COUNT 个工具 (≥20)"
    PASS=$((PASS + 1))
else
    echo -e "  ${RED}FAIL${NC} [tools/list] 只发现 $TOOL_COUNT 个工具 (预期 ≥20)"
    FAIL=$((FAIL + 1))
fi

# --- 项目管理 ---
echo ""
echo -e "${YELLOW}[项目管理]${NC}"
call_mcp "list_projects" '{}' "列出所有项目"

# 创建测试项目
TOTAL=$((TOTAL + 1))
CREATE_RESPONSE=$(curl -s -X POST "$MCP_URL" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":100,"method":"tools/call","params":{"name":"create_project","arguments":{"name":"冒烟测试项目","description":"自动化测试"}}}')

PROJECT_ID=$(echo "$CREATE_RESPONSE" | python3 -c "import sys,json; r=json.load(sys.stdin); d=json.loads(r['result']['content'][0]['text']); print(d.get('id',''))" 2>/dev/null || echo "")

if [ -n "$PROJECT_ID" ] && [ "$PROJECT_ID" != "" ]; then
    echo -e "  ${GREEN}PASS${NC} [create_project] 创建项目 ID=$PROJECT_ID"
    PASS=$((PASS + 1))
else
    echo -e "  ${RED}FAIL${NC} [create_project] 创建失败"
    FAIL=$((FAIL + 1))
    PROJECT_ID="00000000-0000-0000-0000-000000000000"
fi

call_mcp "get_project" "{\"project_id\":\"$PROJECT_ID\"}" "获取项目详情"
call_mcp "get_project" '{"project_id":"00000000-0000-0000-0000-000000000000"}' "获取不存在的项目" "true"

# --- 阶段输出 ---
echo ""
echo -e "${YELLOW}[阶段输出]${NC}"
call_mcp "save_output" "{\"project_id\":\"$PROJECT_ID\",\"stage\":\"scene_analysis\",\"content\":\"测试场景分析内容\"}" "保存场景分析"
call_mcp "read_scene_analysis" "{\"project_id\":\"$PROJECT_ID\"}" "读取场景分析"

ONTOLOGY_YAML='classes:\n  - id: test_item\n    name: 测试条目\n    first_citizen: true\n    phase: alpha\n    attributes:\n      - id: name\n        name: 名称\n        type: string\n        required: true\nrelationships: []'
call_mcp "save_output" "{\"project_id\":\"$PROJECT_ID\",\"stage\":\"ontology_structure\",\"content\":\"$ONTOLOGY_YAML\"}" "保存本体结构"
call_mcp "read_ontology_structure" "{\"project_id\":\"$PROJECT_ID\"}" "读取本体结构"
call_mcp "read_full_ontology_yaml" "{\"project_id\":\"$PROJECT_ID\"}" "读取完整 YAML"
call_mcp "read_review_report" "{\"project_id\":\"$PROJECT_ID\"}" "读取审查报告 (可能为空)" "true"

# --- YAML 验证 ---
echo ""
echo -e "${YELLOW}[YAML 验证]${NC}"
VALID_YAML="id: test\nname: Test\nversion: '1.0'\nclasses:\n  - id: item\n    name: Item\n    first_citizen: true\n    phase: alpha\n    attributes:\n      - id: name\n        name: Name\n        type: string\n        required: true"
call_mcp "validate_yaml" "{\"yaml_content\":\"$VALID_YAML\",\"check_level\":\"full\"}" "验证有效 YAML"

INVALID_YAML="id: test\nname: Test\nversion: '1.0'\nclasses:\n  - id: BadName\n    name: Bad\n    phase: alpha\n    attributes:\n      - id: x\n        name: X\n        type: unknown_type"
call_mcp "validate_yaml" "{\"yaml_content\":\"$INVALID_YAML\",\"check_level\":\"format\"}" "验证无效 YAML (应返回错误列表)"

# --- 查询工具 ---
echo ""
echo -e "${YELLOW}[查询工具]${NC}"
call_mcp "query_published_ontologies" '{}' "查询已发布本体"
call_mcp "query_agent_configs" '{}' "查询 Agent 配置"

# --- 图谱工具 ---
echo ""
echo -e "${YELLOW}[图谱工具]${NC}"
call_mcp "graph_stats" '{}' "图谱统计"
call_mcp "graph_query_nodes" '{"label":"SparePart","limit":3}' "查询 SparePart 节点"
call_mcp "graph_query_nodes" '{"label":"Equipment","limit":3}' "查询 Equipment 节点"

# 获取一个节点 ID 用于邻居查询
NODE_ID=$(curl -s -X POST "$MCP_URL" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":200,"method":"tools/call","params":{"name":"graph_query_nodes","arguments":{"label":"SparePart","limit":1}}}' \
    | python3 -c "import sys,json; r=json.load(sys.stdin); d=json.loads(r['result']['content'][0]['text']); print(d['nodes'][0]['id'] if d.get('nodes') else '')" 2>/dev/null || echo "")

if [ -n "$NODE_ID" ]; then
    call_mcp "graph_query_neighbors" "{\"node_id\":\"$NODE_ID\",\"depth\":1}" "查询邻居节点"
    call_mcp "graph_traverse" "{\"start_node_id\":\"$NODE_ID\",\"max_depth\":2}" "图遍历"
else
    echo -e "  ${YELLOW}SKIP${NC} [graph_query_neighbors] 无可用节点"
    echo -e "  ${YELLOW}SKIP${NC} [graph_traverse] 无可用节点"
fi

call_mcp "graph_aggregate" '{"group_by_label":"Warehouse","target_label":"InventoryPosition","relationship_type":"LOCATED_IN","metrics":["COUNT:*","SUM:currentQty"]}' "聚合查询"

# --- Pipeline ---
echo ""
echo -e "${YELLOW}[Pipeline]${NC}"
call_mcp "run_pipeline" '{"project_id":"00000000-0000-0000-0000-000000000000"}' "Pipeline 不存在的项目" "true"

# --- 清理 ---
echo ""
echo -e "${YELLOW}[清理]${NC}"
call_mcp "delete_project" "{\"project_id\":\"$PROJECT_ID\"}" "删除测试项目"
call_mcp "delete_project" '{"project_id":"00000000-0000-0000-0000-000000000000"}' "删除不存在的项目" "true"

# --- 汇总 ---
echo ""
echo "============================================"
echo -e "  总计: $TOTAL | ${GREEN}通过: $PASS${NC} | ${RED}失败: $FAIL${NC}"
echo "============================================"

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
