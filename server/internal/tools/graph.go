package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"ontologyserver/internal/mcp"
	"ontologyserver/internal/neo"

	neo4jdriver "github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

// --- T11: graph_query_nodes ---

func registerGraphQueryNodes(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "graph_query_nodes",
		Description: "查询 Neo4j 图谱中的实例节点。支持按类类型过滤、按属性过滤、分页。",
		InputSchema: mcp.Schema(map[string]any{
			"label":   mcp.Prop("string", "节点标签（PascalCase），如 InventoryPosition、SparePart"),
			"filters": mcp.Prop("object", "属性过滤条件键值对"),
			"limit":   mcp.PropWithDefault("integer", "最大返回数", 100),
		}, []string{"label"}),
	}, func(ctx context.Context, raw json.RawMessage) *mcp.ToolCallResult {
		var args struct {
			Label   string         `json:"label"`
			Filters map[string]any `json:"filters"`
			Limit   int            `json:"limit"`
		}
		if err := json.Unmarshal(raw, &args); err != nil {
			return mcp.ErrorResult("invalid args: " + err.Error())
		}
		if args.Limit <= 0 {
			args.Limit = 100
		}

		// Build Cypher
		where, params := buildFilterClause("n", args.Filters)
		countCypher := fmt.Sprintf("MATCH (n:%s) %s RETURN count(n) AS total", args.Label, where)
		queryCypher := fmt.Sprintf("MATCH (n:%s) %s RETURN n LIMIT $limit", args.Label, where)
		params["limit"] = int64(args.Limit)

		// Count
		countRecs, err := d.Neo.ReadSingle(ctx, countCypher, copyParams(params))
		if err != nil {
			return mcp.ErrorResult("neo4j count: " + err.Error())
		}
		total := int64(0)
		if len(countRecs) > 0 {
			total = neo.ToInt64(countRecs[0].Values[0])
		}

		// Query
		recs, err := d.Neo.ReadSingle(ctx, queryCypher, params)
		if err != nil {
			return mcp.ErrorResult("neo4j query: " + err.Error())
		}

		nodes := make([]map[string]any, 0, len(recs))
		for _, rec := range recs {
			node := rec.Values[0].(neo4jdriver.Node)
			nodes = append(nodes, nodeToMap(node))
		}

		return jsonResult(map[string]any{"nodes": nodes, "total": total})
	})
}

// --- T12: graph_query_neighbors ---

func registerGraphQueryNeighbors(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "graph_query_neighbors",
		Description: "查询指定节点的所有邻居节点和连接关系。支持按关系类型和方向过滤。",
		InputSchema: mcp.Schema(map[string]any{
			"node_id":           mcp.Prop("string", "起点节点ID（UUID）"),
			"relationship_type": mcp.Prop("string", "关系类型过滤（可选）"),
			"direction":         mcp.PropEnum("string", "关系方向", []string{"out", "in", "both"}),
			"limit":             mcp.PropWithDefault("integer", "最大返回数", 50),
		}, []string{"node_id"}),
	}, func(ctx context.Context, raw json.RawMessage) *mcp.ToolCallResult {
		var args struct {
			NodeID  string `json:"node_id"`
			RelType string `json:"relationship_type"`
			Dir     string `json:"direction"`
			Limit   int    `json:"limit"`
		}
		if err := json.Unmarshal(raw, &args); err != nil {
			return mcp.ErrorResult("invalid args: " + err.Error())
		}
		if args.Dir == "" {
			args.Dir = "both"
		}
		if args.Limit <= 0 {
			args.Limit = 50
		}

		relPattern := buildRelPattern(args.RelType, args.Dir)
		cypher := fmt.Sprintf(
			"MATCH (n {id: $nodeId})%s(m) RETURN r, m, startNode(r) = n AS isOutgoing LIMIT $limit",
			relPattern,
		)
		params := map[string]any{"nodeId": args.NodeID, "limit": int64(args.Limit)}

		recs, err := d.Neo.ReadSingle(ctx, cypher, params)
		if err != nil {
			return mcp.ErrorResult("neo4j: " + err.Error())
		}

		neighbors := make([]map[string]any, 0, len(recs))
		for _, rec := range recs {
			rel := rec.Values[0].(neo4jdriver.Relationship)
			neighbor := rec.Values[1].(neo4jdriver.Node)
			isOutgoing := neo.ToBool(rec.Values[2])

			dir := "in"
			if isOutgoing {
				dir = "out"
			}

			neighbors = append(neighbors, map[string]any{
				"node":         nodeToMap(neighbor),
				"relationship": relToMap(rel, dir),
			})
		}

		return jsonResult(map[string]any{"neighbors": neighbors})
	})
}

// --- T13: graph_traverse ---

