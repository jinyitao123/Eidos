package ontoyaml

import (
	"fmt"

	"gopkg.in/yaml.v3"
)

// Parse unmarshals a raw YAML byte slice into an Ontology struct.
// It supports both wrapped format (with top-level "ontology:" key) and
// unwrapped format (classes/relationships at top level).
func Parse(data []byte) (*Ontology, error) {
	// Try wrapped format first: { ontology: { id: ..., classes: [...] } }
	var doc OntologyDoc
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("yaml parse: %w", err)
	}
	if doc.Ontology.ID != "" {
		return &doc.Ontology, nil
	}

	// Try unwrapped format: { id: ..., classes: [...] }
	var flat Ontology
	if err := yaml.Unmarshal(data, &flat); err != nil {
		return nil, fmt.Errorf("yaml parse: %w", err)
	}
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
