package tools

import (
	"github.com/jackc/pgx/v5/pgxpool"

	"ontologyserver/internal/mcp"
	"ontologyserver/internal/neo"
	"ontologyserver/internal/proposals"
	"ontologyserver/internal/store"
)

// Deps holds shared dependencies for all tools.
type Deps struct {
	PG        *pgxpool.Pool
	Neo       *neo.DB
	Store     store.Store
	Proposals proposals.Store // nil if not configured
}

// RegisterAll registers all 20 ontology tools on the router.
func RegisterAll(router *mcp.Router, d *Deps) {
	// UI tools: project management
	registerListProjects(router, d)
	registerGetProject(router, d)
	registerCreateProject(router, d)
	registerDeleteProject(router, d)

	// T01-T10: ontology metadata tools
	registerUploadDocument(router, d)
	registerListDocuments(router, d)
	registerReadDocument(router, d)
	registerQueryPublishedOntologies(router, d)
	registerImportClass(router, d)
	registerValidateYAML(router, d)
	registerReadSceneAnalysis(router, d)
	registerReadOntologyStructure(router, d)
	registerReadFullOntologyYAML(router, d)
	registerReadReviewReport(router, d)
	registerReadRulesActions(router, d)
	registerQueryAgentConfigs(router, d)
	registerValidateRuleReferences(router, d)
	registerSaveOutput(router, d)
	registerUpdateOntologyYAML(router, d)
	registerRunPipeline(router, d)

	// Strategy profile tools (platform integration)
	registerListOntologyTemplates(router, d)
	registerGetStrategyProfile(router, d)
	registerUpdateStrategyProfile(router, d)

	// T11-T16: graph query tools (require Neo4j)
	if d.Neo != nil {
		registerGraphQueryNodes(router, d)
		registerGraphQueryNeighbors(router, d)
		registerGraphTraverse(router, d)
		registerGraphShortestPath(router, d)
		registerGraphAggregate(router, d)
		registerGraphStats(router, d)
	}

	// Nexus-origin tools (require versioned Store)
	if d.Store != nil {
		registerNexusTools(router, d)
	}

	// "ontology" profile:精简工具面给无头执行器(claude/opencode)用——只暴露建模必需的工具,
	// 数量小到不触发 claude 的 deferral,松散自然语言也能稳定直调(执行器经 ?profile=ontology 连接)。
	router.RegisterProfile("ontology", []string{
		"read_ontology_doc", "save_ontology_doc",
		"upsert_entity", "upsert_attribute", "upsert_relationship",
		"validate_ontology_doc", "review_entities", "assess_health",
		"get_inheritance", "realign_inheritance",
		"list_glossary", "resolve_terms", "upsert_concept",
	})
}
