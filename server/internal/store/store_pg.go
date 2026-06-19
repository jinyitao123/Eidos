package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PG struct{ pool *pgxpool.Pool }

func NewPG(pool *pgxpool.Pool) *PG {
	return &PG{pool: pool}
}

func (p *PG) Save(ctx context.Context, d Document) error {
	return p.SaveWithSource(ctx, d, "edit")
}

func (p *PG) SaveWithSource(ctx context.Context, d Document, source string) error {
	doc, err := json.Marshal(d)
	if err != nil {
		return err
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, d.Ontology.ID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `
		INSERT INTO ontology.ontologies (id, name, version, doc, updated_at)
		VALUES ($1, $2, $3, $4, now())
		ON CONFLICT (id) DO UPDATE
		SET name = EXCLUDED.name, version = EXCLUDED.version,
		    doc = EXCLUDED.doc, updated_at = now()`,
		d.Ontology.ID, d.Ontology.Name, d.Ontology.Version, doc); err != nil {
		return err
	}
	if err = appendVersionTx(ctx, tx, d.Ontology.ID, "revision", source, doc); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type rowExecQuerier interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func appendVersionTx(ctx context.Context, q rowExecQuerier, ontologyID, kind, source string, doc []byte) error {
	sum := sha256.Sum256(doc)
	hash := hex.EncodeToString(sum[:16])
	var latest string
	err := q.QueryRow(ctx,
		`SELECT content_hash FROM ontology.ontology_versions WHERE ontology_id=$1 ORDER BY version DESC LIMIT 1`, ontologyID).Scan(&latest)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if err == nil && latest == hash {
		return nil
	}
	_, err = q.Exec(ctx, `
		INSERT INTO ontology.ontology_versions (ontology_id, version, kind, content_hash, source, doc)
		VALUES ($1, (SELECT COALESCE(MAX(version),0)+1 FROM ontology.ontology_versions WHERE ontology_id=$1), $2, $3, $4, $5)`,
		ontologyID, kind, hash, source, doc)
	return err
}

func (p *PG) ListVersions(ctx context.Context, ontologyID string) ([]VersionMeta, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT version, kind, content_hash, source, created_at FROM ontology.ontology_versions WHERE ontology_id=$1 ORDER BY version DESC`, ontologyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []VersionMeta
	for rows.Next() {
		var v VersionMeta
		if err := rows.Scan(&v.Version, &v.Kind, &v.ContentHash, &v.Source, &v.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (p *PG) AppendRelease(ctx context.Context, ontologyID string) (int, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, ontologyID); err != nil {
		return 0, err
	}
	var raw []byte
	if err = tx.QueryRow(ctx, `SELECT doc FROM ontology.ontologies WHERE id=$1`, ontologyID).Scan(&raw); err != nil {
		return 0, err
	}
	sum := sha256.Sum256(raw)
	hash := hex.EncodeToString(sum[:16])
	var ver int
	if err = tx.QueryRow(ctx, `
		INSERT INTO ontology.ontology_versions (ontology_id, version, kind, content_hash, source, doc)
		VALUES ($1, (SELECT COALESCE(MAX(version),0)+1 FROM ontology.ontology_versions WHERE ontology_id=$1), 'release', $2, 'publish', $3)
		RETURNING version`,
		ontologyID, hash, raw).Scan(&ver); err != nil {
		return 0, err
	}
	return ver, tx.Commit(ctx)
}

func (p *PG) Delete(ctx context.Context, id string) (bool, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, id); err != nil {
		return false, err
	}
	ct, err := tx.Exec(ctx, `DELETE FROM ontology.ontologies WHERE id=$1`, id)
	if err != nil {
		return false, err
	}
	existed := ct.RowsAffected() > 0
	if _, err = tx.Exec(ctx, `DELETE FROM ontology.ontology_versions WHERE ontology_id=$1`, id); err != nil {
		return false, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM ontology.ontology_proposals WHERE ontology_id=$1`, id); err != nil {
		return false, err
	}
	return existed, tx.Commit(ctx)
}

func (p *PG) ReadVersion(ctx context.Context, ontologyID string, version int) (Document, bool, error) {
	var raw []byte
	err := p.pool.QueryRow(ctx,
		`SELECT doc FROM ontology.ontology_versions WHERE ontology_id=$1 AND version=$2`, ontologyID, version).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Document{}, false, nil
		}
		return Document{}, false, err
	}
	var d Document
	if err := json.Unmarshal(raw, &d); err != nil {
		return Document{}, false, err
	}
	return d, true, nil
}

func (p *PG) Read(ctx context.Context, id string) (Document, bool, error) {
	var raw []byte
	err := p.pool.QueryRow(ctx, `SELECT doc FROM ontology.ontologies WHERE id=$1`, id).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Document{}, false, nil
		}
		return Document{}, false, err
	}
	var d Document
	if err := json.Unmarshal(raw, &d); err != nil {
		return Document{}, false, err
	}
	return d, true, nil
}
