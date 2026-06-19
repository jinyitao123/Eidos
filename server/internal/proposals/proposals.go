package proposals

import (
	"context"
	"time"
)

// Proposal is a pending ontology change awaiting human approval.
type Proposal struct {
	ID         string     `json:"id"`
	OntologyID string     `json:"ontology_id"`
	Kind       string     `json:"kind"`      // attribute | entity | relationship
	EntityID   string     `json:"entity_id"` // which entity the attribute attaches to
	Payload    string     `json:"payload"`   // JSON of the proposed change
	Reason     string     `json:"reason"`
	Proposer   string     `json:"proposer"`
	Status     string     `json:"status"` // pending | approved | rejected
	CreatedAt  time.Time  `json:"created_at"`
	DecidedAt  *time.Time `json:"decided_at,omitempty"`
}

func ValidKind(k string) bool {
	return k == "attribute" || k == "entity" || k == "relationship"
}

type Store interface {
	Save(ctx context.Context, p Proposal) error
	Get(ctx context.Context, id string) (Proposal, bool, error)
	ListByStatus(ctx context.Context, ontologyID, status string) ([]Proposal, error)
	SetStatus(ctx context.Context, id, status string) error
}
