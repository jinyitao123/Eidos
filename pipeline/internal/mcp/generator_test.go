package mcp

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"ontologypipeline/internal/types"

	"gopkg.in/yaml.v3"
)

func TestGenerateMetricToolAggregate(t *testing.T) {
	m := types.Metric{
		ID:          "stale_ratio",
		Name:        "呆滞率",
		Description: "库存呆滞比例",
		Kind:        "aggregate",
		Granularity: "monthly",
		Dimensions:  []string{"warehouse", "category"},
		Params: []types.MetricParam{
			{ID: "days_threshold", Name: "呆滞天数阈值", Type: "integer", Default: 180},
		},
	}

	tool := generateMetricTool(m)

	if tool.Name != "query_stale_ratio" {
		t.Errorf("expected tool name 'query_stale_ratio', got '%s'", tool.Name)
	}
	if !strings.Contains(tool.Description, "呆滞率") {
		t.Errorf("description should mention metric name, got '%s'", tool.Description)
	}

	var schema map[string]any
	json.Unmarshal(tool.InputSchema, &schema)
	props := schema["properties"].(map[string]any)

	if _, ok := props["warehouse"]; !ok {
		t.Error("expected 'warehouse' dimension in properties")
	}
	if _, ok := props["category"]; !ok {
		t.Error("expected 'category' dimension in properties")
	}
	if _, ok := props["days_threshold"]; !ok {
		t.Error("expected 'days_threshold' param in properties")
	}
	if _, ok := props["time_range"]; !ok {
		t.Error("expected 'time_range' in aggregate metric properties")
	}
	if _, ok := props["granularity"]; !ok {
		t.Error("expected 'granularity' in aggregate metric properties")
	}
}

func TestGenerateMetricToolClassification(t *testing.T) {
	m := types.Metric{
		ID:          "inventory_quadrant",
		Name:        "库存象限",
		Description: "库存四象限分类",
		Kind:        "classification",
		Buckets: []types.MetricBucket{
			{ID: "high_value_fast", Name: "高价值快周转"},
			{ID: "high_value_slow", Name: "高价值慢周转"},
		},
	}

	tool := generateMetricTool(m)

	if tool.Name != "classify_inventory_quadrant" {
		t.Errorf("expected classify_ prefix for classification metric, got '%s'", tool.Name)
	}

	var schema map[string]any
	json.Unmarshal(tool.InputSchema, &schema)
	props := schema["properties"].(map[string]any)

	if _, ok := props["entity_ids"]; !ok {
		t.Error("expected 'entity_ids' in classification metric properties")
	}

	required := schema["required"].([]any)
	found := false
	for _, r := range required {
		if r.(string) == "entity_ids" {
			found = true
		}
	}
	if !found {
		t.Error("entity_ids should be required for classification metrics")
	}

	// Classification should NOT have time_range
	if _, ok := props["time_range"]; ok {
		t.Error("classification metric should not have time_range")
	}
}

