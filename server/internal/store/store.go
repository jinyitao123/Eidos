package store

import (
	"context"
	"time"

	ontoyaml "ontologyserver/internal/yaml"
)

// Document wraps an Ontology with metadata for versioned storage.
type Document struct {
	Ontology ontoyaml.Ontology `json:"ontology"`
}

// VersionMeta is a version timeline record (no doc body, for listings).
type VersionMeta struct {
	Version     int       `json:"version"`
	Kind        string    `json:"kind"` // revision | release
	ContentHash string    `json:"content_hash"`
	Source      string    `json:"source"`
	CreatedAt   time.Time `json:"created_at"`
}

// Store is the versioned ontology document store.
type Store interface {
	Save(ctx context.Context, d Document) error
	SaveWithSource(ctx context.Context, d Document, source string) error
	Read(ctx context.Context, id string) (Document, bool, error)
	ListVersions(ctx context.Context, ontologyID string) ([]VersionMeta, error)
	ReadVersion(ctx context.Context, ontologyID string, version int) (Document, bool, error)
	AppendRelease(ctx context.Context, ontologyID string) (int, error)
	// Delete 删除本体及其版本/提议;返回该本体此前是否存在。
	Delete(ctx context.Context, id string) (bool, error)
}
