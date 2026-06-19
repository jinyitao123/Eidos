package ontoyaml

import (
	"encoding/json"
	"testing"
)

func TestJSONAcceptsNexusNaming(t *testing.T) {
	// Nexus 命名：entities / source / target / data_type
	in := `{
	  "id": "p1", "name": "测试",
	  "entities": [
	    {"id": "customer", "name": "客户", "kind": "person",
	     "attributes": [{"id": "name", "name": "名称", "data_type": "text"}]}
	  ],
	  "relationships": [
	    {"id": "r1", "name": "下单", "source": "customer", "target": "order", "cardinality": "1:N"}
	  ]
	}`
	var o Ontology
	if err := json.Unmarshal([]byte(in), &o); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(o.Classes) != 1 {
		t.Fatalf("entities→classes failed: got %d classes", len(o.Classes))
	}
	if o.Classes[0].ID != "customer" {
		t.Errorf("class id: got %q", o.Classes[0].ID)
	}
	if len(o.Classes[0].Attributes) != 1 || o.Classes[0].Attributes[0].Type != "text" {
		t.Errorf("data_type→type failed: %+v", o.Classes[0].Attributes)
	}
	if len(o.Relationships) != 1 || o.Relationships[0].From != "customer" || o.Relationships[0].To != "order" {
		t.Errorf("source/target→from/to failed: %+v", o.Relationships)
	}
}

func TestJSONStillAcceptsEidosNaming(t *testing.T) {
	// Eidos 原生命名仍然工作（不被兼容层破坏）。
	in := `{
	  "id": "p2", "name": "原生",
	  "classes": [{"id": "c1", "name": "类一", "attributes": [{"id": "a1", "name": "属性", "type": "string"}]}],
	  "relationships": [{"id": "r1", "name": "rel", "from": "c1", "to": "c2", "cardinality": "1:1"}]
	}`
	var o Ontology
	if err := json.Unmarshal([]byte(in), &o); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(o.Classes) != 1 || o.Classes[0].ID != "c1" {
		t.Errorf("native classes broken: %+v", o.Classes)
	}
	if o.Classes[0].Attributes[0].Type != "string" {
		t.Errorf("native type broken: %+v", o.Classes[0].Attributes)
	}
	if o.Relationships[0].From != "c1" || o.Relationships[0].To != "c2" {
		t.Errorf("native from/to broken: %+v", o.Relationships)
	}
}

func TestJSONRoundTripCanonical(t *testing.T) {
	// 存进去的若是 entities，输出回来应是 classes（规范化）。
	in := `{"id":"p3","name":"n","entities":[{"id":"c1","name":"c","attributes":[]}]}`
	var o Ontology
	if err := json.Unmarshal([]byte(in), &o); err != nil {
		t.Fatal(err)
	}
	out, _ := json.Marshal(o)
	var back map[string]any
	json.Unmarshal(out, &back)
	if _, hasClasses := back["classes"]; !hasClasses {
		t.Errorf("canonical output should have 'classes' key: %s", out)
	}
	if _, hasEntities := back["entities"]; hasEntities {
		t.Errorf("canonical output should NOT have 'entities' key: %s", out)
	}
}
