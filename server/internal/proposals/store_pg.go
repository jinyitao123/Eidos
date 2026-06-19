package proposals

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PG struct{ pool *pgxpool.Pool }

func NewPG(pool *pgxpool.Pool) *PG { return &PG{pool: pool} }

func (p *PG) Save(ctx context.Context, pr Proposal) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO ontology.ontology_proposals (id, ontology_id, kind, entity_id, payload, reason, proposer, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (id) DO UPDATE
		SET payload=EXCLUDED.payload, reason=EXCLUDED.reason`,
		pr.ID, pr.OntologyID, pr.Kind, pr.EntityID, pr.Payload, pr.Reason, pr.Proposer, pr.Status)
	return err
}

func (p *PG) Get(ctx context.Context, id string) (Proposal, bool, error) {
	var pr Proposal
	err := p.pool.QueryRow(ctx,
		`SELECT id, ontology_id, kind, entity_id, payload, reason, proposer, status, created_at, decided_at
		 FROM ontology.ontology_proposals WHERE id=$1`, id).
		Scan(&pr.ID, &pr.OntologyID, &pr.Kind, &pr.EntityID, &pr.Payload, &pr.Reason, &pr.Proposer, &pr.Status, &pr.CreatedAt, &pr.DecidedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Proposal{}, false, nil
		}
		return Proposal{}, false, err
	}
	return pr, true, nil
}

func (p *PG) ListByStatus(ctx context.Context, ontologyID, status string) ([]Proposal, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT id, ontology_id, kind, entity_id, payload, reason, proposer, status, created_at, decided_at
		 FROM ontology.ontology_proposals
		 WHERE ontology_id=$1 AND ($2='' OR status=$2)
		 ORDER BY created_at ASC`, ontologyID, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Proposal
	for rows.Next() {
		var pr Proposal
		if err := rows.Scan(&pr.ID, &pr.OntologyID, &pr.Kind, &pr.EntityID, &pr.Payload, &pr.Reason, &pr.Proposer, &pr.Status, &pr.CreatedAt, &pr.DecidedAt); err != nil {
			return nil, err
		}
		out = append(out, pr)
	}
	return out, rows.Err()
}

func (p *PG) SetStatus(ctx context.Context, id, status string) error {
	_, err := p.pool.Exec(ctx,
		`UPDATE ontology.ontology_proposals SET status=$2, decided_at=now() WHERE id=$1`, id, status)
	return err
}
