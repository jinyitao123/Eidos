# CLAUDE.md

This file provides guidance to Claude Code when working with the Ontology Toolkit, built on top of the inocube Weave Agent platform.

## Project

Ontology Toolkit — an AI-native ontology editor where Agent networks build ontologies from business research documents, humans review via visual interface, and pipelines auto-generate downstream code (PG schema, MCP tools, Neo4j schema, Agent configs, frontend types).

Built on top of the inocube Weave Agent platform — reuses Weave's agent runtime and auth via API, but is an independently deployed web application (same architecture as the spare parts app). Does NOT embed inside Weave Console.

## Repository Layout

```
ontology-toolkit/
├── docs/                          # Design specs (this is the source of truth)
│   ├── README.md                  # Project overview, architecture, dev sequence
│   ├── 01-ontology-yaml-spec.md   # YAML format spec (classes, relationships, rules, actions, functions, interfaces, security)
│   ├── 02-spare-parts-ontology.yaml  # Complete reference ontology (spare parts management)
│   ├── 03-agent-definitions.md    # Four builder agents: S1 scene-analyst, S2 ontology-architect, S3 rule-designer, S4 ontology-reviewer
│   ├── 04-page-designs.md         # Seven pages: project list, agent dialog, graph review, class editor, rule editor, review report, publish pipeline
│   ├── 05-pipeline-spec.md        # Seven-step code generator spec
│   ├── 06-mcp-tools-spec.md       # Ontology tools MCP server (10 tools)
│   └── 07-palantir-alignment.md   # Palantir methodology alignment and required fixes
├── server/                        # MCP tool server (Go)
│   ├── cmd/ontologyserver/        # Entry point
│   ├── internal/
│   │   ├── config/                # Env-based config
│   │   ├── mcp/                   # JSON-RPC 2.0 router
│   │   ├── pg/                    # PostgreSQL: project metadata, stage outputs, versions, documents
│   │   ├── tools/                 # 10 MCP tool implementations
│   │   └── yaml/                  # YAML parser and validator
│   └── docs/
├── pipeline/                      # Code generators (Go)
│   ├── cmd/generate/              # CLI entry: `generate --from ontology.yaml --output ./out`
│   ├── internal/
│   │   ├── diff/                  # YAML diff engine (old version vs new version)
│   │   ├── pg/                    # Step 1: PG Schema Generator
│   │   ├── mcp/                   # Step 2: MCP Tool Generator
│   │   ├── neo4j/                 # Step 3: Neo4j Schema Generator
│   │   ├── agent/                 # Step 4: Agent Config Generator
│   │   ├── rules/                 # Step 5: Rule Engine Config Generator
│   │   ├── types/                 # Step 6: Frontend Type Generator
│   │   └── connector/             # Step 7: Connector Mapping Template Generator
│   └── templates/                 # Go text/template files for code generation
├── app/                           # Frontend (React 19 + TypeScript), standalone SPA (same pattern as spare parts app)
│   ├── src/
│   │   ├── layout/                # AppShell, TopBar, SideNav (own layout, not Weave Console)
│   │   ├── pages/
│   │   │   ├── ProjectList/       # Page 1: ontology project list
│   │   │   ├── AgentBuild/        # Page 2: agent construction dialog
│   │   │   ├── GraphReview/       # Page 3: interactive graph overview (schema + instance views)
│   │   │   ├── ClassEditor/       # Page 4: class attribute editor
│   │   │   ├── RuleEditor/        # Page 5: rule and action editor
│   │   │   ├── ReviewReport/      # Page 6: audit report
│   │   │   └── PublishPipeline/   # Page 7: publish and deploy
│   │   ├── components/
│   │   │   ├── graph/             # Force-directed graph renderer (d3-force)
│   │   │   ├── yaml-preview/      # YAML code preview with syntax highlighting
│   │   │   └── agent-chat/        # Agent dialog component
│   │   ├── context/               # React Context (Agent state, Project state)
│   │   ├── types/
│   │   │   └── ontology.ts        # TypeScript types for ontology YAML structure
│   │   └── api/
│   │       ├── client.ts          # Weave API client (/api/* → :8080)
│   │       └── mcp.ts             # Ontology MCP client (/mcp/* → :9091)
│   ├── package.json
│   ├── vite.config.ts             # Dev proxies: /api → :8080, /mcp → :9091
│   ├── Dockerfile                 # Multi-stage: build + nginx
│   └── nginx.conf                 # SPA fallback + /api/ proxy + /mcp/ proxy
├── design/                        # Visual design mockups (HTML/SVG)
│   ├── ontology_project_list.html     # Page 1: project list
│   ├── ontology_graph_review.svg      # Page 3: graph review
│   ├── ontology_rule_editor.html      # Page 5: rule & action editor
│   ├── ontology_review_report.html    # Page 6: review report
│   └── ontology_publish_pipeline.html # Page 7: publish pipeline
└── CLAUDE.md                      # This file
```

## Design Source of Truth

