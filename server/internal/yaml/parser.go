package ontoyaml

import (
	"fmt"

	"gopkg.in/yaml.v3"
)

// entitiesCompat is used to parse YAML documents that use "entities:" instead of "classes:".
type entitiesCompat struct {
	Entities []Class `yaml:"entities"`
}

type entitiesDocCompat struct {
	Ontology entitiesCompat `yaml:"ontology"`
}

// Parse unmarshals a raw YAML byte slice into an Ontology struct.
// It supports both wrapped format (with top-level "ontology:" key) and
// unwrapped format (classes/relationships at top level).
//
// It also supports the "entities:" key as an alias for "classes:" for
// compatibility with Nexus-origin ontology documents.
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

		// Handle "entities:" as alias for "classes:"
		if len(doc.Ontology.Classes) == 0 {
			mergeEntitiesCompat(data, &doc.Ontology)
		}

		return &doc.Ontology, nil
	}

	// Try unwrapped format: { id: ..., classes: [...] }
	var flat Ontology
	yaml.Unmarshal(data, &flat)

	// Handle "entities:" as alias for "classes:" in flat format
	if len(flat.Classes) == 0 {
		var ec entitiesCompat
		yaml.Unmarshal(data, &ec)
		if len(ec.Entities) > 0 {
			flat.Classes = ec.Entities
		}
	}

	if flat.ID == "" {
		return nil, fmt.Errorf("yaml parse: missing ontology.id (tried both wrapped and flat formats)")
	}
	return &flat, nil
}

func mergeEntitiesCompat(data []byte, o *Ontology) {
	// Try wrapped "entities:" inside ontology:
	var dc entitiesDocCompat
	yaml.Unmarshal(data, &dc)
	if len(dc.Ontology.Entities) > 0 {
		o.Classes = dc.Ontology.Entities
		return
	}
	// Try flat "entities:" at top level
	var ec entitiesCompat
	yaml.Unmarshal(data, &ec)
	if len(ec.Entities) > 0 {
		o.Classes = ec.Entities
	}
}

// Marshal serializes an Ontology back to YAML bytes.
func Marshal(o *Ontology) ([]byte, error) {
	doc := OntologyDoc{Ontology: *o}
	return yaml.Marshal(&doc)
}
