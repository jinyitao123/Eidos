package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"ontologyserver/internal/config"
	"ontologyserver/internal/mcp"
	"ontologyserver/internal/neo"
	"ontologyserver/internal/pg"
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

	// Build MCP router with all 16 tools
	router := mcp.NewRouter()
	tools.RegisterAll(router, &tools.Deps{PG: pool, Neo: neoDB})

	// Start HTTP server
	handler := mcp.Handler(router)
	srv := &http.Server{
		Addr:         cfg.Addr(),
		Handler:      handler,
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
