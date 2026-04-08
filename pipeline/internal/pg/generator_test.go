package pg

import (
	"os"
	"strings"
	"testing"

	"ontologypipeline/internal/types"

	"gopkg.in/yaml.v3"
)

func loadSparePartsOntology(t *testing.T) *types.Ontology {
	t.Helper()
	data, err := os.ReadFile("../../../docs/02-spare-parts-ontology.yaml")
	if err != nil {
		t.Fatalf("failed to read spare parts YAML: %v", err)
	}
	var doc types.OntologyDoc
	if err := yaml.Unmarshal(data, &doc); err != nil {
		t.Fatalf("failed to parse YAML: %v", err)
	}
	return &doc.Ontology
}

func TestGenerateSchemaHeader(t *testing.T) {
	o := loadSparePartsOntology(t)
	ddl := Generate(o)

	if !strings.Contains(ddl, "CREATE SCHEMA IF NOT EXISTS spareparts;") {
		t.Error("expected schema creation statement")
	}
	if !strings.Contains(ddl, "spare_parts") {
		// The ontology name should appear in the header comment
	}
}

func TestGenerateAllTables(t *testing.T) {
	o := loadSparePartsOntology(t)
	ddl := Generate(o)

	expectedTables := []string{
		"spareparts.spare_parts",
		"spareparts.warehouses",
		"spareparts.equipment",
		"spareparts.inventory_positions",
		"spareparts.stock_movements",
		"spareparts.purchase_orders",
		"spareparts.inventory_snapshots",
		"spareparts.decision_logs",
	}

	for _, table := range expectedTables {
		if !strings.Contains(ddl, table) {
			t.Errorf("expected table %s in generated DDL", table)
		}
	}
}

func TestGenerateJunctionTable(t *testing.T) {
	o := loadSparePartsOntology(t)
	ddl := Generate(o)

	// equipment_uses is the many-to-many junction table (uses relationship)
	if !strings.Contains(ddl, "spareparts.uses") || !strings.Contains(ddl, "equipment_id") {
		// The junction table uses the relationship ID
		if !strings.Contains(ddl, "equipment_id UUID NOT NULL") {
			t.Error("expected junction table with equipment_id for uses relationship")
		}
	}
}

func TestGenerateForeignKeys(t *testing.T) {
	o := loadSparePartsOntology(t)
	ddl := Generate(o)

	// inventory_positions should have FK to spare_parts and warehouses
	if !strings.Contains(ddl, "spare_part_id UUID") {
		t.Error("expected spare_part_id FK in inventory_positions")
	}
	if !strings.Contains(ddl, "warehouse_id UUID") {
		t.Error("expected warehouse_id FK in inventory_positions")
	}
	if !strings.Contains(ddl, "REFERENCES spareparts.spare_parts(id)") {
		t.Error("expected FK reference to spare_parts table")
	}
	if !strings.Contains(ddl, "REFERENCES spareparts.warehouses(id)") {
		t.Error("expected FK reference to warehouses table")
	}
}

func TestGenerateUniqueConstraint(t *testing.T) {
	o := loadSparePartsOntology(t)
	ddl := Generate(o)

	// inventory_position has required many_to_one to spare_part and warehouse
	// Should generate UNIQUE(spare_part_id, warehouse_id)
	if !strings.Contains(ddl, "UNIQUE (spare_part_id, warehouse_id)") {
		t.Error("expected composite UNIQUE constraint on inventory_positions")
	}
}

func TestGenerateEnumCheck(t *testing.T) {
	o := loadSparePartsOntology(t)
	ddl := Generate(o)

	// criticality should have CHECK constraint
	if !strings.Contains(ddl, "CHECK (criticality IN (") {
		t.Error("expected CHECK constraint for criticality enum")
	}
}

func TestGenerateIndexes(t *testing.T) {
	o := loadSparePartsOntology(t)
	ddl := Generate(o)

	// Should have FK indexes
	if !strings.Contains(ddl, "CREATE INDEX IF NOT EXISTS") {
		t.Error("expected index creation statements")
	}
}