func registerGraphTraverse(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "graph_traverse",
		Description: "从起点节点沿关系扩散 N 跳，返回推演路径上的所有节点和边。用于正向扩散和反向溯源。",
		InputSchema: mcp.Schema(map[string]any{
			"start_node_id":      mcp.Prop("string", "起点节点ID"),
			"direction":          mcp.PropEnum("string", "遍历方向：out=正向扩散，in=反向溯源，both=双向", []string{"out", "in", "both"}),
			"max_hops":           mcp.PropWithDefault("integer", "最大跳数", 3),
			"relationship_types": mcp.Prop("array", "限定遍历的关系类型（可选）"),
			"filter_labels":      mcp.Prop("array", "只返回指定标签的节点（可选）"),
		}, []string{"start_node_id", "direction"}),
	}, func(ctx context.Context, raw json.RawMessage) *mcp.ToolCallResult {
		var args struct {
			StartNodeID string   `json:"start_node_id"`
			Direction   string   `json:"direction"`
			MaxHops     int      `json:"max_hops"`
			RelTypes    []string `json:"relationship_types"`
			Labels      []string `json:"filter_labels"`
		}
		if err := json.Unmarshal(raw, &args); err != nil {
			return mcp.ErrorResult("invalid args: " + err.Error())
		}
		if args.MaxHops <= 0 {
			args.MaxHops = 3
		}

		relTypeFilter := ""
		if len(args.RelTypes) > 0 {
			relTypeFilter = ":" + strings.Join(args.RelTypes, "|")
		}

		var arrow string
		switch args.Direction {
		case "out":
			arrow = fmt.Sprintf("-[r%s*1..%d]->", relTypeFilter, args.MaxHops)
		case "in":
			arrow = fmt.Sprintf("<-[r%s*1..%d]-", relTypeFilter, args.MaxHops)
		default:
			arrow = fmt.Sprintf("-[r%s*1..%d]-", relTypeFilter, args.MaxHops)
		}

		labelFilter := ""
		if len(args.Labels) > 0 {
			conditions := make([]string, len(args.Labels))
			for i, l := range args.Labels {
				conditions[i] = fmt.Sprintf("any(lbl IN labels(m) WHERE lbl = '%s')", l)
			}
			labelFilter = " WHERE " + strings.Join(conditions, " OR ")
		}

		cypher := fmt.Sprintf(
			"MATCH p = (n {id: $startId})%s(m)%s RETURN p LIMIT 200",
			arrow, labelFilter,
		)
		params := map[string]any{"startId": args.StartNodeID}

		recs, err := d.Neo.ReadSingle(ctx, cypher, params)
		if err != nil {
			return mcp.ErrorResult("neo4j: " + err.Error())
		}

		// Deduplicate nodes and relationships across all paths
		nodeSet := make(map[string]map[string]any)
		relSet := make(map[string]map[string]any)
		paths := make([]map[string]any, 0, len(recs))

		for _, rec := range recs {
			path := rec.Values[0].(neo4jdriver.Path)
			pathNodes := make([]map[string]any, 0)
			pathRels := make([]map[string]any, 0)

			for _, n := range path.Nodes {
				nm := nodeToMap(n)
				nodeSet[nm["id"].(string)] = nm
				pathNodes = append(pathNodes, nm)
			}
			for _, r := range path.Relationships {
				rm := map[string]any{
					"type":       r.Type,
					"from":       nodeIDFromElementId(path, r.StartElementId),
					"to":         nodeIDFromElementId(path, r.EndElementId),
					"properties": propsMap(r.Props),
				}
				key := fmt.Sprintf("%s-%s-%s", rm["from"], r.Type, rm["to"])
				relSet[key] = rm
				pathRels = append(pathRels, rm)
			}

			paths = append(paths, map[string]any{
				"nodes":         pathNodes,
				"relationships": pathRels,
				"hops":          len(path.Relationships),
			})
		}

		return jsonResult(map[string]any{
			"paths":              paths,
			"total_nodes":        len(nodeSet),
			"total_relationships": len(relSet),
		})
	})
}

// --- T14: graph_shortest_path ---

