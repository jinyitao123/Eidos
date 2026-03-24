<p align="center">
  <strong>εἶδος</strong>
</p>

<h1 align="center">Eidos</h1>

<p align="center">
  AI-native ontology editor — Agents build, humans review, pipelines generate.
</p>

<p align="center">
  <a href="./README.zh-CN.md">中文</a> | English
</p>

<p align="center">
  <a href="#what-is-eidos">What</a> · <a href="#how-it-works">How</a> · <a href="#architecture">Architecture</a> · <a href="#getting-started">Get Started</a> · <a href="#roadmap">Roadmap</a>
</p>

---

## What is Eidos

Eidos is an AI-native ontology editor. An **Agent network** reads your business research documents and constructs a structured ontology (YAML). You **review and refine** it through a visual interface — graph view, class editor, rule editor. Then a **deterministic pipeline** auto-generates all the downstream code your application needs:

| Output | What you get |
|--------|-------------|
| PostgreSQL schema | Tables, columns, constraints, incremental migrations |
| MCP tool server | `query_xxx` / `execute_xxx` tools with full Go implementation |
| Neo4j graph schema | Node labels, relationship types, synced properties |
| Agent configs | Tool bindings for business agents |
| Rule engine configs | Validation rules, triggers, computed fields |
| TypeScript types | Frontend interfaces matching your data model |
| Connector templates | Integration mapping scaffolds |

**One YAML in, seven artifacts out. No hand-written infrastructure code.**

## How It Works

```
                    ┌──────────────────────────┐
                    │  Upload research documents │
                    └─────────┬────────────────┘
                              ▼
              ┌───────────────────────────────┐
              │       Agent Network            │
              │  S1 Scene Analyst              │
              │    → S2 Ontology Architect     │
              │      → S3 Rule Designer        │
              │        → S4 Reviewer           │
              └───────────────┬───────────────┘
                              ▼
              ┌───────────────────────────────┐
              │   Structured ontology YAML     │
              └───────────────┬───────────────┘
                              ▼
              ┌───────────────────────────────┐
              │   Visual review & refinement   │
              │  Graph · Class · Rule editors  │
              └───────────────┬───────────────┘
                              ▼
              ┌───────────────────────────────┐
              │   Pipeline (7 generators)      │
              │   Deterministic · No LLM       │
              │                                │
              │   PG ─ MCP ─ Neo4j ─ Agent    │
              │   Rules ─ Types ─ Connectors   │
              └───────────────┬───────────────┘
                              ▼
              ┌───────────────────────────────┐
              │  Business agents ready to serve│
              └───────────────────────────────┘
```

### Design Principles

- **YAML is the single source of truth** — all downstream code is generated from it, never hand-edited
- **Pipeline is deterministic** — same YAML always produces the same output. No randomness, no LLM, no network calls
- **Human-in-the-loop** — every agent stage requires explicit confirmation before advancing
- **Incremental by default** — version updates generate `ALTER TABLE`, not `DROP + CREATE`

## Architecture

```
Browser
  └─ Eidos UI (:5180 dev / :8089 prod)
       ├─ /api/*  → Weave API (:8080)        # Agent runtime, auth
       ├─ /mcp/*  → Ontology MCP (:9091)      # 16 tools over JSON-RPC 2.0
       └─ static  → nginx

Weave API (:8080)
  └─ Dispatches agent tool calls → MCP servers

Ontology MCP Server (:9091)
  ├─ PostgreSQL (ontology schema)
  └─ Neo4j (graph queries)

Pipeline CLI (Go binary)
  └─ ontology.yaml → 7 generated outputs
```

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript, standalone SPA |
| Backend | Go (pipeline + MCP server) |
| Agent Runtime | [Weave](https://github.com/inocube/weave) API |
| Storage | PostgreSQL + Neo4j |
| Protocol | MCP over JSON-RPC 2.0 |

## Getting Started

### Prerequisites

- Go 1.22+
- Node.js 20+
- PostgreSQL 15+
- Neo4j 5+ (optional, for graph features)

### MCP Server

```bash
cd server
PG_URL="postgres://user:pass@localhost:5432/db?sslmode=disable" \
PORT=9091 \
go run ./cmd/ontologyserver
```

### Pipeline

```bash
cd pipeline
go build -o bin/generate ./cmd/generate

# Full generation
./bin/generate --from ontology.yaml --output ./out

# Incremental migration
./bin/generate --from ontology.yaml --previous ./versions/v1.0.0.yaml --output ./out
```

### Frontend

```bash
cd app
npm install
npm run dev    # http://localhost:5180
```

## Roadmap

| Phase | Focus | Status |
|-------|-------|--------|
| **1** | YAML spec + PG/MCP generators + end-to-end validation | In progress |
| **2** | Agent network + 7 visual review pages + remaining generators | Planned |
| **3** | Second-domain validation + cross-ontology reuse | Planned |

## Documentation

Design specs live in [`docs/`](docs/):

| Doc | Content |
|-----|---------|
| [01 — YAML Spec](docs/01-ontology-yaml-spec.md) | Ontology YAML format specification |
| [02 — Reference Ontology](docs/02-spare-parts-ontology.yaml) | Complete spare parts management ontology |
| [03 — Agent Definitions](docs/03-agent-definitions.md) | Four builder agents: prompts, tools, I/O |
| [04 — Page Designs](docs/04-page-designs.md) | Seven UI pages: layout and functionality |
| [05 — Pipeline Spec](docs/05-pipeline-spec.md) | Seven-step code generator specification |
| [06 — MCP Tools](docs/06-mcp-tools-spec.md) | Ontology MCP server tool definitions |
| [07 — Palantir Alignment](docs/07-palantir-alignment.md) | Methodology alignment and required fixes |

## License

[Apache-2.0](LICENSE)

---

<p align="center"><em>Named after Plato's εἶδος (eidos) — the ideal Form behind all things.</em></p>
