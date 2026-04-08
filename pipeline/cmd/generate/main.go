package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	agentgen "ontologypipeline/internal/agent"
	conngen "ontologypipeline/internal/connector"
	mcpgen "ontologypipeline/internal/mcp"
	neo4jgen "ontologypipeline/internal/neo4j"
	pggen "ontologypipeline/internal/pg"
	rulesgen "ontologypipeline/internal/rules"
	tsgen "ontologypipeline/internal/tsgen"
	"ontologypipeline/internal/types"

	"gopkg.in/yaml.v3"
)

func main() {
	fromFile := flag.String("from", "", "Path to ontology YAML file")
	outputDir := flag.String("output", "./out", "Output directory")
	previousFile := flag.String("previous", "", "Path to previous version YAML (for incremental generation)")
	flag.Parse()

	if *fromFile == "" {
		log.Fatal("--from is required")
	}

	// Read and parse ontology YAML
	data, err := os.ReadFile(*fromFile)
	if err != nil {
		log.Fatalf("read file: %v", err)
	}

	// Parse ontology YAML — supports three formats:
	// 1. Wrapped: ontology: {id, name, classes, ...}
	// 2. Flat: {id, name, classes, ...}
	// 3. Hybrid (agent-generated): ontology: {name, version} + top-level classes, relationships, etc.
	var o *types.Ontology
	var doc types.OntologyDoc
	if err := yaml.Unmarshal(data, &doc); err != nil {
		log.Fatalf("parse yaml: %v", err)
	}
	if doc.Ontology.ID != "" || doc.Ontology.Name != "" {
		o = &doc.Ontology
		// Hybrid format: metadata in ontology: wrapper, data at top level
		// Parse top-level fields and fill in any that are empty
		var top types.Ontology
		if err := yaml.Unmarshal(data, &top); err == nil {
			if len(o.Classes) == 0 && len(top.Classes) > 0 {
				o.Classes = top.Classes
			}
			if len(o.Relationships) == 0 && len(top.Relationships) > 0 {
				o.Relationships = top.Relationships
			}
			if len(o.Rules) == 0 && len(top.Rules) > 0 {
				o.Rules = top.Rules
			}
			if len(o.Actions) == 0 && len(top.Actions) > 0 {
				o.Actions = top.Actions
			}
			if len(o.Functions) == 0 && len(top.Functions) > 0 {
				o.Functions = top.Functions
			}
		}
	} else {
		var flat types.Ontology
		if err := yaml.Unmarshal(data, &flat); err != nil {
			log.Fatalf("parse yaml (flat): %v", err)
		}
		o = &flat
	}

	// Derive id from name if missing (agent-generated YAML may omit it)
	if o.ID == "" && o.Name != "" {
		o.ID = deriveID(o.Name)
		log.Printf("Warning: ontology.id was missing, derived as %q from name", o.ID)
	}

	if o.ID == "" {
		log.Fatal("ontology.id is missing (tried both wrapped and flat formats)")
	}

	log.Printf("Generating from ontology: %s (id=%s, version=%s)", o.Name, o.ID, o.Version)
	log.Printf("Classes: %d, Relationships: %d, Rules: %d, Actions: %d",
		len(o.Classes), len(o.Relationships), len(o.Rules), len(o.Actions))

	if *previousFile != "" {
		log.Printf("Incremental mode: comparing with %s", *previousFile)
		// TODO: implement diff engine for incremental generation
	}

	// Ensure output directory
	if err := os.MkdirAll(*outputDir, 0755); err != nil {
		log.Fatalf("create output dir: %v", err)
	}

	// Step 1: PG Schema Generator
	log.Println("Step 1: Generating PG Schema...")
	pgDDL := pggen.Generate(o)
	writeFile(filepath.Join(*outputDir, "01_pg_schema.sql"), pgDDL)

	// Step 2: MCP Tool Generator
	log.Println("Step 2: Generating MCP Tools...")
	mcpResult := mcpgen.Generate(o)
	toolsJSON, _ := json.MarshalIndent(mcpResult.Tools, "", "  ")
	writeFile(filepath.Join(*outputDir, "02_tools.json"), string(toolsJSON))
	goDir := filepath.Join(*outputDir, "tools")
	os.MkdirAll(goDir, 0755)
	for name, code := range mcpResult.GoFiles {
		writeFile(filepath.Join(goDir, name), code)
	}
	log.Printf("  -> %d tools, %d Go files", len(mcpResult.Tools), len(mcpResult.GoFiles))

	// Step 3: Neo4j Schema Generator
	log.Println("Step 3: Generating Neo4j Schema...")
	neo4jResult := neo4jgen.Generate(o)
	neo4jDir := filepath.Join(*outputDir, "neo4j")
	os.MkdirAll(neo4jDir, 0755)
	writeFile(filepath.Join(neo4jDir, "03_schema.cypher"), neo4jResult.SchemaCypher)
	writeFile(filepath.Join(neo4jDir, "03_sync_config.yaml"), neo4jResult.SyncConfig)

	// Step 4: Agent Config Generator
	log.Println("Step 4: Generating Agent Config...")
	agentResult := agentgen.Generate(o)
	agentDir := filepath.Join(*outputDir, "agents")
	os.MkdirAll(agentDir, 0755)
	writeFile(filepath.Join(agentDir, "04_agent_tools.yaml"), agentResult.YAML)
	log.Printf("  -> %d agent bindings", len(agentResult.Bindings))

	// Step 5: Rule Engine Generator
	log.Println("Step 5: Generating Rule Engine...")
	rulesResult := rulesgen.Generate(o)
	rulesDir := filepath.Join(*outputDir, "rules")
	os.MkdirAll(rulesDir, 0755)
	writeFile(filepath.Join(rulesDir, "05_rules_config.yaml"), rulesResult.ConfigYAML)
	writeFile(filepath.Join(rulesDir, "05_engine.go"), rulesResult.GoCode)

	// Step 6: Frontend Type Generator
	log.Println("Step 6: Generating TypeScript Types...")
	tsCode := tsgen.Generate(o)
	writeFile(filepath.Join(*outputDir, "06_types.ts"), tsCode)

	// Step 7: Connector Mapping Template Generator
	log.Println("Step 7: Generating Connector Mapping Template...")
	connResult := conngen.Generate(o)
	connDir := filepath.Join(*outputDir, "connector")
	os.MkdirAll(connDir, 0755)
	writeFile(filepath.Join(connDir, "07_mapping_template.yaml"), connResult.YAML)
	log.Printf("  -> %d mappable attributes", len(connResult.Entries))

	// Summary
	fmt.Println("\n=== Generation Complete ===")
	fmt.Printf("Ontology: %s v%s\n", o.Name, o.Version)
	fmt.Printf("Step 1: PG Schema    → 01_pg_schema.sql\n")
	fmt.Printf("Step 2: MCP Tools    → 02_tools.json + tools/\n")
	fmt.Printf("Step 3: Neo4j Schema → neo4j/\n")
	fmt.Printf("Step 4: Agent Config → agents/\n")
	fmt.Printf("Step 5: Rule Engine  → rules/\n")
	fmt.Printf("Step 6: TS Types     → 06_types.ts\n")
	fmt.Printf("Step 7: Connector    → connector/\n")
}

func writeFile(path, content string) {
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		log.Fatalf("write %s: %v", path, err)
	}
	log.Printf("  -> %s", path)
}

var nonAlpha = regexp.MustCompile(`[^a-z0-9]+`)

// deriveID converts a human-readable name to a snake_case ID.
func deriveID(name string) string {
	s := strings.ToLower(name)
	s = nonAlpha.ReplaceAllString(s, "_")
	s = strings.Trim(s, "_")
	if s == "" {
		return "unnamed"
	}
	return s
}
