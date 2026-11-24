package realtime

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"skillconnect/api/internal/auth"
)

const testOrigin = "https://workspace.example.test"

type sessionVerifier struct{ revoked atomic.Bool }

func (v *sessionVerifier) Verify(_ context.Context, proof string) (auth.Principal, error) {
	if v.revoked.Load() || proof != "verified-test-proof" {
		return auth.Principal{}, errors.New("rejected")
	}
	return auth.Principal{EmployeeID: "employee", SessionID: "session"}, nil
}

type testAuthorizer struct{}

func (testAuthorizer) ActiveConversationWorkspace(context.Context, string, string) (string, error) {
	return "workspace", nil
}

func testSocket(t *testing.T, allowed string, verifier auth.Verifier, heartbeat, pong time.Duration) (*Hub, string) {
	t.Helper()
	hub := NewHub()
	endpoint, err := NewEndpoint(hub, testAuthorizer{}, allowed)
	if err != nil {
		t.Fatal(err)
	}
	if heartbeat != 0 {
		endpoint.pingEvery = heartbeat
		endpoint.pongWithin = pong
	}
	server := httptest.NewServer(auth.Require(verifier, endpoint))
	t.Cleanup(server.Close)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := hub.Shutdown(ctx); err != nil {
			t.Error(err)
		}
	})
	return hub, "ws" + strings.TrimPrefix(server.URL, "http")
}

func TestHandshakeRequiresProofAndConfiguredOrigin(t *testing.T) {
	_, url := testSocket(t, testOrigin, &sessionVerifier{}, 0, 0)
	for _, tc := range []struct {
		name, path, proof string
		origins           []string
		expected          int
	}{
		{"query identity", "?user_id=employee&token=verified-test-proof", "", []string{testOrigin}, 401},
		{"invalid proof", "", "invalid", []string{testOrigin}, 401},
		{"missing origin", "", "verified-test-proof", nil, 403},
		{"wrong scheme", "", "verified-test-proof", []string{"http://workspace.example.test"}, 403},
		{"wrong port", "", "verified-test-proof", []string{testOrigin + ":444"}, 403},
		{"same host not allowlisted", "", "verified-test-proof", []string{"http" + strings.TrimPrefix(url, "ws")}, 403},
		{"duplicate origin", "", "verified-test-proof", []string{testOrigin, testOrigin}, 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			headers := http.Header{"Origin": tc.origins}
			if tc.proof != "" {
				headers.Set("Authorization", "Bearer "+tc.proof)
			}
			conn, res, err := websocket.DefaultDialer.Dial(url+tc.path, headers)
			if conn != nil {
				conn.Close()
			}
			if res == nil {
				t.Fatalf("no handshake response: %v", err)
			}
			defer res.Body.Close()
			if err == nil || res.StatusCode != tc.expected {
				t.Fatalf("status %d, want %d (%v)", res.StatusCode, tc.expected, err)
			}
		})
	}
	if _, err := NewEndpoint(NewHub(), testAuthorizer{}, "https://*.example.test"); err == nil {
		t.Fatal("wildcard origins must be rejected")
	}
}

func dialTestSocket(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	conn, res, err := websocket.DefaultDialer.Dial(url, http.Header{
		"Origin": {testOrigin}, "Authorization": {"Bearer verified-test-proof"},
	})
	if err != nil {
		if res != nil {
			res.Body.Close()
		}
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	return conn
}

func TestWebSocketHeartbeatAndSessionRevocation(t *testing.T) {
	verifier := &sessionVerifier{}
	hub, url := testSocket(t, testOrigin, verifier, 20*time.Millisecond, time.Second)
	conn := dialTestSocket(t, url)
	pings := 0
	pong := conn.PingHandler()
	conn.SetPingHandler(func(payload string) error {
		if err := pong(payload); err != nil {
			return err
		}
		pings++
		if pings == 2 {
			verifier.revoked.Store(true)
		}
		return nil
	})
	_, _, err := conn.ReadMessage()
	if pings < 2 || !websocket.IsCloseError(err, websocket.ClosePolicyViolation) {
		t.Fatalf("pings=%d, close=%v", pings, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := hub.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestWebSocketInboundLimits(t *testing.T) {
	_, url := testSocket(t, testOrigin, &sessionVerifier{}, 0, 0)
	conn := dialTestSocket(t, url)
	if err := conn.WriteMessage(websocket.TextMessage, make([]byte, inboundLimit+1)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := conn.ReadMessage(); !websocket.IsCloseError(err, websocket.CloseMessageTooBig) {
		t.Fatalf("oversized frame close: %v", err)
	}

	conn = dialTestSocket(t, url)
	for range inboundRate + 1 {
		if err := conn.WriteMessage(websocket.TextMessage, []byte(`{}`)); err != nil {
			t.Fatal(err)
		}
	}
	for received := 0; received <= inboundRate; received++ {
		var event response
		err := conn.ReadJSON(&event)
		if websocket.IsCloseError(err, websocket.ClosePolicyViolation) {
			return
		}
		if err != nil || event.Code != "invalid_event" {
			t.Fatalf("unexpected response: %+v (%v)", event, err)
		}
	}
	t.Fatal("rate limit did not close connection")
}
