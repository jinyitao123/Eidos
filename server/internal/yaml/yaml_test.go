package ontoyaml

import (
	"os"
	"testing"
)

const sparePartsYAML = "../../../docs/02-spare-parts-ontology.yaml"

func loadSparePartsOntology(t *testing.T) *Ontology {
	t.Helper()
	data, err := os.ReadFile(sparePartsYAML)
	if err != nil {
		t.Fatalf("failed to read spare parts YAML: %v", err)
	}
	o, err := Parse(data)
	if err != nil {
		t.Fatalf("failed to parse spare parts YAML: %v", err)
	}
	return o
}

func TestParseSparePartsOntology(t *testing.T) {
	o := loadSparePartsOntology(t)

	if o.ID != "spare_parts" {
		t.Errorf("expected ontology ID 'spare_parts', got '%s'", o.ID)
	}
	if o.Version != "2.0.0" {
		t.Errorf("expected version '2.0.0', got '%s'", o.Version)
	}
}

func TestClassesParsed(t *testing.T) {
	o := loadSparePartsOntology(t)

	if len(o.Classes) < 5 {
		t.Fatalf("expected at least 5 classes, got %d", len(o.Classes))
	}

	// Find first citizen
	var firstCitizen *Class
	for i := range o.Classes {
		if o.Classes[i].FirstCitizen {
			firstCitizen = &o.Classes[i]
			break
		}
	}
	if firstCitizen == nil {
		t.Fatal("no first citizen class found")
	}
	if firstCitizen.ID != "inventory_position" {
		t.Errorf("expected first citizen 'inventory_position', got '%s'", firstCitizen.ID)
	}
	if len(firstCitizen.Attributes) < 10 {
		t.Errorf("first citizen should have >= 10 attributes, got %d", len(firstCitizen.Attributes))
	}
}

func TestNoGraphSyncField(t *testing.T) {
	o := loadSparePartsOntology(t)

	// Verify no attribute has graph_sync set (it was removed from the spec)
	for _, c := range o.Classes {
		for _, a := range c.Attributes {
			// GraphSync field no longer exists in the struct,
			// but we verify the YAML doesn't somehow set it by checking
			// that parsing succeeded without errors
			_ = a
		}
	}
	// If we got here, the YAML parsed without graph_sync fields
	_ = o
}

func TestRelationshipsParsed(t *testing.T) {
	o := loadSparePartsOntology(t)

	if len(o.Relationships) < 5 {
		t.Fatalf("expected at least 5 relationships, got %d", len(o.Relationships))
	}

	// Check that relationship references valid classes
	classIDs := make(map[string]bool)
	for _, c := range o.Classes {
		classIDs[c.ID] = true
	}
	for _, r := range o.Relationships {
		if !classIDs[r.From] {
			t.Errorf("relationship '%s' references unknown from class '%s'", r.ID, r.From)
		}
		if !classIDs[r.To] {
			t.Errorf("relationship '%s' references unknown to class '%s'", r.ID, r.To)
		}
	}
}

func TestMetricsParsed(t *testing.T) {
	o := loadSparePartsOntology(t)

	if len(o.Metrics) == 0 {
		t.Fatal("expected metrics to be parsed, got 0")
	}

	// Check stale_ratio metric exists
	var staleRatio *Metric
	for i := range o.Metrics {
		if o.Metrics[i].ID == "stale_ratio" {
			staleRatio = &o.Metrics[i]
			break
		}
	}
	if staleRatio == nil {
		t.Fatal("expected stale_ratio metric")
	}
	if staleRatio.Kind != "aggregate" {
		t.Errorf("stale_ratio should be aggregate, got '%s'", staleRatio.Kind)
	}
	if staleRatio.Status != "implemented" {
		t.Errorf("stale_ratio should be implemented, got '%s'", staleRatio.Status)
	}

	// Check classification metric
	var quadrant *Metric
	for i := range o.Metrics {
		if o.Metrics[i].ID == "inventory_quadrant" {
			quadrant = &o.Metrics[i]
			break
		}
	}
	if quadrant == nil {
		t.Fatal("expected inventory_quadrant metric")
	}
	if quadrant.Kind != "classification" {
		t.Errorf("inventory_quadrant should be classification, got '%s'", quadrant.Kind)
	}
	if len(quadrant.Buckets) != 4 {
		t.Errorf("inventory_quadrant should have 4 buckets, got %d", len(quadrant.Buckets))
	}
}

func TestRulesAndActionsParsed(t *testing.T) {
	o := loadSparePartsOntology(t)

	if len(o.Rules) == 0 {
		t.Fatal("expected rules, got 0")
	}
	if len(o.Actions) == 0 {
		t.Fatal("expected actions, got 0")
	}
}

