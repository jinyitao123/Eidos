package tools

import (
	"github.com/jackc/pgx/v5/pgxpool"

	"ontologyserver/internal/mcp"
	"ontologyserver/internal/neo"
)

// Deps holds shared dependencies for all tools.
type Deps struct {
	PG  *pgxpool.Pool
	Neo *neo.DB
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
}
