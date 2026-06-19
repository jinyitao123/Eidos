package assess

import (
	"fmt"

	ontoyaml "ontologyserver/internal/yaml"
)

type Report struct {
	Score    int      `json:"score"`
	Findings []string `json:"findings"`
}

// Health scores an ontology's structural quality (0–100).
func Health(o *ontoyaml.Ontology) Report {
	var f []string
	score := 100

	n := len(o.Classes)
	if n == 0 {
		return Report{Score: 0, Findings: []string{"还没有任何业务对象。"}}
	}
	if n == 1 {
		score -= 10
		f = append(f, "只有一个业务对象——业务通常由多个对象与它们的关系构成，建议补全。")
	}

	touched := map[string]bool{}
	for _, r := range o.Relationships {
		touched[r.From] = true
		touched[r.To] = true
	}

	thin, orphan := 0, 0
	for _, e := range o.Classes {
		if len(e.Attributes) == 0 {
			thin++
			f = append(f, fmt.Sprintf("「%s」还没有任何信息（属性），太单薄。", e.Name))
		}
		if n > 1 && !touched[e.ID] {
			orphan++
			f = append(f, fmt.Sprintf("「%s」没和任何对象建立关系，像是孤立的。", e.Name))
		}
	}
	score -= thin * 8
	score -= orphan * 6

	if len(o.Relationships) == 0 && n > 1 {
		score -= 15
		f = append(f, "多个对象之间没有定义任何关系。")
	}

	pending := 0
	for _, e := range o.Classes {
		if e.Status != "" && e.Status != "confirmed" {
			pending++
		}
	}
	if pending > 0 {
		score -= pending * 3
		f = append(f, fmt.Sprintf("%d 个实体尚未确认（proposed/reviewing），需人工审核。", pending))
	}

	if score < 0 {
		score = 0
	}
	if len(f) == 0 {
		f = append(f, "结构完整，暂无问题。")
	}
	return Report{Score: score, Findings: f}
}
