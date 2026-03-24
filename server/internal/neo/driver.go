package neo

import (
	"context"
	"fmt"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

// DB wraps the Neo4j driver for read queries.
type DB struct {
	Driver neo4j.DriverWithContext
}

// New creates a Neo4j connection and verifies connectivity.
func New(ctx context.Context, uri, user, pass string) (*DB, error) {
	driver, err := neo4j.NewDriverWithContext(uri, neo4j.BasicAuth(user, pass, ""))
	if err != nil {
		return nil, fmt.Errorf("create neo4j driver: %w", err)
	}

	if err := driver.VerifyConnectivity(ctx); err != nil {
		driver.Close(ctx)
		return nil, fmt.Errorf("neo4j connectivity: %w", err)
	}

	return &DB{Driver: driver}, nil
}

// Close shuts down the driver.
func (db *DB) Close(ctx context.Context) error {
	return db.Driver.Close(ctx)
}

// ReadSingle executes a read query and returns all records.
func (db *DB) ReadSingle(ctx context.Context, cypher string, params map[string]any) ([]*neo4j.Record, error) {
	session := db.Driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.Run(ctx, cypher, params)
	if err != nil {
		return nil, err
	}
	return result.Collect(ctx)
}

// Helper functions for safe type extraction from Neo4j records.

func ToString(val any) string {
	if val == nil {
		return ""
	}
	if s, ok := val.(string); ok {
		return s
	}
	return fmt.Sprintf("%v", val)
}

func ToFloat64(val any) float64 {
	if val == nil {
		return 0
	}
	switch v := val.(type) {
	case float64:
		return v
	case int64:
		return float64(v)
	case int:
		return float64(v)
	default:
		return 0
	}
}

func ToInt64(val any) int64 {
	if val == nil {
		return 0
	}
	switch v := val.(type) {
	case int64:
		return v
	case float64:
		return int64(v)
	case int:
		return int64(v)
	default:
		return 0
	}
}

func ToBool(val any) bool {
	if val == nil {
		return false
	}
	if b, ok := val.(bool); ok {
		return b
	}
	return false
}
