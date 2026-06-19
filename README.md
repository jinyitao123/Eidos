<p align="center">
  <strong>εἶδος</strong>
</p>

<h1 align="center">Eidos</h1>

<p align="center">
  AI-native ontology workbench — chat to build, edit live, generate downstream.<br/>
  Swappable LLM backend: Weave · Claude Code · opencode · loom.
</p>

<p align="center">
  <a href="./README.zh-CN.md">中文</a> | English
</p>

<p align="center">
  <a href="#what-is-eidos">What</a> · <a href="#how-it-works">How</a> · <a href="#executors">Executors</a> · <a href="#architecture">Architecture</a> · <a href="#getting-started">Get Started</a>
</p>

---

## What is Eidos

Eidos is an AI-native **ontology workbench**. You describe your business in plain language; an LLM agent turns it into a structured ontology (entities / attributes / relationships) and writes it to a versioned store. You see and edit the result **live** — and a deterministic pipeline generates the downstream code your application needs.

Everything lives in **one workbench** (the Studio):

- **Left — conversation.** Describe or refine the model in natural language; the agent calls ontology tools to build it.
- **Right — the living model.** Six tabs over the versioned store, all live-refreshing as the chat (or your edits) change things:
  - **图谱 Graph** — business objects (person/event/thing) + relationships, as cards or an SVG graph; inline edit
  - **实例 Instances** — instance data (capability state until a data source is connected)
  - **规则 / 指标 / 动作 Rules / Metrics / Actions** — deep edit forms for the logic layer (ECA)
  - **评估 Eval** — deterministic, zero-data health score + findings
  - drawers for **版本 Versions** (revision/release/restore) and **继承 Inheritance**

