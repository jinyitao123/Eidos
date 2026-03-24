<p align="center">
  <strong>εἶδος</strong>
</p>

<h1 align="center">Eidos</h1>

<p align="center">
  AI 原生本体编辑器 — Agent 构建，人工审核，管道生成。
</p>

<p align="center">
  中文 | <a href="./README.md">English</a>
</p>

<p align="center">
  <a href="#eidos-是什么">简介</a> · <a href="#工作流程">流程</a> · <a href="#架构">架构</a> · <a href="#快速开始">开始</a> · <a href="#开发阶段">路线</a>
</p>

---

## Eidos 是什么

Eidos 是一个 **AI 原生的本体编辑器**。四个 Agent 组成的网络从业务调研文档中自动构建结构化本体（YAML 格式），你在可视化界面中审核和微调，然后确定性管道一键生成全部下游代码：

| 产物 | 输出内容 |
|------|---------|
| PostgreSQL schema | 建表语句、约束、增量迁移 |
| MCP 工具服务器 | `query_xxx` / `execute_xxx` 工具 + 完整 Go 实现 |
| Neo4j 图谱 schema | 节点标签、关系类型、同步属性 |
| Agent 配置 | 业务 Agent 的工具绑定 |
| 规则引擎配置 | 校验规则、触发器、计算字段 |
| TypeScript 类型 | 与数据模型对齐的前端接口 |
| 连接器模板 | 集成映射骨架 |

**一份 YAML 输入，七种产物输出。零手写基础设施代码。**

## 工作流程

```
                    ┌────────────────────────┐
                    │    上传业务调研文档       │
                    └─────────┬──────────────┘
                              ▼
              ┌───────────────────────────────┐
              │         Agent 网络             │
              │  S1 场景分析师                  │
              │    → S2 本体架构师              │
              │      → S3 规则设计师            │
              │        → S4 审核员              │
              └───────────────┬───────────────┘
                              ▼
              ┌───────────────────────────────┐
              │      结构化本体 YAML            │
              └───────────────┬───────────────┘
                              ▼
              ┌───────────────────────────────┐
              │        可视化审核与微调          │
              │   图谱视图 · 类编辑 · 规则编辑   │
              └───────────────┬───────────────┘
                              ▼
              ┌───────────────────────────────┐
              │     管道生成器（7 步）           │
              │     确定性生成 · 无 LLM         │
              │                                │
              │   PG ─ MCP ─ Neo4j ─ Agent    │
              │   规则 ─ 类型 ─ 连接器          │
              └───────────────┬───────────────┘
                              ▼
              ┌───────────────────────────────┐
              │     业务 Agent 立即可用          │
              └───────────────────────────────┘
```

### 设计原则

- **YAML 是唯一真相源** — 所有下游代码从它生成，从不手写
- **管道是确定性的** — 相同 YAML 永远产出相同结果，无随机性、无 LLM、无网络调用
- **人在回路中** — 每个 Agent 阶段必须人工确认后才能进入下一步
- **增量优先** — 版本更新生成 `ALTER TABLE` 而非 `DROP + CREATE`

## 架构

```
浏览器
  └─ Eidos UI (:5180 开发 / :8089 生产)
       ├─ /api/*  → Weave API (:8080)        # Agent 运行时、认证
       ├─ /mcp/*  → 本体 MCP (:9091)          # 16 个工具，JSON-RPC 2.0
       └─ 静态资源 → nginx

Weave API (:8080)
  └─ 分发 Agent 工具调用 → MCP 服务器

本体 MCP 服务器 (:9091)
  ├─ PostgreSQL（本体 schema）
  └─ Neo4j（图谱查询）

管道 CLI（Go 二进制）
  └─ ontology.yaml → 7 种生成产物
```

| 层 | 技术 |
|----|------|
| 前端 | React 19 + TypeScript，独立 SPA |
| 后端 | Go（管道生成器 + MCP 服务器） |
| Agent 运行时 | [Weave](https://github.com/jinyitao123/Weave) API |
| 存储 | PostgreSQL + Neo4j |
| 协议 | MCP over JSON-RPC 2.0 |

## 快速开始

### 环境要求

- Go 1.22+
- Node.js 20+
- PostgreSQL 15+
- Neo4j 5+（可选，用于图谱功能）

### MCP 服务器

```bash
cd server
PG_URL="postgres://user:pass@localhost:5432/db?sslmode=disable" \
PORT=9091 \
go run ./cmd/ontologyserver
```

### 管道生成器

```bash
cd pipeline
go build -o bin/generate ./cmd/generate

# 全量生成
./bin/generate --from ontology.yaml --output ./out

# 增量迁移
./bin/generate --from ontology.yaml --previous ./versions/v1.0.0.yaml --output ./out
```

### 前端

```bash
cd app
npm install
npm run dev    # http://localhost:5180
```

## 开发阶段

| 阶段 | 重点 | 状态 |
|------|------|------|
| **1** | YAML 规范 + PG/MCP 生成器 + 端到端验证 | 进行中 |
| **2** | Agent 网络 + 7 个可视化审核页面 + 剩余生成器 | 计划中 |
| **3** | 第二业务场景验证 + 跨本体复用 | 计划中 |

## 设计文档

详细设计规格在 [`docs/`](docs/) 目录：

| 文档 | 内容 |
|------|------|
| [01 — YAML 规范](docs/01-ontology-yaml-spec.md) | 本体 YAML 格式完整规范 |
| [02 — 参考本体](docs/02-spare-parts-ontology.yaml) | 备件管理完整本体样例 |
| [03 — Agent 定义](docs/03-agent-definitions.md) | 四个构建 Agent：提示词、工具、输入输出 |
| [04 — 页面设计](docs/04-page-designs.md) | 七个 UI 页面：布局与功能 |
| [05 — 管道规格](docs/05-pipeline-spec.md) | 七步代码生成器技术规格 |
| [06 — MCP 工具](docs/06-mcp-tools-spec.md) | 本体 MCP 服务器工具定义 |
| [07 — Palantir 对齐](docs/07-palantir-alignment.md) | 方法论对齐与补充修正 |

## 许可证

[Apache-2.0](LICENSE)

---

<p align="center"><em>取名自柏拉图的 εἶδος（理型）— 万物背后的理想形式。</em></p>