func registerGraphShortestPath(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "graph_shortest_path",
		Description: "查找两个节点之间的最短路径。用于路径发现推演模式。",
		InputSchema: mcp.Schema(map[string]any{
			"from_node_id":       mcp.Prop("string", "起点节点ID"),
			"to_node_id":         mcp.Prop("string", "终点节点ID"),
			"max_hops":           mcp.PropWithDefault("integer", "最大路径长度", 6),
			"relationship_types": mcp.Prop("array", "限定关系类型（可选）"),
		}, []string{"from_node_id", "to_node_id"}),
	}, func(ctx context.Context, raw json.RawMessage) *mcp.ToolCallResult {
		var args struct {
			FromNodeID string   `json:"from_node_id"`
			ToNodeID   string   `json:"to_node_id"`
			MaxHops    int      `json:"max_hops"`
			RelTypes   []string `json:"relationship_types"`
		}
		if err := json.Unmarshal(raw, &args); err != nil {
			return mcp.ErrorResult("invalid args: " + err.Error())
		}
		if args.MaxHops <= 0 {
			args.MaxHops = 6
		}

		relFilter := ""
		if len(args.RelTypes) > 0 {
			relFilter = ":" + strings.Join(args.RelTypes, "|")
		}

		cypher := fmt.Sprintf(
			"MATCH p = shortestPath((a {id: $fromId})-[%s*..%d]-(b {id: $toId})) RETURN p",
			relFilter, args.MaxHops,
		)
		params := map[string]any{"fromId": args.FromNodeID, "toId": args.ToNodeID}

		recs, err := d.Neo.ReadSingle(ctx, cypher, params)
		if err != nil {
			return mcp.ErrorResult("neo4j: " + err.Error())
		}

		if len(recs) == 0 {
			return jsonResult(map[string]any{"found": false, "path": nil, "alternative_paths": []any{}})
		}

		path := recs[0].Values[0].(neo4jdriver.Path)
		pathNodes := make([]map[string]any, 0, len(path.Nodes))
		pathRels := make([]map[string]any, 0, len(path.Relationships))

		for _, n := range path.Nodes {
			pathNodes = append(pathNodes, nodeToMap(n))
		}
		for _, r := range path.Relationships {
			pathRels = append(pathRels, map[string]any{
				"type":       r.Type,
				"from":       nodeIDFromElementId(path, r.StartElementId),
				"to":         nodeIDFromElementId(path, r.EndElementId),
				"properties": propsMap(r.Props),
			})
		}

		return jsonResult(map[string]any{
			"found": true,
			"path": map[string]any{
				"nodes":         pathNodes,
				"relationships": pathRels,
				"length":        len(path.Relationships),
			},
			"alternative_paths": []any{},
		})
	})
}

// --- T15: graph_aggregate ---

func registerGraphAggregate(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "graph_aggregate",
		Description: "按指定维度聚合图谱子图，返回统计结果。用于子图聚合推演模式。",
		InputSchema: mcp.Schema(map[string]any{
			"group_by_label":    mcp.Prop("string", "聚合维度的节点标签（如 Warehouse）"),
			"target_label":      mcp.Prop("string", "被聚合的节点标签（如 InventoryPosition）"),
			"relationship_type": mcp.Prop("string", "连接两者的关系类型（如 LOCATED_IN）"),
			"metrics":           mcp.Prop("array", "聚合指标列表（如 [\"SUM:inventory_value\", \"COUNT:*\", \"AVG:current_qty\"]）"),
		}, []string{"group_by_label", "target_label", "relationship_type", "metrics"}),
	}, func(ctx context.Context, raw json.RawMessage) *mcp.ToolCallResult {
		var args struct {
			GroupByLabel string   `json:"group_by_label"`
			TargetLabel  string   `json:"target_label"`
			RelType      string   `json:"relationship_type"`
			Metrics      []string `json:"metrics"`
		}
		if err := json.Unmarshal(raw, &args); err != nil {
			return mcp.ErrorResult("invalid args: " + err.Error())
		}

		if args.GroupByLabel == "" || args.TargetLabel == "" || args.RelType == "" {
			return mcp.ErrorResult("group_by_label, target_label, and relationship_type are required")
		}
		if len(args.Metrics) == 0 {
			return mcp.ErrorResult("metrics array is required and must not be empty")
		}

		// Build aggregation expressions
		aggParts := make([]string, 0, len(args.Metrics))
		for i, m := range args.Metrics {
			parts := strings.SplitN(m, ":", 2)
			if len(parts) != 2 {
				return mcp.ErrorResult(fmt.Sprintf("invalid metric format: %s (expected AGG:field)", m))
			}
			fn, field := strings.ToUpper(parts[0]), parts[1]
			alias := fmt.Sprintf("m%d", i)
			switch fn {
			case "COUNT":
				aggParts = append(aggParts, fmt.Sprintf("count(t) AS %s", alias))
			case "SUM":
				aggParts = append(aggParts, fmt.Sprintf("sum(t.%s) AS %s", field, alias))
			case "AVG":
				aggParts = append(aggParts, fmt.Sprintf("avg(t.%s) AS %s", field, alias))
			case "MIN":
				aggParts = append(aggParts, fmt.Sprintf("min(t.%s) AS %s", field, alias))
			case "MAX":
				aggParts = append(aggParts, fmt.Sprintf("max(t.%s) AS %s", field, alias))
			default:
				return mcp.ErrorResult(fmt.Sprintf("unsupported aggregation: %s", fn))
			}
		}

		cypher := fmt.Sprintf(
			"MATCH (g:%s)<-[:%s]-(t:%s) RETURN g, %s",
			args.GroupByLabel, args.RelType, args.TargetLabel,
			strings.Join(aggParts, ", "),
		)

		recs, err := d.Neo.ReadSingle(ctx, cypher, nil)
		if err != nil {
			return mcp.ErrorResult("neo4j: " + err.Error())
		}

		groups := make([]map[string]any, 0, len(recs))
		for _, rec := range recs {
			groupNode := rec.Values[0].(neo4jdriver.Node)
			metrics := make(map[string]any)
			for i, m := range args.Metrics {
				metrics[m] = rec.Values[i+1]
			}
			groups = append(groups, map[string]any{
				"node":    nodeToMap(groupNode),
				"metrics": metrics,
			})
		}

		return jsonResult(map[string]any{"groups": groups})
	})
}

