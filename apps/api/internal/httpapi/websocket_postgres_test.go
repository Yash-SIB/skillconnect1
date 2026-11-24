package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"skillconnect/api/internal/httpapi"
	"skillconnect/api/internal/realtime"
	"skillconnect/api/internal/repository"
	"skillconnect/api/internal/service"
	"skillconnect/api/internal/testdb"
	"skillconnect/api/migrations"
)

func TestRealtimePostgres(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool := testdb.Open(t, ctx)
	if _, err := migrations.Apply(ctx, pool); err != nil {
		t.Fatal(err)
	}
	testdb.Exec(t, ctx, pool, `INSERT INTO users (id,email,display_name) VALUES
		($1,'alex@example.test','Alex'),($2,'blair@example.test','Blair'),($3,'casey@example.test','Casey')`, alex, blair, casey)
	testdb.Exec(t, ctx, pool, `INSERT INTO workspaces (id,slug,name) VALUES ($1,'main','Main'),($2,'other','Other')`, mainWorkspace, otherWorkspace)
	testdb.Exec(t, ctx, pool, `INSERT INTO workspace_members (workspace_id,user_id) VALUES
		($1,$3),($1,$4),($2,$5)`, mainWorkspace, otherWorkspace, alex, blair, casey)

	hub := realtime.NewHub()
	store := repository.Messaging{Pool: pool}
	const origin = "https://workspace.example.test"
	endpoint, err := realtime.NewEndpoint(hub, store, origin)
	if err != nil {
		t.Fatal(err)
	}
	router := httpapi.NewRouter(service.Health{}, service.Messaging{Store: store, Publisher: hub}, trustedTestVerifier{}, endpoint)
	server := httptest.NewServer(router)
	t.Cleanup(server.Close)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := hub.Shutdown(ctx); err != nil {
			t.Error(err)
		}
	})

	openSocket := func(employee string) *websocket.Conn {
		t.Helper()
		conn, res, err := websocket.DefaultDialer.DialContext(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/api/v1/ws", http.Header{
			"Origin": {origin}, "Authorization": {"Bearer " + employee},
		})
		if err != nil {
			if res != nil {
				res.Body.Close()
			}
			t.Fatal(err)
		}
		t.Cleanup(func() { conn.Close() })
		return conn
	}

	const route = "/api/v1/conversations"
	createChannel := func(employee, workspace string) string {
		t.Helper()
		req := `{"workspace_id":"` + workspace + `","kind":"channel","name":"private-room","visibility":"private"}`
		res := request(router, http.MethodPost, route, employee, req)
		expectStatus(t, res, http.StatusCreated)
		return decode[service.Conversation](t, res).ID
	}
	mainChannel := createChannel(alex, mainWorkspace)
	otherChannel := createChannel(casey, otherWorkspace)
	mainPath := route + "/" + mainChannel + "/messages"
	otherPath := route + "/" + otherChannel + "/messages"

	first, second := openSocket(alex), openSocket(alex)
	sameWorkspaceOutsider, otherWorkspaceClient := openSocket(blair), openSocket(casey)
	sendCommand(t, first, "conversation.subscribe", mainChannel)
	expectSocketEvent(t, first, "conversation.subscribed", mainChannel)
	sendCommand(t, second, "conversation.subscribe", mainChannel)
	expectSocketEvent(t, second, "conversation.subscribed", mainChannel)
	for _, conn := range []*websocket.Conn{sameWorkspaceOutsider, otherWorkspaceClient} {
		sendCommand(t, conn, "conversation.subscribe", mainChannel)
		if frame := expectSocketEvent(t, conn, "error", mainChannel); frame.Code != "subscription_denied" {
			t.Fatalf("unexpected subscription result: %+v", frame)
		}
	}
	sendCommand(t, otherWorkspaceClient, "conversation.subscribe", otherChannel)
	expectSocketEvent(t, otherWorkspaceClient, "conversation.subscribed", otherChannel)

	const clientOne = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa21"
	const clientTwo = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa22"
	const clientThree = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa23"
	const clientFour = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa24"
	payload := func(key string) string { return `{"client_id":"` + key + `","body":"committed message"}` }
	results := make(chan *httptest.ResponseRecorder, 3)
	for _, key := range []string{clientOne, clientOne, clientTwo} {
		go func() { results <- request(router, http.MethodPost, mainPath, alex, payload(key)) }()
	}

	var delivered = make(map[string]bool)
	for range 2 {
		frame := expectSocketEvent(t, first, realtime.MessageCreated, mainChannel)
		if frame.Message.ID == "" || delivered[frame.Message.ID] || frame.Message.SenderID != alex {
			t.Fatalf("unexpected event: %+v", frame)
		}
		// A new connection can read the row as soon as a socket sees the event.
		var body string
		if err := pool.QueryRow(ctx, "SELECT body FROM messages WHERE id = $1", frame.Message.ID).Scan(&body); err != nil || body != frame.Message.Body {
			t.Fatalf("delivered before commit: body=%q, error=%v", body, err)
		}
		delivered[frame.Message.ID] = true
	}
	for range 2 {
		frame := expectSocketEvent(t, second, realtime.MessageCreated, mainChannel)
		if !delivered[frame.Message.ID] {
			t.Fatal("concurrent connections saw different events")
		}
		delete(delivered, frame.Message.ID)
	}
	var created, replayed int
	for range 3 {
		res := <-results
		switch res.Code {
		case http.StatusCreated:
			created++
		case http.StatusOK:
			replayed++
		default:
			t.Fatalf("POST returned %d %s", res.Code, res.Body.String())
		}
	}
	if created != 2 || replayed != 1 {
		t.Fatalf("created=%d replayed=%d", created, replayed)
	}

	// All sends finished before these acknowledgements. Any leaked or duplicate
	// event would appear first on a connection with an empty event queue.
	for _, conn := range []*websocket.Conn{first, second} {
		sendCommand(t, conn, "conversation.subscribe", mainChannel)
		expectSocketEvent(t, conn, "conversation.subscribed", mainChannel)
	}
	sendCommand(t, sameWorkspaceOutsider, "conversation.unsubscribe", mainChannel)
	expectSocketEvent(t, sameWorkspaceOutsider, "conversation.unsubscribed", mainChannel)
	res := request(router, http.MethodPost, otherPath, casey, payload(clientOne))
	expectStatus(t, res, http.StatusCreated)
	expectSocketEvent(t, otherWorkspaceClient, realtime.MessageCreated, otherChannel)

	first.Close()
	res = request(router, http.MethodPost, mainPath, alex, payload(clientThree))
	expectStatus(t, res, http.StatusCreated)
	missed := expectSocketEvent(t, second, realtime.MessageCreated, mainChannel).Message.ID
	reconnected := openSocket(alex)
	sendCommand(t, reconnected, "conversation.subscribe", mainChannel)
	expectSocketEvent(t, reconnected, "conversation.subscribed", mainChannel)
	res = request(router, http.MethodGet, mainPath, alex, "")
	expectStatus(t, res, http.StatusOK)
	history := decode[service.MessagePage](t, res)
	if len(history.Messages) != 3 || history.Messages[0].ID != missed {
		t.Fatalf("REST history did not recover missed message: %+v", history)
	}

	// Once membership is revoked, even messages already headed for the hub must
	// be checked again before being written to the revoked employee's socket.
	testdb.Exec(t, ctx, pool, `INSERT INTO conversation_members
		(workspace_id,conversation_id,user_id,conversation_kind) VALUES ($1,$2,$3,'channel')`, mainWorkspace, mainChannel, blair)
	testdb.Exec(t, ctx, pool, `UPDATE conversation_members SET left_at = now() WHERE conversation_id = $1 AND user_id = $2`, mainChannel, alex)
	res = request(router, http.MethodPost, mainPath, blair, payload(clientFour))
	expectStatus(t, res, http.StatusCreated)
	for _, conn := range []*websocket.Conn{second, reconnected} {
		_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		if _, _, err := conn.ReadMessage(); !websocket.IsCloseError(err, websocket.ClosePolicyViolation) {
			t.Fatalf("revoked connection received data or failed to close: %v", err)
		}
	}

	shutdown, stop := context.WithTimeout(ctx, 3*time.Second)
	defer stop()
	if err := hub.Shutdown(shutdown); err != nil {
		t.Fatal(err)
	}
	_ = otherWorkspaceClient.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, _, err := otherWorkspaceClient.ReadMessage(); !websocket.IsCloseError(err, websocket.CloseGoingAway) {
		t.Fatalf("shutdown did not send going-away close: %v", err)
	}
}

func sendCommand(t *testing.T, conn *websocket.Conn, kind, conversationID string) {
	t.Helper()
	_ = conn.SetWriteDeadline(time.Now().Add(3 * time.Second))
	if err := conn.WriteJSON(map[string]any{"version": 1, "type": kind, "conversation_id": conversationID}); err != nil {
		t.Fatal(err)
	}
}

type socketFrame struct {
	Version        int             `json:"version"`
	Type           string          `json:"type"`
	ConversationID string          `json:"conversation_id"`
	Code           string          `json:"code"`
	Message        service.Message `json:"message"`
}

func expectSocketEvent(t *testing.T, conn *websocket.Conn, kind, conversationID string) socketFrame {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	var frame socketFrame
	if err := json.Unmarshal(raw, &frame); err != nil || frame.Type != kind ||
		frame.ConversationID != conversationID || frame.Version != realtime.Version {
		t.Fatalf("wanted %s for %s but got %s: %v", kind, conversationID, raw, err)
	}
	return frame
}