The **LLM backend that drives the chat is swappable** (see [Executors](#executors)) — and the **tool layer underneath is deterministic and LLM-free**, so the same tools work no matter which backend drives them.

### Pipeline: one ontology in, seven artifacts out

A deterministic, no-LLM pipeline turns the ontology into:

| Output | What you get |
|--------|-------------|
| PostgreSQL schema | Tables, columns, constraints, incremental migrations |
| MCP tool server | `query_*` / `execute_*` tools with full Go implementation |
| Neo4j graph schema | Node labels, relationship types, synced properties |
| Agent configs | Tool bindings for business agents |
| Rule engine configs | Validation rules, triggers, computed fields |
| TypeScript types | Frontend interfaces matching your data model |
| Connector templates | Integration mapping scaffolds |

## How It Works

```
  Describe in natural language  ──►  Executor (swappable LLM)
                                       │  controlled tool loop
                                       ▼
                              Ontology MCP tools (deterministic, LLM-free)
                                       │  validate → version → store
                                       ▼
                              Versioned ontology store (PostgreSQL)
                                       │
                    ┌──────────────────┼───────────────────┐
                    ▼                                       ▼
        Studio workbench (live edit)          Pipeline (7 generators, no LLM)
        graph · rules · metrics · eval        PG · MCP · Neo4j · agents ·
                                              rules · types · connectors
```

### Design Principles

- **The ontology is the single source of truth** — downstream code is generated, never hand-edited.
- **The tool layer is deterministic and LLM-free** — judging/scoring/validation/generation are plain Go; only "talk to the user" is LLM.
- **The LLM backend is a thin, swappable seam** — change the engine without touching tools or UI.
- **Human-in-the-loop governance** — proposals → review → apply; versioned with safe rollback.
- **Incremental by default** — version updates generate `ALTER TABLE`, not `DROP + CREATE`.

## Executors

The chat backend is chosen at runtime with `EIDOS_EXECUTOR`. All four drive the **same** ontology tools; they differ only in who runs the conversation.

| `EIDOS_EXECUTOR` | Backend | Control | Notes |
|------------------|---------|---------|-------|
| `loom` | loom controlled tool loop (DeepSeek / OpenAI / Kimi / GLM / Anthropic via API key) | **Full** — forces tool calls, retries if the model only "describes" | **Recommended for product use.** API-key billing. Provider via `EIDOS_LOOM_PROVIDER`/`EIDOS_LOOM_MODEL`. |
| `weave` | [Weave](https://github.com/jinyitao123/Weave) agent graph (`/v1/chat`) | Full (loom graph) | Needs a Weave instance. |
| `claude-code` | headless `claude -p` over MCP | Limited (black-box agent) | **Dev/personal only** — Anthropic forbids using a personal Claude subscription as a product backend; use API-key executors for products. |
| `opencode` | headless `opencode run` over MCP | Limited | Uses your `opencode auth` credentials (API key). |

Default: `loom` when an API key is detected in the environment, otherwise `weave`.

The headless executors connect back to a **slimmed tool surface** at `/mcp-ontology` (the focused modeling tools), while the frontend uses the full tool set at `/mcp`.

## Architecture

```
Browser
  └─ Eidos Studio (:5180 dev / nginx prod)
       └─ /mcp/*  → Eidos server (:9091)

Eidos server (:9091)
  ├─ MCP tool layer   (/mcp full · /mcp-ontology slim)   deterministic, LLM-free
  ├─ REST (read)      GET /ontologies/{id} · /health · /versions · /proposals
  ├─ /chat (SSE)      → Executor seam (weave | claude-code | opencode | loom)
  ├─ PostgreSQL       versioned ontology store
  └─ Neo4j (optional) graph queries

Pipeline CLI (Go)
  └─ ontology → 7 generated outputs
```

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript (single Studio SPA) |
| Backend | Go (MCP server + executor seam + pipeline) |
| LLM engine | Swappable — [loom](https://github.com/jinyitao123/loom) / Weave / Claude Code / opencode |
| Storage | PostgreSQL (+ Neo4j optional) |
| Protocol | MCP over JSON-RPC 2.0; chat over SSE |

## Getting Started

### Prerequisites

- Go **1.24+** (loom requires it)
- Node.js 20+
- PostgreSQL 15+
- Neo4j 5+ (optional, for graph queries)
- An LLM API key for the `loom` executor (e.g. `DEEPSEEK_API_KEY`), or a Weave instance for `weave`

> **Note:** `server/go.mod` uses a local `replace` for `github.com/jinyitao123/loom`. To build elsewhere, check out loom at that path (or update the replace / use a published tag).

### Server

```bash
cd server
PG_URL="postgres://user@localhost:5432/eidos?sslmode=disable" \
PORT=9091 \
EIDOS_EXECUTOR=loom EIDOS_LOOM_PROVIDER=deepseek DEEPSEEK_API_KEY=sk-... \
go run ./cmd/ontologyserver
```

The schema migrates automatically on start. Swap `EIDOS_EXECUTOR` to `weave` / `claude-code` / `opencode` to change the chat backend.

### Frontend

```bash
cd app
npm install
npm run dev    # http://localhost:5180
```

### Pipeline

```bash
cd pipeline
go build -o bin/generate ./cmd/generate
./bin/generate --from ontology.yaml --output ./out
./bin/generate --from ontology.yaml --previous ./versions/v1.0.0.yaml --output ./out   # incremental
```

### Contract smoke test

`scripts/ontopia-contract-smoke.py` exercises the full write path (save → read → upsert → concept → reject → delete) against a running server — a good first integration check.

## Documentation

Design specs and history live in [`docs/`](docs/). Start with:

| Doc | Content |
|-----|---------|
| [Merge design](docs/2026-06-19-eidos-merge-design.md) | Unified data model + executor seam + convergence plan |
| [01 — YAML Spec](docs/01-ontology-yaml-spec.md) | Ontology YAML format |
| [05 — Pipeline Spec](docs/05-pipeline-spec.md) | Seven-step generator spec |
| [06 — MCP Tools](docs/06-mcp-tools-spec.md) | MCP tool definitions |

## License

[Apache-2.0](LICENSE)

---

<p align="center"><em>Named after Plato's εἶδος (eidos) — the ideal Form behind all things.</em></p>