func TestGenerateFromSparePartsOntology(t *testing.T) {
	// 1. Read and parse the spare parts ontology YAML
	data, err := os.ReadFile("../../../docs/02-spare-parts-ontology.yaml")
	if err != nil {
		t.Fatalf("failed to read spare parts ontology YAML: %v", err)
	}

	var doc types.OntologyDoc
	if err := yaml.Unmarshal(data, &doc); err != nil {
		t.Fatalf("failed to parse ontology YAML: %v", err)
	}
	o := &doc.Ontology

	// Sanity-check that parsing worked
	if o.ID != "spare_parts" {
		t.Fatalf("expected ontology ID 'spare_parts', got '%s'", o.ID)
	}

	// 2. Generate MCP tools
	result := Generate(o)

	// Build a lookup of tool names for easy verification
	toolSet := make(map[string]bool)
	for _, tool := range result.Tools {
		toolSet[tool.Name] = true
	}

	// 3a. Verify query tools for all classes
	expectedClasses := []string{
		"inventory_position", "spare_part", "warehouse", "equipment",
		"stock_movement", "purchase_order", "inventory_snapshot", "decision_log",
	}
	for _, classID := range expectedClasses {
		toolName := "query_" + classID
		if !toolSet[toolName] {
			t.Errorf("expected query tool '%s' not found", toolName)
		}
	}
	if len(expectedClasses) != len(o.Classes) {
		t.Errorf("expected %d classes, ontology has %d", len(expectedClasses), len(o.Classes))
	}

	// 3b. Verify execute tools for all actions
	expectedActions := []string{
		"a01", "a02", "a03", "a04", "a05", "a06", "a07", "a08",
	}
	for _, actionID := range expectedActions {
		toolName := "execute_" + actionID
		if !toolSet[toolName] {
			t.Errorf("expected execute tool '%s' not found", toolName)
		}
	}
	if len(expectedActions) != len(o.Actions) {
		t.Errorf("expected %d actions, ontology has %d", len(expectedActions), len(o.Actions))
	}

	// 3c. Verify metric tools (aggregate -> query_ prefix, classification -> classify_ prefix)
	expectedMetricTools := []string{
		"query_stale_ratio",
		"query_risk_positions",
		"query_releasable_value",
		"query_consumption_trend",
		"classify_inventory_quadrant",
		"query_warehouse_health_score",
		"query_monthly_value_trend",
		"query_stockout_probability",
		"query_decision_accuracy",
	}
	for _, toolName := range expectedMetricTools {
		if !toolSet[toolName] {
			t.Errorf("expected metric tool '%s' not found", toolName)
		}
	}
	if len(expectedMetricTools) != len(o.Metrics) {
		t.Errorf("expected %d metrics, ontology has %d", len(expectedMetricTools), len(o.Metrics))
	}

	// 3d. Verify telemetry tool (spare parts ontology now has 3 telemetry streams)
	if len(o.Telemetry) > 0 {
		if !toolSet["query_telemetry"] {
			t.Error("ontology has telemetry but query_telemetry tool not found")
		}
	} else {
		if toolSet["query_telemetry"] {
			t.Error("ontology has no telemetry but query_telemetry tool was generated")
		}
	}

	// 3e. Verify query_ontology_metadata tool exists
	if !toolSet["query_ontology_metadata"] {
		t.Error("expected 'query_ontology_metadata' tool not found")
	}

	// 3f. Verify calc tools for functions
	expectedCalcTools := []string{
		"calc_calc_reorder_point",
		"calc_calc_stale_disposal_options",
	}
	for _, toolName := range expectedCalcTools {
		if !toolSet[toolName] {
			t.Errorf("expected calc tool '%s' not found", toolName)
		}
	}

	// 3g. Verify total tool count:
	//   8 query (classes) + 8 execute (actions) + 9 metric + 2 calc (functions)
	//   + 1 telemetry + 1 metadata = 29
	expectedToolCount := len(expectedClasses) + len(expectedActions) +
		len(expectedMetricTools) + len(o.Functions) + len(o.Telemetry) + 1 // +1 for metadata
	// telemetry contributes 0 or 1 tool (not len), adjust if telemetry exists
	if len(o.Telemetry) > 0 {
		expectedToolCount = expectedToolCount - len(o.Telemetry) + 1
	}
	if len(result.Tools) != expectedToolCount {
		t.Errorf("expected %d total tools, got %d", expectedToolCount, len(result.Tools))
	}

	// 3h. Verify GoFiles count: 1 per class (query_*.go) + 1 per action (execute_*.go)
	expectedGoFiles := len(expectedClasses) + len(expectedActions)
	if len(result.GoFiles) != expectedGoFiles {
		t.Errorf("expected %d Go files, got %d", expectedGoFiles, len(result.GoFiles))
	}
}

func TestGenerateTelemetryTool(t *testing.T) {
	o := &types.Ontology{
		Name: "spare_parts",
		ID:   "spare_parts",
		Telemetry: []types.Telemetry{
			{
				ID:           "motor_vibration",
				Name:         "电机振动",
				Aggregations: []string{"avg", "max", "p95"},
			},
			{
				ID:           "motor_temperature",
				Name:         "电机温度",
				Aggregations: []string{"avg", "min", "max"},
			},
		},
	}

	tool := generateTelemetryTool(o)

	if tool.Name != "query_telemetry" {
		t.Errorf("expected 'query_telemetry', got '%s'", tool.Name)
	}

	var schema map[string]any
	json.Unmarshal(tool.InputSchema, &schema)
	props := schema["properties"].(map[string]any)

	// Check telemetry_id enum
	telID := props["telemetry_id"].(map[string]any)
	enumVals := telID["enum"].([]any)
	if len(enumVals) != 2 {
		t.Errorf("expected 2 telemetry IDs in enum, got %d", len(enumVals))
	}

	// Check required fields
	required := schema["required"].([]any)
	requiredSet := make(map[string]bool)
	for _, r := range required {
		requiredSet[r.(string)] = true
	}
	if !requiredSet["telemetry_id"] || !requiredSet["source_id"] {
		t.Error("telemetry_id and source_id should be required")
	}

	// Check aggregation enum has merged values
	agg := props["aggregation"].(map[string]any)
	aggEnum := agg["enum"].([]any)
	if len(aggEnum) < 4 { // avg, max, p95, min
		t.Errorf("expected at least 4 aggregation methods, got %d", len(aggEnum))
	}
}

func TestGenerateFullWithMetricsAndTelemetry(t *testing.T) {
	o := &types.Ontology{
		Name: "test",
		ID:   "test",
		Classes: []types.Class{
			{ID: "item", Name: "物料", Attributes: []types.Attribute{
				{ID: "name", Name: "名称", Type: "string"},
			}},
		},
		Metrics: []types.Metric{
			{ID: "count", Name: "总数", Description: "物料总数", Kind: "aggregate"},
		},
		Telemetry: []types.Telemetry{
			{ID: "temp", Name: "温度", Aggregations: []string{"avg"}},
		},
	}

	result := Generate(o)

	// Should have: query_item + query_count + query_telemetry + query_ontology_metadata
	expectedTools := map[string]bool{
		"query_item":              false,
		"query_count":             false,
		"query_telemetry":         false,
		"query_ontology_metadata": false,
	}

	for _, tool := range result.Tools {
		if _, ok := expectedTools[tool.Name]; ok {
			expectedTools[tool.Name] = true
		}
	}

	for name, found := range expectedTools {
		if !found {
			t.Errorf("expected tool '%s' not found in generated tools", name)
		}
	}
}