// --- T16: graph_stats ---

func registerGraphStats(router *mcp.Router, d *Deps) {
	router.Register(mcp.ToolDef{
		Name:        "graph_stats",
		Description: "查询图谱的全局统计：各类型节点数、关系数。供实例图谱浏览器的统计栏使用。",
		InputSchema: mcp.Schema(map[string]any{
			"ontology_id": mcp.Prop("string", "本体ID（目前未使用，预留多图谱隔离）"),
		}, []string{"ontology_id"}),
	}, func(ctx context.Context, raw json.RawMessage) *mcp.ToolCallResult {
		// Node counts by label
		labelCypher := "CALL db.labels() YIELD label MATCH (n) WHERE label IN labels(n) RETURN label, count(n) AS cnt"
		labelRecs, err := d.Neo.ReadSingle(ctx, labelCypher, nil)
		if err != nil {
			return mcp.ErrorResult("neo4j labels: " + err.Error())
		}

		byLabel := make(map[string]int64)
		totalNodes := int64(0)
		for _, rec := range labelRecs {
			label := neo.ToString(rec.Values[0])
			cnt := neo.ToInt64(rec.Values[1])
			byLabel[label] = cnt
			totalNodes += cnt
		}

		// Relationship count
		relCypher := "MATCH ()-[r]->() RETURN count(r) AS cnt"
		relRecs, err := d.Neo.ReadSingle(ctx, relCypher, nil)
		if err != nil {
			return mcp.ErrorResult("neo4j rels: " + err.Error())
		}
		totalRels := int64(0)
		if len(relRecs) > 0 {
			totalRels = neo.ToInt64(relRecs[0].Values[0])
		}

		return jsonResult(map[string]any{
			"total_nodes":         totalNodes,
			"total_relationships": totalRels,
			"by_label":            byLabel,
		})
	})
}

// --- Helpers ---

func buildFilterClause(alias string, filters map[string]any) (string, map[string]any) {
	if len(filters) == 0 {
		return "", make(map[string]any)
	}
	params := make(map[string]any)
	conditions := make([]string, 0, len(filters))
	i := 0
	for k, v := range filters {
		paramName := fmt.Sprintf("f%d", i)
		conditions = append(conditions, fmt.Sprintf("%s.%s = $%s", alias, k, paramName))
		params[paramName] = v
		i++
	}
	return "WHERE " + strings.Join(conditions, " AND "), params
}

func buildRelPattern(relType, direction string) string {
	relSpec := "[r]"
	if relType != "" {
		relSpec = fmt.Sprintf("[r:%s]", relType)
	}
	switch direction {
	case "out":
		return "-" + relSpec + "->"
	case "in":
		return "<-" + relSpec + "-"
	default:
		return "-" + relSpec + "-"
	}
}

func nodeToMap(n neo4jdriver.Node) map[string]any {
	id := ""
	if v, ok := n.Props["id"]; ok {
		id = neo.ToString(v)
	}
	label := ""
	if len(n.Labels) > 0 {
		label = n.Labels[0]
	}
	return map[string]any{
		"id":         id,
		"label":      label,
		"properties": propsMap(n.Props),
	}
}

func relToMap(r neo4jdriver.Relationship, dir string) map[string]any {
	return map[string]any{
		"type":       r.Type,
		"direction":  dir,
		"properties": propsMap(r.Props),
	}
}

func propsMap(props map[string]any) map[string]any {
	m := make(map[string]any, len(props))
	for k, v := range props {
		m[k] = v
	}
	return m
}

func nodeIDFromElementId(path neo4jdriver.Path, elementId string) string {
	for _, n := range path.Nodes {
		if n.ElementId == elementId {
			if id, ok := n.Props["id"]; ok {
				return neo.ToString(id)
			}
		}
	}
	return elementId
}

func copyParams(src map[string]any) map[string]any {
	dst := make(map[string]any, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}

func jsonResult(data map[string]any) *mcp.ToolCallResult {
	return mcp.TextResult(data)
}
