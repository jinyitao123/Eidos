package mcp

import "encoding/json"

// ToolDef matches Weave's contract.ToolDef format.
type ToolDef struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema"`
}

// Schema builds an inputSchema JSON object.
func Schema(properties map[string]any, required []string) json.RawMessage {
	s := map[string]any{
		"type":       "object",
		"properties": properties,
	}
	if len(required) > 0 {
		s["required"] = required
	}
	data, _ := json.Marshal(s)
	return data
}

// Prop creates a property definition.
func Prop(typ, desc string) map[string]any {
	return map[string]any{"type": typ, "description": desc}
}

// PropEnum creates an enum property definition.
func PropEnum(typ, desc string, enum []string) map[string]any {
	return map[string]any{"type": typ, "description": desc, "enum": enum}
}

// PropWithDefault creates a property with a default value.
func PropWithDefault(typ, desc string, def any) map[string]any {
	return map[string]any{"type": typ, "description": desc, "default": def}
}
