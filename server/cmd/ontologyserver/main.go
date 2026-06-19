package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"ontologyserver/internal/chat"
	"ontologyserver/internal/config"
	"ontologyserver/internal/executor"
	"ontologyserver/internal/mcp"
	"ontologyserver/internal/neo"
	"ontologyserver/internal/pg"
	"ontologyserver/internal/proposals"
	"ontologyserver/internal/rest"
	"ontologyserver/internal/store"
	"ontologyserver/internal/tools"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cfg := config.Load()

	// Connect PostgreSQL
	log.Println("connecting to PostgreSQL...")
	pool, err := pg.NewPool(ctx, cfg.PGURL)
	if err != nil {
		log.Fatalf("pg: %v", err)
	}
	defer pool.Close()

	// Run PG migrations
	if err := pg.Migrate(ctx, pool); err != nil {
		log.Fatalf("pg migrate: %v", err)
	}
	log.Println("pg: ontology schema migrated")

	// Connect Neo4j
	log.Println("connecting to Neo4j...")
	neoDB, err := neo.New(ctx, cfg.Neo4jURI, cfg.Neo4jUser, cfg.Neo4jPass)
	if err != nil {
		log.Printf("neo4j: %v (graph tools disabled)", err)
	} else {
		defer neoDB.Close(ctx)
		log.Println("neo4j: connected")
	}

	// Initialize versioned store and proposal governance
	ontStore := store.NewPG(pool)
	propStore := proposals.NewPG(pool)

	// Build MCP router with all tools
	router := mcp.NewRouter()
	tools.RegisterAll(router, &tools.Deps{
		PG:        pool,
		Neo:       neoDB,
		Store:     ontStore,
		Proposals: propStore,
	})

	// Build HTTP mux: MCP on /mcp (and root for backward compat), REST on /api/
	httpMux := http.NewServeMux()
	mcpHandler := mcp.Handler(router)
	httpMux.HandleFunc("/mcp", mcpHandler)
	httpMux.HandleFunc("/", mcpHandler)
	// 精简工具面专用路径(无头执行器连这个,只暴露建模工具)。
	httpMux.HandleFunc("/mcp-ontology", mcp.HandlerWithProfile(router, "ontology"))
	restH := &rest.Handler{Store: ontStore, Proposals: propStore}
	restH.Mount(httpMux)

	// 可换执行器（AI 对话）：weave（默认，零回归）/ claude-code / opencode
	exe, err := executor.New(executor.Config{
		Kind:         cfg.Executor,
		WeaveURL:     cfg.WeaveURL,
		MCPURL:       cfg.MCPSelfURL,
		Model:        cfg.ExecutorModel,
		Workspace:    "",
		LoomProvider: cfg.LoomProvider,
		LoomModel:    cfg.LoomModel,
		LoomKey:      cfg.LoomKey,
	})
	if err != nil {
		log.Fatalf("executor: %v", err)
	}
	log.Printf("chat executor: %s", exe.Name())
	chatH := &chat.Handler{Exec: exe}
	chatH.Mount(httpMux)

	// Start HTTP server
	srv := &http.Server{
		Addr:         cfg.Addr(),
		Handler:      httpMux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	go func() {
		log.Printf("Ontology MCP Server listening on %s", cfg.Addr())
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server: %v", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("shutting down...")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	srv.Shutdown(shutdownCtx)
}