All design decisions are documented in `docs/`. When in doubt, `docs/` wins over code comments or inline TODOs.

- YAML format: `docs/01-ontology-yaml-spec.md`
- Reference ontology: `docs/02-spare-parts-ontology.yaml`
- Agent definitions: `docs/03-agent-definitions.md`
- Page designs: `docs/04-page-designs.md`
- Pipeline spec: `docs/05-pipeline-spec.md`
- MCP tools: `docs/06-mcp-tools-spec.md`
- Palantir alignment: `docs/07-palantir-alignment.md`

## Architecture

```
Browser
  → Ontology Toolkit UI (:5180 dev / :8089 Docker, standalone SPA)
      ├─ /api/* → Weave API (:8080) for Agent dialog, sessions, auth
      ├─ /mcp/* → Ontology MCP Server (:9091) for tool calls
      └─ static assets → nginx direct

Weave API (:8080)
  → Dispatches Agent tool calls to MCP servers
  → S1-S4 registered with MCPServers: [{URL: "http://ontology-mcp:9091"}]

Ontology MCP Server (:9091)
  → 16 tools (10 ontology + 6 graph query)
  → PostgreSQL (ontology schema) + Neo4j (graph queries)

Pipeline CLI (Go binary)
  → Reads ontology.yaml
  → Generates: PG DDL, MCP tools, Neo4j schema, Agent configs, TS types, connector templates
  → Outputs to specified directory
```

### Key ports

| Service | Port |
|---------|------|
| Ontology Toolkit UI | :5180 (dev) / :8089 (Docker) |
| Weave Console | :3000 |
| Weave API | :8080 |
| Ontology MCP Server | :9091 |
| Spare Parts MCP Server | :9090 |
| Spare Parts UI | :5173 (dev) / :8088 (Docker) |
| PostgreSQL | :5432 |
| Neo4j | :7474 / :7687 |

### Key separation

The Ontology Toolkit UI (:5180) is **separate** from Weave Console (:3000) and Spare Parts UI (:8088). Each is an independently deployed SPA with its own layout and navigation. They share the same Weave API backend for agent orchestration.

The Ontology MCP Server (:9091) is **separate** from the Spare Parts MCP Server (:9090). They share the same PostgreSQL instance but use different schemas:
- `ontology.*` — project metadata, stage outputs, versions
- `spareparts.*` — business data (generated by pipeline)

## Build & Run

### MCP Server (`server/`)
```bash
cd server
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o bin/ontologyserver ./cmd/ontologyserver
PG_URL="postgres://weave:weave@localhost:5432/weave?sslmode=disable" PORT=9091 go run ./cmd/ontologyserver
```

### Pipeline (`pipeline/`)
```bash
cd pipeline
go build -o bin/generate ./cmd/generate

# Full generation
./bin/generate --from docs/02-spare-parts-ontology.yaml --output ./out

# Incremental generation (diff)
./bin/generate --from docs/02-spare-parts-ontology.yaml --previous ./versions/v1.0.0.yaml --output ./out
```

### Frontend (`app/`)
```bash
cd app && npm install
npm run dev    # Dev server at :5180, proxies /api→:8080, /mcp→:9091
npm run build
npm run lint
```

## Core Concepts

### Ontology YAML is the single source of truth

Everything downstream is generated from it. Never hand-edit generated code — edit the YAML and re-run the pipeline.

### Three-stage workflow: Agent Build → Human Review → Pipeline Generate

1. **Agent Build**: Four agents (S1→S2→S3→S4) run sequentially in Weave. Each agent's output is saved via `save_output` tool. User must confirm before next agent starts.
2. **Human Review**: Visual interface for reviewing and editing the generated YAML. Graph view, class editor, rule editor, audit report.
3. **Pipeline Generate**: Deterministic template-based code generation. No LLM. Seven steps producing seven outputs.

### Deterministic pipeline, no LLM

The pipeline generators use Go `text/template`. They are deterministic — same input always produces same output. This is deliberate: infrastructure code (DDL, CRUD, schema) must be 100% reliable. LLM hallucination is unacceptable here.

### Four builder agents are internal tools, not user-facing

S1-S4 are registered in Weave as `type: internal_tool` with `visibility: ontology_editor_only`. They are never exposed to end users of business applications (spare parts, equipment maintenance, etc.).

## Key Conventions

### YAML format
- All `id` fields: snake_case, no uppercase, no Chinese, no spaces
- Class IDs are singular (`inventory_position`, not `inventory_positions`). PG table names are pluralized by the generator.
- Exactly one class has `first_citizen: true` per ontology
- `phase`: alpha (Day-1 required), beta (3-6 months), full (12+ months)
- `graph_sync: true` means the attribute is synced to Neo4j. Decision criteria: does the Agent need this attribute during graph traversal for filtering? If yes → sync. If display-only → don't sync.
- `configurable: true` means the parameter appears in the business app's admin settings page (not in Weave).

