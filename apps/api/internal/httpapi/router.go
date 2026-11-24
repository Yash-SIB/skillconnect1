package httpapi

import (
	"encoding/json"
	"net/http"

	"skillconnect/api/internal/auth"
	"skillconnect/api/internal/service"
)

func NewRouter(health service.Health, messaging service.Messaging, verifier auth.Verifier, socket http.Handler) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		status, body := http.StatusOK, "ok"
		if err := health.Check(r.Context()); err != nil {
			status, body = http.StatusServiceUnavailable, "unavailable"
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(struct {
			Status string `json:"status"`
		}{Status: body})
	})
	messagingHandler{service: messaging}.register(mux, verifier)
	if socket == nil {
		socket = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			writeError(w, http.StatusServiceUnavailable, "unavailable", "Realtime is unavailable")
		})
	}
	mux.Handle("GET /api/v1/ws", auth.Require(verifier, socket))
	return mux
}
