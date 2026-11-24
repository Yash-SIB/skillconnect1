package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type verifyFunc func(context.Context, string) (Principal, error)

func (f verifyFunc) Verify(ctx context.Context, assertion string) (Principal, error) {
	return f(ctx, assertion)
}

func TestRequire(t *testing.T) {
	verified := Principal{EmployeeID: "verified-employee", SessionID: "verified-session"}
	verifier := verifyFunc(func(_ context.Context, assertion string) (Principal, error) {
		if assertion == "test-assertion" {
			return verified, nil
		}
		return Principal{}, errors.New("verification failed")
	})
	tests := []struct {
		name     string
		verifier Verifier
		headers  []string
		wantCode int
	}{
		{"unconfigured", nil, []string{"Bearer test-assertion"}, 401},
		{"spoofed identity header", verifier, nil, 401},
		{"wrong scheme", verifier, []string{"Basic test-assertion"}, 401},
		{"multiple credentials", verifier, []string{"Bearer test-assertion", "Bearer another"}, 401},
		{"invalid assertion", verifier, []string{"Bearer invalid"}, 401},
		{"empty principal", verifyFunc(func(context.Context, string) (Principal, error) {
			return Principal{}, nil
		}), []string{"Bearer test-assertion"}, 401},
		{"verified principal", verifier, []string{"Bearer test-assertion"}, 204},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				got, ok := PrincipalFromContext(r.Context())
				if !ok || got != verified {
					t.Errorf("got principal %+v, want %+v", got, verified)
				}
				w.WriteHeader(http.StatusNoContent)
			})
			req := httptest.NewRequest(http.MethodGet, "/protected", nil)
			req.Header.Set("X-User-ID", "browser-supplied-id")
			for _, value := range tt.headers {
				req.Header.Add("Authorization", value)
			}
			w := httptest.NewRecorder()
			Require(tt.verifier, next).ServeHTTP(w, req)
			if w.Code != tt.wantCode {
				t.Fatalf("got %d, want %d", w.Code, tt.wantCode)
			}
			if tt.wantCode == http.StatusUnauthorized && w.Header().Get("WWW-Authenticate") != "Bearer" {
				t.Fatal("missing challenge on rejection")
			}
		})
	}
}
