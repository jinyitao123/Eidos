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

-- Industry ontology templates (reusable across customers)
CREATE TABLE IF NOT EXISTS ontology.ontology_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    industry TEXT NOT NULL,
    domain TEXT NOT NULL DEFAULT '',
    version TEXT NOT NULL DEFAULT '1.0.0',
    description TEXT,
    yaml_content TEXT NOT NULL,
    param_schema JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Customer strategy profiles (per-project configurable parameters)
CREATE TABLE IF NOT EXISTS ontology.strategy_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES ontology.projects(id),
    template_id TEXT NOT NULL,
    profile_name TEXT NOT NULL DEFAULT 'default',
    parameters JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_strategy_profiles_project
    ON ontology.strategy_profiles(project_id) WHERE is_active = true;
`

func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, ddl)
	if err != nil {
		return fmt.Errorf("migrate ontology schema: %w", err)
	}
	return nil
}
