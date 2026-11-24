package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"

	"skillconnect/api/internal/httpapi"
	"skillconnect/api/internal/repository"
	"skillconnect/api/internal/service"
	"skillconnect/api/internal/testdb"
	"skillconnect/api/migrations"
)

func TestMessagingPostgres(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	pool := testdb.Open(t, ctx)
	if _, err := migrations.Apply(ctx, pool); err != nil {
		t.Fatal(err)
	}
	testdb.Exec(t, ctx, pool, `INSERT INTO users (id, email, display_name) VALUES
		($1, 'alex@example.test', 'Alex'), ($2, 'blair@example.test', 'Blair'), ($3, 'casey@example.test', 'Casey')`, alex, blair, casey)
	testdb.Exec(t, ctx, pool, `INSERT INTO workspaces (id, slug, name) VALUES ($1, 'main', 'Main'), ($2, 'other', 'Other')`, mainWorkspace, otherWorkspace)
	testdb.Exec(t, ctx, pool, `INSERT INTO workspace_members (workspace_id, user_id) VALUES ($1, $3), ($1, $4), ($2, $5)`, mainWorkspace, otherWorkspace, alex, blair, casey)

	router := httpapi.NewRouter(service.Health{}, service.Messaging{Store: repository.Messaging{Pool: pool}}, trustedTestVerifier{}, nil)
	const route = "/api/v1/conversations"
	call := func(method, path, employee, body string, status int) *httptest.ResponseRecorder {
		t.Helper()
		res := request(router, method, path, employee, body)
		expectStatus(t, res, status)
		return res
	}

	publicInput := `{"workspace_id":"` + mainWorkspace + `","kind":"channel","name":"general","visibility":"public"}`
	publicChannel := decode[service.Conversation](t, call(http.MethodPost, route, alex, publicInput, 201))
	call(http.MethodPost, route, alex, publicInput, 409)
	privateInput := strings.ReplaceAll(strings.ReplaceAll(publicInput, "general", "planning"), "public", "private")
	privateChannel := decode[service.Conversation](t, call(http.MethodPost, route, alex, privateInput, 201))
	if publicChannel.Visibility != "public" || privateChannel.Visibility != "private" {
		t.Fatal("channel visibility did not persist")
	}

	publicMessages := route + "/" + publicChannel.ID + "/messages"
	privateMessages := route + "/" + privateChannel.ID + "/messages"
	privateMembers := route + "/" + privateChannel.ID + "/members"
	list := route + "?workspace_id=" + mainWorkspace
	if res := call(http.MethodGet, list, blair, "", 200); res.Body.String() != "{\"conversations\":[]}\n" {
		t.Fatalf("unexpected nonmember list: %s", res.Body)
	}
	call(http.MethodGet, list, casey, "", 403)
	call(http.MethodPost, route, casey, publicInput, 403)
	call(http.MethodGet, publicMessages, blair, "", 404)
	call(http.MethodGet, privateMessages, blair, "", 404)
	call(http.MethodGet, privateMembers, casey, "", 404)

	dmInput := func(peer string) string {
		return `{"workspace_id":"` + mainWorkspace + `","kind":"dm","peer_id":"` + peer + `"}`
	}
	call(http.MethodPost, route, alex, dmInput(alex), 400)
	call(http.MethodPost, route, alex, dmInput(casey), 404)
	results := make(chan *httptest.ResponseRecorder, 2)
	go func() { results <- request(router, http.MethodPost, route, alex, dmInput(blair)) }()
	go func() { results <- request(router, http.MethodPost, route, blair, dmInput(alex)) }()
	first, second := <-results, <-results
	expectCreatedAndReplay(t, first, second)
	dm := decode[service.Conversation](t, first)
	if dm.ID != decode[service.Conversation](t, second).ID {
		t.Fatal("opposite-order DM requests created different conversations")
	}

	type memberList struct{ Members []service.Member }
	dmMembers := route + "/" + dm.ID + "/members"
	res := call(http.MethodGet, dmMembers, alex, "", 200)
	members := decode[memberList](t, res).Members
	if len(members) != 2 || members[0].ID != alex || members[1].ID != blair || strings.Contains(res.Body.String(), "example.test") {
		t.Fatalf("unexpected DM members: %s", res.Body)
	}
	call(http.MethodGet, dmMembers, casey, "", 404)

	active := decode[struct{ Conversations []service.Conversation }](t, call(http.MethodGet, list, blair, "", 200))
	if len(active.Conversations) != 1 || active.Conversations[0].ID != dm.ID || active.Conversations[0].PeerID != alex {
		t.Fatalf("incorrect participant-scoped conversation list: %+v", active.Conversations)
	}
	dmMessages := route + "/" + dm.ID + "/messages"
	const one = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa21"
	const two = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa22"
	const three = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa23"
	send := func(id, body string) string { return `{"client_id":"` + id + `","body":"` + body + `"}` }
	const message = "  Let's ship this.  "
	go func() { results <- request(router, http.MethodPost, dmMessages, alex, send(one, message)) }()
	go func() { results <- request(router, http.MethodPost, dmMessages, alex, send(one, message)) }()
	first, second = <-results, <-results
	expectCreatedAndReplay(t, first, second)
	saved := decode[service.Message](t, first)
	if saved.ID != decode[service.Message](t, second).ID || saved.SenderID != alex || saved.Body != message {
		t.Fatalf("retry or sender identity incorrect: %+v", saved)
	}
	call(http.MethodPost, dmMessages, alex, send(one, "different"), 409)
	call(http.MethodPost, dmMessages, casey, send(one, "unauthorized"), 404)
	call(http.MethodPost, dmMessages, blair, send(one, "same client ID, different sender"), 201)
	call(http.MethodPost, dmMessages, alex, send(two, "second"), 201)
	deleted := decode[service.Message](t, call(http.MethodPost, dmMessages, alex, send(three, "deleted"), 201))
	testdb.Exec(t, ctx, pool, `UPDATE messages SET created_at = '2026-01-01T00:00:00Z' WHERE conversation_id = $1`, dm.ID)
	testdb.Exec(t, ctx, pool, `UPDATE messages SET deleted_at = now() WHERE id = $1`, deleted.ID)
	call(http.MethodPost, dmMessages, alex, send(three, "deleted"), 409)

	var ids []string
	nextPath := dmMessages + "?limit=1"
	for range 3 {
		page := decode[service.MessagePage](t, call(http.MethodGet, nextPath, blair, "", 200))
		if len(page.Messages) != 1 {
			t.Fatalf("expected one message, got %+v", page)
		}
		ids = append(ids, page.Messages[0].ID)
		if len(ids) == 3 {
			if page.NextCursor != "" {
				t.Fatal("last page returned a cursor")
			}
		} else {
			if page.NextCursor == "" {
				t.Fatal("missing next cursor")
			}
			call(http.MethodGet, publicMessages+"?cursor="+url.QueryEscape(page.NextCursor), alex, "", 400)
			nextPath = dmMessages + "?limit=1&cursor=" + url.QueryEscape(page.NextCursor)
		}
	}
	if !slices.IsSortedFunc(ids, func(a, b string) int { return strings.Compare(b, a) }) ||
		ids[0] == ids[1] || ids[1] == ids[2] || slices.Contains(ids, deleted.ID) {
		t.Fatalf("pagination repeated, misordered, or exposed deleted rows: %v", ids)
	}
	call(http.MethodGet, dmMessages+"?limit=101", blair, "", 400)
	call(http.MethodGet, dmMessages+"?cursor=invalid", blair, "", 400)
	if res := call(http.MethodGet, publicMessages, alex, "", 200); res.Body.String() != "{\"messages\":[]}\n" {
		t.Fatalf("unexpected empty paginated response: %s", res.Body)
	}

	testdb.Exec(t, ctx, pool, `UPDATE conversation_members SET left_at = now() WHERE conversation_id = $1 AND user_id = $2`, privateChannel.ID, alex)
	call(http.MethodGet, privateMembers, alex, "", 404)
	call(http.MethodPost, privateMessages, alex, send(one, "left"), 404)
	testdb.Exec(t, ctx, pool, `UPDATE workspace_members SET removed_at = now() WHERE workspace_id = $1 AND user_id = $2`, mainWorkspace, blair)
	call(http.MethodGet, list, blair, "", 403)
	call(http.MethodGet, dmMessages, blair, "", 404)
	call(http.MethodPost, route, alex, dmInput(blair), 404)
	call(http.MethodPost, dmMessages, alex, send(one, message), 403)
	members = decode[memberList](t, call(http.MethodGet, dmMembers, alex, "", 200)).Members
	if len(members) != 1 || members[0].ID != alex {
		t.Fatalf("removed member is still visible: %+v", members)
	}
	testdb.Exec(t, ctx, pool, `UPDATE users SET disabled_at = now() WHERE id = $1`, alex)
	call(http.MethodGet, list, alex, "", 403)
	call(http.MethodGet, publicMessages, alex, "", 404)
	call(http.MethodPost, publicMessages, alex, send(one, "disabled"), 404)
}

func expectStatus(t *testing.T, res *httptest.ResponseRecorder, status int) {
	t.Helper()
	if res.Code != status {
		t.Fatalf("got %d %s, want %d", res.Code, res.Body.String(), status)
	}
}

func expectCreatedAndReplay(t *testing.T, a, b *httptest.ResponseRecorder) {
	t.Helper()
	if a.Code > b.Code {
		a, b = b, a
	}
	expectStatus(t, a, http.StatusOK)
	expectStatus(t, b, http.StatusCreated)
}

func decode[T any](t *testing.T, res *httptest.ResponseRecorder) T {
	t.Helper()
	var result T
	if err := json.Unmarshal(res.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode response: %v; body: %s", err, res.Body.String())
	}
	return result
}
