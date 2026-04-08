package connector

import (
	"fmt"
	"strings"

	"ontologypipeline/internal/types"
)

// MappingEntry describes one attribute's source-system mapping.
type MappingEntry struct {
	ClassID       string `yaml:"class_id" json:"class_id"`
	AttributeID   string `yaml:"attribute_id" json:"attribute_id"`
	AttributeName string `yaml:"attribute_name" json:"attribute_name"`
	AttributeType string `yaml:"attribute_type" json:"attribute_type"`
	SourceHint    string `yaml:"source_hint" json:"source_hint"`
	MappingStatus string `yaml:"mapping_status" json:"mapping_status"` // unmapped | mapped
}

// GenerateResult holds connector mapping output.
type GenerateResult struct {
	Entries []MappingEntry
	YAML    string
}

// Generate produces a connector mapping template from the ontology.
// For each class's non-derived attributes, it creates a mapping record.
// If connector_hints exist for the attribute, they are pre-filled.
func Generate(o *types.Ontology) *GenerateResult {
	result := &GenerateResult{}

	for _, c := range o.Classes {
		for _, a := range c.Attributes {
			// Skip derived attributes — they are computed, not mapped from source
			if a.Derived != "" {
				continue
			}
			// Skip system fields
			if a.ID == "created_at" || a.ID == "updated_at" {
				continue
			}

			entry := MappingEntry{
				ClassID:       c.ID,
				AttributeID:   a.ID,
				AttributeName: a.Name,
				AttributeType: a.Type,
				SourceHint:    "",
				MappingStatus: "unmapped",
			}

			result.Entries = append(result.Entries, entry)
		}
	}

	// Generate YAML output
	var sb strings.Builder
	sb.WriteString("# Connector Mapping Template\n")
	sb.WriteString(fmt.Sprintf("# Generated from ontology: %s v%s\n", o.Name, o.Version))
	sb.WriteString(fmt.Sprintf("# Total mappable attributes: %d\n\n", len(result.Entries)))

	currentClass := ""
	for _, e := range result.Entries {
		if e.ClassID != currentClass {
			if currentClass != "" {
				sb.WriteString("\n")
			}
			sb.WriteString(fmt.Sprintf("# === %s ===\n", e.ClassID))
			currentClass = e.ClassID
		}

		sb.WriteString(fmt.Sprintf("- class_id: %s\n", e.ClassID))
		sb.WriteString(fmt.Sprintf("  attribute_id: %s\n", e.AttributeID))
		sb.WriteString(fmt.Sprintf("  attribute_name: %s\n", e.AttributeName))
		sb.WriteString(fmt.Sprintf("  attribute_type: %s\n", e.AttributeType))
		if e.SourceHint != "" {
			sb.WriteString(fmt.Sprintf("  source_hint: %s\n", e.SourceHint))
		} else {
			sb.WriteString("  source_hint: \"\"  # TODO: fill in source system field\n")
		}
		sb.WriteString(fmt.Sprintf("  mapping_status: %s\n", e.MappingStatus))
	}

	result.YAML = sb.String()
	return result
}
