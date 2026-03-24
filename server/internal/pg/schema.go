package pg

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

const ddl = `
CREATE SCHEMA IF NOT EXISTS ontology;

-- Project metadata
CREATE TABLE IF NOT EXISTS ontology.projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'building',
    current_stage VARCHAR(50),
    yaml_content TEXT,
    published_version VARCHAR(20),
    published_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

-- Stage outputs from each builder agent
CREATE TABLE IF NOT EXISTS ontology.stage_outputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES ontology.projects(id),
    stage VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    agent_id VARCHAR(100),
    confirmed_by VARCHAR(255),
    confirmed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now()
);

-- Version history
CREATE TABLE IF NOT EXISTS ontology.versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES ontology.projects(id),
    version VARCHAR(20) NOT NULL,
    yaml_content TEXT NOT NULL,
    changelog TEXT,
    published_at TIMESTAMP DEFAULT now()
);

-- Uploaded research documents
CREATE TABLE IF NOT EXISTS ontology.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES ontology.projects(id),
    filename VARCHAR(255) NOT NULL,
    content TEXT,
    original_path VARCHAR(500),
    uploaded_at TIMESTAMP DEFAULT now()
);
`

func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, ddl)
	if err != nil {
		return fmt.Errorf("migrate ontology schema: %w", err)
	}
	return nil
}
