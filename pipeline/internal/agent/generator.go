package agent

import (
	"fmt"
	"strings"

	"ontologypipeline/internal/types"
)

// AgentToolBinding describes which MCP tools an agent should have access to.
type AgentToolBinding struct {
	AgentID    string   `yaml:"agent_id" json:"agent_id"`
	ReadTools  []string `yaml:"read_tools" json:"read_tools"`
	WriteTools []string `yaml:"write_tools" json:"write_tools"`
	RuleTools  []string `yaml:"rule_tools,omitempty" json:"rule_tools,omitempty"`
	GraphTools []string `yaml:"graph_tools,omitempty" json:"graph_tools,omitempty"`
	FuncTools  []string `yaml:"func_tools,omitempty" json:"func_tools,omitempty"`
}

// GenerateResult holds agent config output.
type GenerateResult struct {
	Bindings []AgentToolBinding
	YAML     string // Combined YAML output
}

// Generate produces agent-tool bindings from the ontology.
// For each action that declares permission.agents, it binds:
//   - The execute_{action_id} tool as a write tool
//   - query_{class} tools for referenced classes as read tools
//   - check_{rule_id} tools for triggered rules
//
// All agents automatically get query_ontology_metadata.
func Generate(o *types.Ontology) *GenerateResult {
	// Build helper maps
	classIDs := make(map[string]bool)
	for _, c := range o.Classes {
		classIDs[c.ID] = true
	}

	ruleIDs := make(map[string]bool)
	for _, r := range o.Rules {
		ruleIDs[r.ID] = true
	}

	// Collect tool bindings per agent
	agentMap := make(map[string]*AgentToolBinding)
	ensureAgent := func(id string) *AgentToolBinding {
		if b, ok := agentMap[id]; ok {
			return b
		}
		b := &AgentToolBinding{
			AgentID:    id,
			ReadTools:  []string{"query_ontology_metadata"},
			WriteTools: []string{},
		}
		agentMap[id] = b
		return b
	}

	// Process actions → agent bindings
	for _, action := range o.Actions {
		for _, agentID := range action.Permission.Agents {
			b := ensureAgent(agentID)

			// Add execute tool for this action
			writeTool := fmt.Sprintf("execute_%s", action.ID)
			b.WriteTools = appendUnique(b.WriteTools, writeTool)

			// Add query tools for classes referenced in writes
			for _, w := range action.Writes {
				classID := w.Target
				if idx := strings.Index(w.Target, "."); idx > 0 {
					classID = w.Target[:idx]
				}
				if classIDs[classID] {
					readTool := fmt.Sprintf("query_%s", classID)
					b.ReadTools = appendUnique(b.ReadTools, readTool)
				}
			}

			// Add rule check tools for triggered rules
			for _, ruleID := range action.TriggersBefore {
				if ruleIDs[ruleID] {
					b.RuleTools = appendUnique(b.RuleTools, fmt.Sprintf("check_%s", ruleID))
				}
			}
			for _, ruleID := range action.TriggersAfter {
				if ruleIDs[ruleID] {
					b.RuleTools = appendUnique(b.RuleTools, fmt.Sprintf("check_%s", ruleID))
				}
			}
		}
	}

	// Process functions → agent bindings (all agents get calc tools)
	for _, fn := range o.Functions {
		calcTool := fmt.Sprintf("calc_%s", fn.ID)
		for _, b := range agentMap {
			b.FuncTools = appendUnique(b.FuncTools, calcTool)
		}
	}

	// Add graph traversal tools for all agents
	for _, b := range agentMap {
		b.GraphTools = []string{"graph_query_nodes", "graph_query_neighbors", "graph_stats"}
	}

	// Build result
	result := &GenerateResult{}
	for _, b := range agentMap {
		result.Bindings = append(result.Bindings, *b)
	}

	// Generate YAML output
	var sb strings.Builder
	sb.WriteString("# Agent Tool Bindings\n")
	sb.WriteString(fmt.Sprintf("# Generated from ontology: %s v%s\n\n", o.Name, o.Version))

	for _, b := range result.Bindings {
		sb.WriteString(fmt.Sprintf("- agent_id: %s\n", b.AgentID))
		sb.WriteString("  mcp_tools:\n")

		sb.WriteString("    read:\n")
		for _, t := range b.ReadTools {
			sb.WriteString(fmt.Sprintf("      - %s\n", t))
		}

		sb.WriteString("    write:\n")
		for _, t := range b.WriteTools {
			sb.WriteString(fmt.Sprintf("      - %s\n", t))
		}

		if len(b.RuleTools) > 0 {
			sb.WriteString("    rules:\n")
			for _, t := range b.RuleTools {
				sb.WriteString(fmt.Sprintf("      - %s\n", t))
			}
		}

		if len(b.GraphTools) > 0 {
			sb.WriteString("    graph:\n")
			for _, t := range b.GraphTools {
				sb.WriteString(fmt.Sprintf("      - %s\n", t))
			}
		}

		if len(b.FuncTools) > 0 {
			sb.WriteString("    functions:\n")
			for _, t := range b.FuncTools {
				sb.WriteString(fmt.Sprintf("      - %s\n", t))
			}
		}

		sb.WriteString("\n")
	}

	result.YAML = sb.String()
	return result
}

func appendUnique(slice []string, s string) []string {
	for _, existing := range slice {
		if existing == s {
			return slice
		}
	}
	return append(slice, s)
}
