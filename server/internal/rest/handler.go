package rest

import (
	"encoding/json"
	"net/http"

	"ontologyserver/internal/assess"
	"ontologyserver/internal/proposals"
	"ontologyserver/internal/store"
)

type Handler struct {
	Store     store.Store
	Proposals proposals.Store
}

func (h *Handler) Mount(mux *http.ServeMux) {
	mux.HandleFunc("GET /ontologies/{id}", h.getOntology)
	mux.HandleFunc("GET /ontologies/{id}/versions", h.listVersions)
	mux.HandleFunc("GET /ontologies/{id}/health", h.getHealth)
	if h.Proposals != nil {
		mux.HandleFunc("GET /ontologies/{id}/proposals", h.listProposals)
	}
}

func (h *Handler) getOntology(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	d, ok, err := h.Store.Read(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	writeJSON(w, http.StatusOK, d.Ontology)
}

func (h *Handler) listVersions(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	vs, err := h.Store.ListVersions(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, vs)
}

func (h *Handler) getHealth(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	d, ok, err := h.Store.Read(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	writeJSON(w, http.StatusOK, assess.Health(&d.Ontology))
}

func (h *Handler) listProposals(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	status := r.URL.Query().Get("status")
	list, err := h.Proposals.ListByStatus(r.Context(), id, status)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
