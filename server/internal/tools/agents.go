package tools

import (
	"context"
	"encoding/json"

	"ontologyserver/internal/mcp"
)

func registerQueryAgentConfigs(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "query_agent_configs",
		Description: "查询已注册的业务 Agent 的工具绑定和提示词概要。用于审核员检查图谱同步标记的合理性。",
		InputSchema: mcp.Schema(map[string]any{
			"agent_id": mcp.Prop("string", "指定 Agent ID（可选）"),
		}, nil),
	}, func(ctx context.Context, args json.RawMessage) *mcp.ToolCallResult {
		// Query Weave API for registered agents
		// For now, return a static list of known business agents from the spare parts domain.
		// In production, this would call Weave's /v1/agents endpoint.
		agents := []map[string]any{
			{
				"id":   "inventory-steward",
				"name": "库存管家",
				"tools": []string{
					"query_inventory_position",
					"execute_record_outbound",
					"execute_record_inbound",
					"graph_equipment_parts",
				},
				"graph_queries_used": []string{
					"设备→备件→头寸遍历需要 criticality, current_qty 过滤",
					"库房→头寸聚合需要 inventory_value, is_stale",
				},
			},
			{
				"id":   "stale-detective",
				"name": "呆滞侦探",
				"tools": []string{
					"query_inventory_position",
					"execute_mark_stale",
					"graph_stale_analysis",
				},
				"graph_queries_used": []string{
					"头寸→备件遍历需要 last_consumed_date, stale_age_days",
				},
			},
			{
				"id":   "procurement-advisor",
				"name": "采购建议师",
				"tools": []string{
					"query_inventory_position",
					"query_purchase_order",
					"execute_create_purchase_suggestion",
				},
				"graph_queries_used": []string{
					"备件→头寸聚合需要 safety_gap, monthly_avg_consumption",
				},
			},
		}

		var p struct {
			AgentID string `json:"agent_id"`
		}
		json.Unmarshal(args, &p)

		if p.AgentID != "" {
			for _, a := range agents {
				if a["id"] == p.AgentID {
					return mcp.TextResult(map[string]any{"agents": []map[string]any{a}})
				}
			}
			return mcp.TextResult(map[string]any{"agents": []map[string]any{}})
		}

		return mcp.TextResult(map[string]any{"agents": agents})
	})
}