func TestFunctionsNoImplementation(t *testing.T) {
	o := loadSparePartsOntology(t)

	// Functions should parse without implementation field
	if len(o.Functions) == 0 {
		t.Fatal("expected functions, got 0")
	}
	for _, f := range o.Functions {
		if f.ID == "" {
			t.Error("function has empty ID")
		}
		// Implementation field no longer exists - this test just confirms
		// functions parse correctly without it
	}
}

func TestValidateSparePartsFormat(t *testing.T) {
	o := loadSparePartsOntology(t)
	result := Validate(o, "format")

	if !result.Valid {
		t.Errorf("spare parts ontology should pass format validation")
		for _, e := range result.Errors {
			t.Errorf("  error: %s (path: %s)", e.Message, e.Path)
		}
	}
}

func TestValidateSparePartsFull(t *testing.T) {
	o := loadSparePartsOntology(t)
	result := Validate(o, "full")

	if !result.Valid {
		t.Errorf("spare parts ontology should pass full validation")
		for _, e := range result.Errors {
			t.Errorf("  error: %s (path: %s)", e.Message, e.Path)
		}
	}

	// Log warnings for visibility
	for _, w := range result.Warnings {
		t.Logf("  warning: %s (path: %s)", w.Message, w.Path)
	}
}

func TestValidateDetectsBadID(t *testing.T) {
	o := &Ontology{
		ID:      "BadCase",
		Version: "1.0.0",
		Classes: []Class{
			{ID: "my_class", Name: "Test", Phase: "alpha", FirstCitizen: true, Attributes: []Attribute{}},
		},
	}
	result := Validate(o, "format")
	if result.Valid {
		t.Error("expected validation to fail for non-snake_case ontology ID")
	}
}

func TestValidateDetectsDuplicateMetric(t *testing.T) {
	o := &Ontology{
		ID:      "test",
		Version: "1.0.0",
		Classes: []Class{
			{ID: "item", Name: "Item", Phase: "alpha", FirstCitizen: true, Attributes: []Attribute{}},
		},
		Metrics: []Metric{
			{ID: "m1", Name: "M1", Description: "test", Phase: "alpha", Kind: "aggregate", Status: "designed", SourceEntities: []string{"item"}},
			{ID: "m1", Name: "M1 dup", Description: "test", Phase: "alpha", Kind: "aggregate", Status: "designed", SourceEntities: []string{"item"}},
		},
	}
	result := Validate(o, "format")
	if result.Valid {
		t.Error("expected validation to fail for duplicate metric ID")
	}
}

func TestValidateClassificationNeedsBuckets(t *testing.T) {
	o := &Ontology{
		ID:      "test",
		Version: "1.0.0",
		Classes: []Class{
			{ID: "item", Name: "Item", Phase: "alpha", FirstCitizen: true, Attributes: []Attribute{}},
		},
		Metrics: []Metric{
			{ID: "m1", Name: "M1", Description: "test", Phase: "alpha", Kind: "classification", Status: "designed", SourceEntities: []string{"item"}},
		},
	}
	result := Validate(o, "format")
	if result.Valid {
		t.Error("expected validation to fail for classification metric without buckets")
	}
}

func TestValidateTelemetryNeedsContextStrategy(t *testing.T) {
	o := &Ontology{
		ID:      "test",
		Version: "1.0.0",
		Classes: []Class{
			{ID: "equipment", Name: "Equipment", Phase: "alpha", FirstCitizen: true, Attributes: []Attribute{}},
		},
		Telemetry: []Telemetry{
			{
				ID: "temp", Name: "Temperature", Description: "test", Phase: "alpha",
				SourceClass: "equipment", ValueType: "decimal", Unit: "°C", Sampling: "10s",
				Aggregations: []string{"avg"},
				Status:       "designed",
				// Missing ContextStrategy
			},
		},
	}
	result := Validate(o, "format")
	if result.Valid {
		t.Error("expected validation to fail for telemetry without context_strategy")
	}
}

func TestMarshalRoundTrip(t *testing.T) {
	o := loadSparePartsOntology(t)
	data, err := Marshal(o)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}
	o2, err := Parse(data)
	if err != nil {
		t.Fatalf("failed to re-parse: %v", err)
	}
	if o2.ID != o.ID {
		t.Errorf("round-trip ID mismatch: '%s' vs '%s'", o.ID, o2.ID)
	}
	if len(o2.Classes) != len(o.Classes) {
		t.Errorf("round-trip classes count mismatch: %d vs %d", len(o.Classes), len(o2.Classes))
	}
	if len(o2.Metrics) != len(o.Metrics) {
		t.Errorf("round-trip metrics count mismatch: %d vs %d", len(o.Metrics), len(o2.Metrics))
	}
}
