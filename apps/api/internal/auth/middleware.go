package auth

import (
	"context"
	"net/http"
	"strings"
)

type Principal struct {
	EmployeeID string
	SessionID  string
}

// Verifier validates a trusted service assertion and resolves an active employee session.
type Verifier interface {
	Verify(ctx context.Context, assertion string) (Principal, error)
}

type principalKey struct{}

// Session is the verified identity and its server-to-server proof.
// The proof stays in memory for revalidation of long-lived connections.
type Session struct {
	Principal Principal
	verifier  Verifier
	assertion string
}

func SessionFromContext(ctx context.Context) (Session, bool) {
	session, ok := ctx.Value(principalKey{}).(Session)
	return session, ok
}

func PrincipalFromContext(ctx context.Context) (Principal, bool) {
	session, ok := SessionFromContext(ctx)
	return session.Principal, ok
}

func (s Session) Valid(ctx context.Context) bool {
	if s.verifier == nil {
		return false
	}
	principal, err := s.verifier.Verify(ctx, s.assertion)
	return err == nil && principal == s.Principal
}

// Require gates future protected handlers. Each handler still needs resource authorization.
func Require(verifier Verifier, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		values := r.Header.Values("Authorization")
		if verifier == nil || len(values) != 1 {
			reject(w)
			return
		}
		parts := strings.Fields(values[0])
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || strings.Contains(parts[1], ",") {
			reject(w)
			return
		}

		principal, err := verifier.Verify(r.Context(), parts[1])
		if err != nil || strings.TrimSpace(principal.EmployeeID) == "" || strings.TrimSpace(principal.SessionID) == "" {
			reject(w)
			return
		}

		ctx := context.WithValue(r.Context(), principalKey{}, Session{
			Principal: principal, verifier: verifier, assertion: parts[1],
		})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func reject(w http.ResponseWriter) {
	w.Header().Set("WWW-Authenticate", "Bearer")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte("{\"error\":{\"code\":\"unauthorized\",\"message\":\"Valid authentication is required\"}}\n"))
}
