<p align="center">
  <strong>εἶδος</strong>
</p>

<h1 align="center">Eidos</h1>

<p align="center">
  AI 原生本体工作台 —— 对话建模、实时编辑、确定性生成下游。<br/>
  LLM 后端可换:Weave · Claude Code · opencode · loom。
</p>

<p align="center">
  中文 | <a href="./README.md">English</a>
</p>

<p align="center">
  <a href="#eidos-是什么">是什么</a> · <a href="#工作流程">流程</a> · <a href="#执行器">执行器</a> · <a href="#架构">架构</a> · <a href="#快速开始">快速开始</a>
</p>

---

## Eidos 是什么

Eidos 是一个 AI 原生的**本体工作台**。你用大白话描述业务,LLM agent 把它落成结构化本体(实体/属性/关系)并写进版本化存储;你**实时**看到并编辑结果;一条确定性管道把本体生成应用所需的下游代码。

一切都在**一个工作台(Studio)**里:

- **左侧 —— 对话。** 用自然语言描述或修正模型,agent 调本体工具把它建出来。
- **右侧 —— 活的模型。** 版本化库之上的 6 个页签,随对话(或你的手动编辑)实时刷新:
  - **图谱** —— 业务对象(人/事/物)+ 关系,卡片或 SVG 图,内联编辑
  - **实例** —— 实例数据(接入数据源前为能力态)
  - **规则 / 指标 / 动作** —— 逻辑层(ECA)深度编辑表单
  - **评估** —— 确定性、零数据的健康分 + 诊断
  - **版本**(修订/发布/回滚)与**继承** 抽屉

