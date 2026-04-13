//go:build ignore

package ontoyaml

import (
	"fmt"
	"os"
)

func main() {
	data, _ := os.ReadFile("/tmp/s2_output.yaml")
	o, err := Parse(data)
	if err != nil {
		fmt.Println("Parse error:", err)
		return
	}
	fmt.Printf("ID: %s\nClasses: %d\nMetrics: %d\nTelemetry: %d\n",
		o.ID, len(o.Classes), len(o.Metrics), len(o.Telemetry))
	for _, m := range o.Metrics {
		fl := m.Formula
		if len(fl) > 50 { fl = fl[:50] }
		fmt.Printf("  M %s: kind=%q status=%q src=%v\n", m.ID, m.Kind, m.Status, m.SourceEntities)
	}
	for _, t := range o.Telemetry {
		fmt.Printf("  T %s: src=%q vt=%q samp=%q aggs=%v cs=%v\n",
			t.ID, t.SourceClass, t.ValueType, t.Sampling, t.Aggregations, t.ContextStrategy != nil)
	}
}
