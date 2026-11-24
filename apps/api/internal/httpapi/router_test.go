package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"skillconnect/api/internal/service"
)

type dependencyFunc func(context.Context) error

func (f dependencyFunc) Check(ctx context.Context) error { return f(ctx) }

func TestHealth(t *testing.T) {
	tests := []struct {
		name     string
		health   service.Health
		wantCode int
		wantJSON string
	}{
		{"without database", service.Health{}, http.StatusOK, "{\"status\":\"ok\"}\n"},
		{"database ready", service.Health{Database: dependencyFunc(func(ctx context.Context) error {
			if _, ok := ctx.Deadline(); !ok {
				t.Error("database check did not receive a deadline")
			}
			return nil
		})}, http.StatusOK, "{\"status\":\"ok\"}\n"},
		{"database down", service.Health{Database: dependencyFunc(func(context.Context) error {
			return errors.New("internal database details")
		})}, http.StatusServiceUnavailable, "{\"status\":\"unavailable\"}\n"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			NewRouter(tt.health, service.Messaging{}, nil, nil).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/health", nil))
			if w.Code != tt.wantCode || w.Body.String() != tt.wantJSON {
				t.Fatalf("got %d %s, want %d %s", w.Code, w.Body, tt.wantCode, tt.wantJSON)
			}
			if w.Header().Get("Content-Type") != "application/json" || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("unexpected health response headers")
			}
		})
	}
}

func TestHealthIsTheOnlyPublicRoute(t *testing.T) {
	router := NewRouter(service.Health{}, service.Messaging{}, nil, nil)
	for _, path := range []string{"/", "/api/v1/me", "/api/v1/users"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("X-User-ID", "browser-supplied-id")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusNotFound {
			t.Fatalf("%s returned %d, want 404", path, w.Code)
		}
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/health", nil))
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST /health returned %d, want 405", w.Code)
	}
	w = httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/ws?user_id=spoofed", nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous WebSocket handshake returned %d, want 401", w.Code)
	}
}
