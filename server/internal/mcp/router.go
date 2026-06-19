package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
)

// ToolFunc handles a tools/call invocation.
type ToolFunc func(ctx context.Context, args json.RawMessage) *ToolCallResult

// Router dispatches JSON-RPC methods.
type Router struct {
	tools    []ToolDef
	handlers map[string]ToolFunc
	profiles map[string]map[string]bool // profile 名 → 允许的工具名集合
}

func NewRouter() *Router {
	return &Router{
		handlers: make(map[string]ToolFunc),
		profiles: make(map[string]map[string]bool),
	}
}

// profileCtxKey 在 ctx 里携带请求的 profile 名(由 HTTP 层从 ?profile= 读取)。
type profileCtxKey struct{}

func withProfile(ctx context.Context, name string) context.Context {
	return context.WithValue(ctx, profileCtxKey{}, name)
}

// RegisterProfile 注册一个工具子集 profile。tools/list 在 ?profile=<name> 时只返回这些工具。
func (r *Router) RegisterProfile(name string, toolNames []string) {
	m := make(map[string]bool, len(toolNames))
	for _, n := range toolNames {
		m[n] = true
	}
	r.profiles[name] = m
}

func (r *Router) Register(def ToolDef, handler ToolFunc) {
	r.tools = append(r.tools, def)
	r.handlers[def.Name] = handler
}

func (r *Router) Handle(ctx context.Context, method string, params json.RawMessage) (any, *rpcError) {
	switch method {
	case "initialize":
		return r.handleInitialize(params)
	case "notifications/initialized", "initialized", "notifications/cancelled", "ping":
		// 通知/心跳：无副作用，回空 result（真正的通知由 server.go 按无 id 不写响应）。
		return map[string]any{}, nil
	case "tools/list":
		return r.handleList(ctx)
	case "tools/call":
		return r.handleCall(ctx, params)
	default:
		return nil, &rpcError{Code: -32601, Message: fmt.Sprintf("unknown method: %s", method)}
	}
}

// handleInitialize 应答 MCP 握手——claude/opencode 等真正的 MCP 客户端连上后第一步发
// initialize，不应答它们就拿不到工具。回显客户端的 protocolVersion，声明 tools 能力。
func (r *Router) handleInitialize(params json.RawMessage) (any, *rpcError) {
	var p struct {
		ProtocolVersion string `json:"protocolVersion"`
	}
	_ = json.Unmarshal(params, &p)
	version := p.ProtocolVersion
	if version == "" {
		version = "2025-06-18"
	}
	return map[string]any{
		"protocolVersion": version,
		"capabilities":    map[string]any{"tools": map[string]any{}},
		"serverInfo":      map[string]any{"name": "eidos-ontology", "version": "1.0.0"},
	}, nil
}

func (r *Router) handleList(ctx context.Context) (any, *rpcError) {
	if name, ok := ctx.Value(profileCtxKey{}).(string); ok && name != "" {
		if allow := r.profiles[name]; allow != nil {
			filtered := make([]ToolDef, 0, len(allow))
			for _, t := range r.tools {
				if allow[t.Name] {
					filtered = append(filtered, t)
				}
			}
			return map[string]any{"tools": filtered}, nil
		}
	}
	return map[string]any{"tools": r.tools}, nil
}

func (r *Router) handleCall(ctx context.Context, params json.RawMessage) (any, *rpcError) {
	var call struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(params, &call); err != nil {
		return nil, &rpcError{Code: -32602, Message: "invalid params"}
	}

	handler, ok := r.handlers[call.Name]
	if !ok {
		return nil, &rpcError{Code: -32602, Message: fmt.Sprintf("unknown tool: %s", call.Name)}
	}

	// Log tool name and abbreviated args for debugging
	argStr := string(call.Arguments)
	if len(argStr) > 200 {
		argStr = argStr[:200] + "..."
	}
	log.Printf("mcp: tools/call %s args=%s", call.Name, argStr)
	result := handler(ctx, call.Arguments)
	if result.IsError {
		log.Printf("mcp: tools/call %s ERROR: %s", call.Name, result.Content[0].Text)
	}
	return result, nil
}