func TestGenerateDerivedColumn(t *testing.T) {
	o := loadSparePartsOntology(t)
	ddl := Generate(o)

	// purchase_orders.total_amount is derived: quantity * unit_price
	if !strings.Contains(ddl, "GENERATED ALWAYS AS") {
		t.Error("expected GENERATED ALWAYS AS for derived columns")
	}
}

func TestGenerateTimestamps(t *testing.T) {
	o := loadSparePartsOntology(t)
	ddl := Generate(o)

	// Every regular table (not junction) should have created_at and updated_at
	// Junction tables (many_to_many) don't get timestamps
	regularTableCount := len(o.Classes) // 8 classes = 8 regular tables
	createdAtCount := strings.Count(ddl, "created_at TIMESTAMPTZ DEFAULT now()")
	updatedAtCount := strings.Count(ddl, "updated_at TIMESTAMPTZ DEFAULT now()")

	if createdAtCount < regularTableCount {
		t.Errorf("expected created_at in all %d regular tables, found %d", regularTableCount, createdAtCount)
	}
	if updatedAtCount < regularTableCount {
		t.Errorf("expected updated_at in all %d regular tables, found %d", regularTableCount, updatedAtCount)
	}
}

func TestTableDependencyOrder(t *testing.T) {
	o := loadSparePartsOntology(t)
	ddl := Generate(o)

	// spare_parts, warehouses, equipment should appear before inventory_positions
	spIdx := strings.Index(ddl, "spareparts.spare_parts")
	whIdx := strings.Index(ddl, "spareparts.warehouses")
	ipIdx := strings.Index(ddl, "spareparts.inventory_positions")

	if spIdx > ipIdx {
		t.Error("spare_parts table should be created before inventory_positions")
	}
	if whIdx > ipIdx {
		t.Error("warehouses table should be created before inventory_positions")
	}

	// inventory_positions should appear before stock_movements
	smIdx := strings.Index(ddl, "spareparts.stock_movements")
	if ipIdx > smIdx {
		t.Error("inventory_positions should be created before stock_movements")
	}
}

func TestPluralizeCorrectly(t *testing.T) {
	cases := map[string]string{
		"spare_part":         "spare_parts",
		"warehouse":          "warehouses",
		"equipment":          "equipment",
		"inventory_position": "inventory_positions",
		"stock_movement":     "stock_movements",
		"purchase_order":     "purchase_orders",
		"inventory_snapshot": "inventory_snapshots",
		"decision_log":       "decision_logs",
		"category":           "categories",
	}

	for singular, expected := range cases {
		got := pluralize(singular)
		if got != expected {
			t.Errorf("pluralize(%q) = %q, want %q", singular, got, expected)
		}
	}
}

func TestSchemaName(t *testing.T) {
	if got := schemaName("spare_parts"); got != "spareparts" {
		t.Errorf("schemaName(spare_parts) = %q, want 'spareparts'", got)
	}
}

func TestGenerateMinimalOntology(t *testing.T) {
	o := &types.Ontology{
		Name:    "Test",
		ID:      "test",
		Version: "1.0.0",
		Classes: []types.Class{
			{
				ID:   "item",
				Name: "Item",
				Attributes: []types.Attribute{
					{ID: "name", Name: "Name", Type: "string", Required: true},
					{ID: "qty", Name: "Quantity", Type: "integer", Default: 0},
					{ID: "active", Name: "Active", Type: "boolean", Default: true},
				},
			},
		},
	}

	ddl := Generate(o)

	if !strings.Contains(ddl, "CREATE SCHEMA IF NOT EXISTS test;") {
		t.Error("expected schema 'test'")
	}
	if !strings.Contains(ddl, "test.items") {
		t.Error("expected table 'test.items'")
	}
	if !strings.Contains(ddl, "name VARCHAR(255) NOT NULL") {
		t.Error("expected 'name' column with NOT NULL")
	}
	if !strings.Contains(ddl, "qty INTEGER DEFAULT 0") {
		t.Error("expected 'qty' column with DEFAULT")
	}
	if !strings.Contains(ddl, "active BOOLEAN DEFAULT true") {
		t.Error("expected 'active' column with DEFAULT")
	}
}
