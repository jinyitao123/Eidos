package ontoyaml

import (
	"fmt"

	"gopkg.in/yaml.v3"
)

// Parse unmarshals a raw YAML byte slice into an Ontology struct.
// It supports both wrapped format (with top-level "ontology:" key) and
// unwrapped format (classes/relationships at top level).
//
// S2 (DeepSeek) commonly produces a hybrid format where ontology.id/name/version
// are inside an "ontology:" wrapper but classes/metrics/telemetry are at the top
// level. Parse handles this by merging top-level data into the wrapper.
func Parse(data []byte) (*Ontology, error) {
	// Try wrapped format first: { ontology: { id: ..., classes: [...] } }
	var doc OntologyDoc
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("yaml parse: %w", err)
	}
	if doc.Ontology.ID != "" {
		// Also parse top-level to pick up classes/metrics/telemetry that
		// S2 may have placed outside the ontology: wrapper.
		var flat Ontology
		// Ignore errors: S2 may produce fields with wrong types (e.g., string
		// instead of []string for source_entities). yaml.v3 still populates
		// the fields it can parse, so we merge whatever succeeded.
		yaml.Unmarshal(data, &flat)
		{
			if len(doc.Ontology.Classes) == 0 && len(flat.Classes) > 0 {
				doc.Ontology.Classes = flat.Classes
			}
			if len(doc.Ontology.Relationships) == 0 && len(flat.Relationships) > 0 {
				doc.Ontology.Relationships = flat.Relationships
			}
			if len(doc.Ontology.Metrics) == 0 && len(flat.Metrics) > 0 {
				doc.Ontology.Metrics = flat.Metrics
			}
			if len(doc.Ontology.Telemetry) == 0 && len(flat.Telemetry) > 0 {
				doc.Ontology.Telemetry = flat.Telemetry
			}
			if len(doc.Ontology.Rules) == 0 && len(flat.Rules) > 0 {
				doc.Ontology.Rules = flat.Rules
			}
			if len(doc.Ontology.Actions) == 0 && len(flat.Actions) > 0 {
				doc.Ontology.Actions = flat.Actions
			}
			if len(doc.Ontology.Functions) == 0 && len(flat.Functions) > 0 {
				doc.Ontology.Functions = flat.Functions
			}
		}
		return &doc.Ontology, nil
	}

	// Try unwrapped format: { id: ..., classes: [...] }
	// Ignore unmarshal errors for individual fields (e.g., source_entities
	// as string instead of []string) — same tolerance as the wrapped path.
	var flat Ontology
	yaml.Unmarshal(data, &flat)
	if flat.ID == "" {
		return nil, fmt.Errorf("yaml parse: missing ontology.id (tried both wrapped and flat formats)")
	}
	return &flat, nil
}

// Marshal serializes an Ontology back to YAML bytes.
func Marshal(o *Ontology) ([]byte, error) {
	doc := OntologyDoc{Ontology: *o}
	return yaml.Marshal(&doc)
}
