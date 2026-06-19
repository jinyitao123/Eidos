package config

import (
	"fmt"
	"os"
)

type Config struct {
	PGURL     string
	Port      string
	Neo4jURI  string
	Neo4jUser string
	Neo4jPass string

	// 可换执行器（AI 对话后端）
	Executor      string // EIDOS_EXECUTOR: weave（默认）| claude-code | opencode | loom
	WeaveURL      string // WEAVE_URL: weave 执行器的 Weave API 基址
	ExecutorModel string // EIDOS_EXECUTOR_MODEL: 模型覆盖（claude 别名/全名；opencode provider/model）
	MCPSelfURL    string // MCP_SELF_URL: claude/opencode/loom 连回的本机 MCP 端点

	// loom 执行器(受控循环,API key 合规)
	LoomProvider string // EIDOS_LOOM_PROVIDER: deepseek（默认）| openai | kimi | glm | anthropic
	LoomModel    string // EIDOS_LOOM_MODEL
	LoomKey      string // EIDOS_LOOM_API_KEY
}

func Load() Config {
	c := Config{
		PGURL:         os.Getenv("PG_URL"),
		Port:          os.Getenv("PORT"),
		Neo4jURI:      os.Getenv("NEO4J_URI"),
		Neo4jUser:     os.Getenv("NEO4J_USER"),
		Neo4jPass:     os.Getenv("NEO4J_PASSWORD"),
		Executor:      os.Getenv("EIDOS_EXECUTOR"),
		WeaveURL:      os.Getenv("WEAVE_URL"),
		ExecutorModel: os.Getenv("EIDOS_EXECUTOR_MODEL"),
		MCPSelfURL:    os.Getenv("MCP_SELF_URL"),
		LoomProvider:  os.Getenv("EIDOS_LOOM_PROVIDER"),
		LoomModel:     os.Getenv("EIDOS_LOOM_MODEL"),
		LoomKey:       os.Getenv("EIDOS_LOOM_API_KEY"),
	}
	if c.PGURL == "" {
		c.PGURL = "postgres://weave:weave@localhost:5432/weave?sslmode=disable"
	}
	if c.Port == "" {
		c.Port = "9091"
	}
	if c.Neo4jURI == "" {
		c.Neo4jURI = "bolt://localhost:7687"
	}
	if c.Neo4jUser == "" {
		c.Neo4jUser = "neo4j"
	}
	if c.Neo4jPass == "" {
		c.Neo4jPass = "spareparts"
	}
	if c.Executor == "" {
		// 默认优先 loom(可控 + API key 合规);只有在能解析到 loom 的 key 时才默认它,
		// 否则回退 weave(零配置)。显式设 EIDOS_EXECUTOR 覆盖此逻辑。
		if loomKeyAvailable(c) {
			c.Executor = "loom"
		} else {
			c.Executor = "weave"
		}
	}
	if c.WeaveURL == "" {
		c.WeaveURL = "http://localhost:8080"
	}
	if c.MCPSelfURL == "" {
		c.MCPSelfURL = fmt.Sprintf("http://127.0.0.1:%s/mcp", c.Port)
	}
	return c
}

func (c Config) Addr() string {
	return fmt.Sprintf(":%s", c.Port)
}

// loomKeyAvailable 判断环境里是否有任一可用的 loom provider key(决定是否默认 loom)。
func loomKeyAvailable(c Config) bool {
	if c.LoomKey != "" {
		return true
	}
	for _, env := range []string{
		"EIDOS_LOOM_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_API_KEY",
		"MOONSHOT_API_KEY", "KIMI_API_KEY", "GLM_API_KEY", "ZHIPUAI_API_KEY", "ANTHROPIC_API_KEY",
	} {
		if os.Getenv(env) != "" {
			return true
		}
	}
	return false
}