**驱动对话的 LLM 后端可换**(见[执行器](#执行器));**底层工具层确定性、零 LLM**,所以不管谁来驱动,工具都一样。

### 管道:一份本体进,七样产物出

确定性、无 LLM 的管道把本体生成:

| 产物 | 内容 |
|------|------|
| PostgreSQL schema | 表/列/约束 + 增量迁移 |
| MCP 工具服务 | `query_*` / `execute_*` 工具 + 完整 Go 实现 |
| Neo4j 图 schema | 节点标签、关系类型、同步属性 |
| Agent 配置 | 业务 agent 的工具绑定 |
| 规则引擎配置 | 校验规则、触发器、派生字段 |
| TypeScript 类型 | 与数据模型对齐的前端接口 |
| 连接器模板 | 集成映射脚手架 |

## 工作流程

```
  自然语言描述  ──►  执行器(可换 LLM)
                       │  受控工具循环
                       ▼
              本体 MCP 工具(确定性、零 LLM)
                       │  校验 → 版本 → 落库
                       ▼
              版本化本体库(PostgreSQL)
                       │
        ┌──────────────┼────────────────┐
        ▼                                ▼
   工作台(实时编辑)              管道(7 生成器,无 LLM)
   图谱·规则·指标·评估           PG·MCP·Neo4j·agent·规则·类型·连接器
```

### 设计原则

- **本体是唯一真相** —— 下游代码生成而来,不手改。
- **工具层确定性、零 LLM** —— 判断/打分/校验/生成都是纯 Go;只有"跟人说话"才用 LLM。
- **LLM 后端是薄而可换的接缝** —— 换引擎不动工具层、不动 UI。
- **人在环治理** —— 提议 → 人审 → 落地;版本化、安全回滚。
- **默认增量** —— 版本更新生成 `ALTER TABLE`,不是 `DROP + CREATE`。

## 执行器

对话后端由 `EIDOS_EXECUTOR` 运行时选择。四种都驱动**同一套**本体工具,区别只在谁跑对话。

| `EIDOS_EXECUTOR` | 后端 | 可控性 | 说明 |
|------------------|------|--------|------|
| `loom` | loom 受控工具循环(DeepSeek/OpenAI/Kimi/GLM/Anthropic,走 API key) | **强** —— 强制出工具,模型只"描述"就重试 | **产品后端首选。** API key 计费。provider 用 `EIDOS_LOOM_PROVIDER`/`EIDOS_LOOM_MODEL`。 |
| `weave` | [Weave](https://github.com/jinyitao123/Weave) agent graph(`/v1/chat`) | 强(loom graph) | 需起 Weave。 |
| `claude-code` | 无头 `claude -p` 经 MCP | 弱(黑盒 agent) | **仅自己开发/测试** —— Anthropic 禁止用个人 Claude 订阅当产品后端;产品请用 API key 执行器。 |
| `opencode` | 无头 `opencode run` 经 MCP | 弱 | 用你的 `opencode auth` 凭证(API key)。 |

默认:环境里检测到 API key 时用 `loom`,否则 `weave`。

无头执行器连**精简工具面** `/mcp-ontology`(聚焦建模工具),前端连全量 `/mcp`。

## 架构

```
浏览器
  └─ Eidos Studio (:5180 dev / nginx 生产)
       └─ /mcp/*  → Eidos server (:9091)

Eidos server (:9091)
  ├─ MCP 工具层    (/mcp 全量 · /mcp-ontology 精简)   确定性、零 LLM
  ├─ REST(只读)   GET /ontologies/{id} · /health · /versions · /proposals
  ├─ /chat (SSE)   → 执行器接缝(weave | claude-code | opencode | loom)
  ├─ PostgreSQL    版本化本体库
  └─ Neo4j(可选)  图查询

管道 CLI (Go)
  └─ 本体 → 7 样产物
```

| 层 | 技术 |
|----|------|
| 前端 | React 19 + TypeScript(单一 Studio SPA) |
| 后端 | Go(MCP server + 执行器接缝 + 管道) |
| LLM 引擎 | 可换 —— [loom](https://github.com/jinyitao123/loom) / Weave / Claude Code / opencode |
| 存储 | PostgreSQL(+ 可选 Neo4j) |
| 协议 | MCP over JSON-RPC 2.0;对话走 SSE |

## 快速开始

### 前置

- Go **1.24+**(loom 要求)
- Node.js 20+
- PostgreSQL 15+
- Neo4j 5+(可选,图查询)
- `loom` 执行器需一个 LLM API key(如 `DEEPSEEK_API_KEY`);`weave` 需一个 Weave 实例

> **注意:** `server/go.mod` 用本地 `replace` 指向 `github.com/jinyitao123/loom`。换机构建需把 loom checkout 到该路径(或改 replace / 用已发布 tag)。

### 服务端

```bash
cd server
PG_URL="postgres://user@localhost:5432/eidos?sslmode=disable" \
PORT=9091 \
EIDOS_EXECUTOR=loom EIDOS_LOOM_PROVIDER=deepseek DEEPSEEK_API_KEY=sk-... \
go run ./cmd/ontologyserver
```

启动自动迁移 schema。把 `EIDOS_EXECUTOR` 换成 `weave`/`claude-code`/`opencode` 即换对话后端。

### 前端

```bash
cd app
npm install
npm run dev    # http://localhost:5180
```

### 管道

```bash
cd pipeline
go build -o bin/generate ./cmd/generate
./bin/generate --from ontology.yaml --output ./out
./bin/generate --from ontology.yaml --previous ./versions/v1.0.0.yaml --output ./out   # 增量
```

### 契约冒烟

`scripts/ontopia-contract-smoke.py` 对运行中的服务跑完整写入链路(存→读→upsert→概念→拒绝→delete),适合做首次集成自检。

## 文档

设计稿与历史在 [`docs/`](docs/),建议从这几篇开始:

| 文档 | 内容 |
|------|------|
| [合并设计](docs/2026-06-19-eidos-merge-design.md) | 统一数据模型 + 执行器接缝 + 收敛计划 |
| [01 — YAML 规范](docs/01-ontology-yaml-spec.md) | 本体 YAML 格式 |
| [05 — 管道规范](docs/05-pipeline-spec.md) | 七步生成器 |
| [06 — MCP 工具](docs/06-mcp-tools-spec.md) | MCP 工具定义 |

## 许可

[Apache-2.0](LICENSE)

---

<p align="center"><em>得名于柏拉图的 εἶδος(eidos)—— 万物背后的理型。</em></p>