### Derived attribute formulas
- Same-class reference: `safety_stock - available_qty`
- Cross-relationship reference: `[tracks].unit_price` (relationship ID in brackets)
- Aggregation: `SUM([located_in].inventory_value)`
- Time calculation: `DATEDIFF(days, last_consumed_date, NOW())`

### MCP protocol
JSON-RPC 2.0 over HTTP POST to `:9091/`. Two methods: `tools/list` and `tools/call`. Same protocol as the spare parts MCP server.

### PG conventions
- Ontology metadata: `ontology` schema (projects, stage_outputs, versions, documents)
- Generated business tables: `spareparts` schema (or whatever the ontology ID is)
- All date fields cast to `::text` when scanning into Go strings (pgx binary format issue)
- UUID primary keys everywhere

### Agent conventions
- Agent IDs: lowercase with hyphens (`scene-analyst`, `ontology-architect`)
- Agent outputs are YAML strings saved via `save_output` tool
- Each agent reads previous agents' output via dedicated `read_*` tools, never from conversation history
- Agents must call `validate_yaml` before saving output

### Frontend conventions
- Standalone SPA with own TopBar + SideNav layout (same pattern as spare parts app)
- Communicates with Weave API via `/api/*` proxy, Ontology MCP via `/mcp/*` proxy
- Max content width: 960px (wider than the 720px used in spare parts app, because ontology editing needs more information density)
- Graph rendering: d3-force for interactive node-edge layout
- All destructive operations (delete class, delete attribute, rollback version) require confirmation dialog

## Development Phases

### Phase 1: YAML standard + pipeline core

Focus: Make the ontology YAML format real and prove the pipeline works end-to-end.

Tasks:
- Implement YAML parser and validator (`server/internal/yaml/`)
- Implement PG Schema Generator (`pipeline/internal/pg/`)
- Implement MCP Tool Generator (`pipeline/internal/mcp/`)
- Seed the spare parts ontology YAML (`docs/02-spare-parts-ontology.yaml`)
- Verify: generate PG schema + MCP tools from YAML → run them → spare parts app works

**Validation criterion**: The spare parts MCP server currently has hand-written PG schema and tool implementations. After Phase 1, the pipeline-generated versions must produce identical behavior. Run the existing spare parts test suite against the generated code.

### Phase 2: Agent network + visual review

Focus: Build the four agents and the seven frontend pages.

Tasks:
- Implement ontology MCP server with 10 tools (`server/internal/tools/`)
- Register S1-S4 in Weave as internal_tool agents
- Write agent system prompts (based on `docs/03-agent-definitions.md`)
- Build seven frontend pages (based on `docs/04-page-designs.md`)
- Implement remaining pipeline generators (Neo4j, Agent Config, Frontend Types, Rule Engine, Connector Template)

**Validation criterion**: Upload the spare parts research document → S1-S4 produce a YAML that matches `docs/02-spare-parts-ontology.yaml` in structure (class names, relationship names, rule IDs). Human reviews in the visual interface. Publish → pipeline generates all seven outputs.

### Phase 3: Second scenario validation

Focus: Prove the system works for a different business domain.

Tasks:
- Upload equipment maintenance research document
- Run S1-S4 → produces equipment maintenance ontology
- Verify shared class detection (Equipment class exists in spare parts ontology)
- Verify cross-ontology import works
- Pipeline generates a separate set of PG tables, MCP tools, etc. for equipment maintenance

## Critical Constraints

- **Never bypass the YAML**: All changes to the ontology must go through the YAML. No direct PG schema edits, no hand-written MCP tools that aren't in the YAML.
- **Agent outputs must be valid YAML**: If an agent produces malformed YAML, the `validate_yaml` tool should catch it before `save_output`. Never save invalid YAML to stage_outputs.
- **Pipeline is deterministic**: No randomness, no LLM calls, no network calls in the pipeline. Same YAML → same output, every time.
- **User confirmation gates**: Every agent stage requires explicit user confirmation before the next agent starts. Never auto-advance.
- **Blocking vs non-blocking checks**: Consistency issues (C-class in S4's audit) block publishing. Completeness (P-class) and optimization (O-class) suggestions do not block.
- **Incremental generation**: When publishing a new version, the pipeline must generate ALTER TABLE (not DROP+CREATE). Destructive changes (drop column, change type) require human confirmation in the publish pipeline UI.

## Palantir Alignment Reminders

Three things that must be implemented in alpha (see `docs/07-palantir-alignment.md`):

1. **M01**: `query_ontology_metadata` tool — lets business agents dynamically discover what the ontology offers
2. **M02**: Decision log auto-recording — all `decision_log: true` actions automatically write to decision_log table
3. **M03**: Cross-ontology consistency check — when shared classes exist, S4 must verify attribute compatibility across ontologies

Three things deferred to beta:
- M04: Interfaces (abstract parent classes)
- M05: Dynamic Security (object-level + attribute-level RLS)
- M06: Full Functions implementation (sql/go/agent_delegated)
