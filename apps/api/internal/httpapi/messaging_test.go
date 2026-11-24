package httpapi_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"skillconnect/api/internal/auth"
	"skillconnect/api/internal/httpapi"
	"skillconnect/api/internal/service"
)

const (
	alex           = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1"
	blair          = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2"
	casey          = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3"
	mainWorkspace  = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11"
	otherWorkspace = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa12"
)

type trustedTestVerifier struct{}

func (trustedTestVerifier) Verify(_ context.Context, assertion string) (auth.Principal, error) {
	switch assertion {
	case alex, blair, casey:
		return auth.Principal{EmployeeID: assertion, SessionID: "test-session"}, nil
	default:
		return auth.Principal{}, errors.New("unverified")
	}
}

type postProbe struct {
	service.MessagingStore
	sender string
}

func (p *postProbe) CreateMessage(_ context.Context, employeeID, conversationID string, input service.MessageInput) (service.Message, bool, error) {
	p.sender = employeeID
	return service.Message{SenderID: employeeID, ConversationID: conversationID, ClientID: input.ClientID, Body: input.Body}, true, nil
}

func TestEveryMessagingRouteRequiresAuthentication(t *testing.T) {
	for _, verifier := range []auth.Verifier{nil, trustedTestVerifier{}} {
		router := httpapi.NewRouter(service.Health{}, service.Messaging{}, verifier, nil)
		for _, route := range []struct{ method, path string }{
			{http.MethodGet, "/api/v1/conversations"},
			{http.MethodPost, "/api/v1/conversations"},
			{http.MethodGet, "/api/v1/conversations/" + alex + "/members"},
			{http.MethodGet, "/api/v1/conversations/" + alex + "/messages"},
			{http.MethodPost, "/api/v1/conversations/" + alex + "/messages"},
		} {
			for _, assertion := range []string{"", "unverified"} {
				res := request(router, route.method, route.path, assertion, "")
				if res.Code != http.StatusUnauthorized || !strings.Contains(res.Body.String(), `"code":"unauthorized"`) {
					t.Fatalf("%s %s returned %d %s", route.method, route.path, res.Code, res.Body.String())
				}
			}
		}
	}
}

func TestMessageValidationAndTrustedSender(t *testing.T) {
	probe := &postProbe{}
	router := httpapi.NewRouter(service.Health{}, service.Messaging{Store: probe}, trustedTestVerifier{}, nil)
	path := "/api/v1/conversations/" + mainWorkspace + "/messages"
	prefix := `{"client_id":"` + casey + `","body":`
	for _, tc := range []struct {
		name, path, body string
		status           int
	}{
		{"unknown sender field", path, prefix + `"hello","sender_id":"` + blair + `"}`, 400},
		{"blank", path, prefix + `" \t\n"}`, 400},
		{"embedded NUL", path, prefix + `"a\u0000b"}`, 400},
		{"invalid UTF-8", path, prefix + "\"" + string([]byte{0xff}) + "\"}", 400},
		{"too many runes", path, prefix + "\"" + strings.Repeat("😀", 4001) + "\"}", 400},
		{"bad client id", path, `{"client_id":"bogus","body":"hello"}`, 400},
		{"bad conversation id", "/api/v1/conversations/bogus/messages", prefix + `"hello"}`, 400},
		{"trailing JSON", path, prefix + `"hello"} {}`, 400},
		{"oversized request", path, prefix + "\"" + strings.Repeat("a", 64*1024) + "\"}", 413},
	} {
		t.Run(tc.name, func(t *testing.T) {
			res := request(router, http.MethodPost, tc.path, alex, tc.body)
			if res.Code != tc.status || probe.sender != "" {
				t.Fatalf("got %d %s (sender %q), want %d and no write", res.Code, res.Body.String(), probe.sender, tc.status)
			}
		})
	}
	res := request(router, http.MethodPost, path, alex, prefix+"\""+strings.Repeat("😀", 4000)+"\"}")
	if res.Code != http.StatusCreated || probe.sender != alex {
		t.Fatalf("got %d with sender %s, want 201 and the verified employee", res.Code, probe.sender)
	}
}

func request(router http.Handler, method, path, assertion, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-ID", "browser-supplied-identity")
	if assertion != "" {
		req.Header.Set("Authorization", "Bearer "+assertion)
	}
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	return res
}
