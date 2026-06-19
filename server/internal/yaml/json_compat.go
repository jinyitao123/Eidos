package ontoyaml

import "encoding/json"

// JSON 输入兼容层：让本体工具接受 Nexus 命名（entities/source/target/data_type），
// 规范化到 Eidos 字段（classes/from/to/type）。存储与输出仍是 Eidos 命名（MarshalJSON 不变）。
// 这与 parser.go 里 YAML 的 entities↔classes 兼容同源——无头 agent（claude/opencode）
// 产出的 JSON 用哪套命名都能存进去。

// UnmarshalJSON 接受 entities 作为 classes 的别名。
func (o *Ontology) UnmarshalJSON(data []byte) error {
	type alias Ontology
	aux := &struct {
		Entities []Class `json:"entities"`
		*alias
	}{alias: (*alias)(o)}
	if err := json.Unmarshal(data, aux); err != nil {
		return err
	}
	if len(o.Classes) == 0 && len(aux.Entities) > 0 {
		o.Classes = aux.Entities
	}
	return nil
}

// UnmarshalJSON 接受 source/target 作为 from/to 的别名。
func (r *Relationship) UnmarshalJSON(data []byte) error {
	type alias Relationship
	aux := &struct {
		Source string `json:"source"`
		Target string `json:"target"`
		*alias
	}{alias: (*alias)(r)}
	if err := json.Unmarshal(data, aux); err != nil {
		return err
	}
	if r.From == "" && aux.Source != "" {
		r.From = aux.Source
	}
	if r.To == "" && aux.Target != "" {
		r.To = aux.Target
	}
	return nil
}

// UnmarshalJSON 接受 data_type 作为 type 的别名。
func (a *Attribute) UnmarshalJSON(data []byte) error {
	type alias Attribute
	aux := &struct {
		DataType string `json:"data_type"`
		*alias
	}{alias: (*alias)(a)}
	if err := json.Unmarshal(data, aux); err != nil {
		return err
	}
	if a.Type == "" && aux.DataType != "" {
		a.Type = aux.DataType
	}
	return nil
}
